#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};
use zip::ZipArchive;

mod db;
mod epub;
mod history;

use history::{
    Bookmark, BookmarkOut, Highlight, HighlightNew, HistoryEntry, HistorySave, StatsPerBook,
    StatsSession, StatsSummary,
};

// ---------- types ----------

#[derive(Debug, Serialize)]
pub struct BookMeta {
    pub path: String,
    pub name: String,
    pub format: String, // cbz | cbr | epub | pdf | mobi | azw3
    pub size: u64,
    pub modified: i64,
    pub id: String, // "local:<sha256(path)>"
}

#[derive(Debug, Serialize)]
pub struct CbzPage {
    pub name: String,
    pub index: usize,
    pub total: usize,
    pub data_url: String,
}

pub struct AppState {
    pub db_path: Mutex<PathBuf>,
    /// Cache chỉ mục CBZ theo đường dẫn (xem cbz_entries): đọc 1 lần rồi
    /// dùng lại cho mọi trang, tránh quét lại cả file mỗi lần lật trang.
    pub cbz_cache: Mutex<HashMap<String, CbzIndexCache>>,
}

/// Chỉ mục CBZ đã sắp xếp tự nhiên: (chỉ số trong ZIP, tên file).
/// Khóa theo (kích thước, thời gian sửa) — file đổi thì đọc lại.
pub struct CbzIndexCache {
    pub size: u64,
    pub modified: u64,
    pub entries: Vec<(usize, String)>,
}

const IMAGE_EXTS: [&str; 6] = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
const BOOK_EXTS: [&str; 7] = ["cbz", "zip", "cbr", "rar", "epub", "pdf", "mobi"];
// azw3 xử lý như mobi
const BOOK_EXTS2: [&str; 1] = ["azw3"];

fn ext_of(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn local_id(path: &str) -> String {
    let mut h = Sha256::new();
    h.update(path.as_bytes());
    format!("local:{:x}", h.finalize())
}

fn is_book(p: &Path) -> bool {
    let e = ext_of(p);
    BOOK_EXTS.contains(&e.as_str()) || BOOK_EXTS2.contains(&e.as_str())
}

fn book_format(p: &Path) -> String {
    match ext_of(p).as_str() {
        "zip" => "cbz".to_string(), // ZIP chứa ảnh = CBZ
        "rar" => "cbr".to_string(),
        "azw3" => "mobi".to_string(),
        other => other.to_string(),
    }
}

// ---------- dialog ----------

#[tauri::command]
fn pick_file_app(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("Sách / truyện", &["cbz", "zip", "cbr", "epub", "pdf", "mobi", "azw3"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_folder_app(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

// ---------- metadata / list ----------

#[tauri::command]
fn file_metadata(path: String) -> Result<BookMeta, String> {
    let p = Path::new(&path);
    let m = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let modified = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok(BookMeta {
        id: local_id(&path),
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        format: book_format(p),
        size: m.len(),
        modified,
        path,
    })
}

/// Liệt kê sách trong 1 thư mục (đệ quy, tối đa 2000 file).
/// CHỈ đọc metadata — KHÔNG copy file nào.
#[tauri::command]
fn list_books(folder: String) -> Result<Vec<BookMeta>, String> {
    let mut out = Vec::new();
    let mut stack = vec![PathBuf::from(folder)];
    let mut seen = HashSet::new();
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for ent in rd.flatten() {
            let p = ent.path();
            if p.is_dir() {
                stack.push(p);
            } else if is_book(&p) && seen.insert(p.clone()) {
                if let Ok(meta) = file_metadata(p.to_string_lossy().to_string()) {
                    out.push(meta);
                    if out.len() >= 2000 {
                        return Ok(out);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Một mục trong cây thư mục: thư mục con hoặc 1 file sách.
#[derive(Debug, Serialize)]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub is_folder: bool,
    pub meta: Option<BookMeta>,
}

/// Liệt kê con TRỰC TIẾP của 1 thư mục (không đệ quy): thư mục con trước,
/// rồi tới file sách — mỗi nhóm sắp theo tên. Đây là nền cho màn "Thư mục"
/// (cây thư mục): mở thư mục to không còn đổ tất cả sách vào 1 danh sách
/// phẳng nữa mà duyệt từng tầng như Explorer.
#[tauri::command]
fn list_folder(path: String) -> Result<Vec<FolderEntry>, String> {
    let rd = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut folders: Vec<FolderEntry> = Vec::new();
    let mut books: Vec<FolderEntry> = Vec::new();
    for ent in rd.flatten() {
        let p = ent.path();
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }
        if p.is_dir() {
            folders.push(FolderEntry {
                name,
                path: p.to_string_lossy().to_string(),
                is_folder: true,
                meta: None,
            });
        } else if is_book(&p) {
            if let Ok(meta) = file_metadata(p.to_string_lossy().to_string()) {
                books.push(FolderEntry {
                    name,
                    path: meta.path.clone(),
                    is_folder: false,
                    meta: Some(meta),
                });
            }
        }
    }
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    books.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    folders.extend(books);
    Ok(folders)
}

// ---------- CBZ: đọc lười từng trang ----------

/// Chỉ mục CBZ (đã sắp xếp tự nhiên theo tên: page1, page2, page10...).
/// Đọc thật từ file đúng 1 lần rồi cache theo (đường dẫn, kích thước,
/// thời gian sửa); các lần sau dùng lại — KHÔNG quét lại file.
///
/// Trước v0.3.2, mỗi lần nạp 1 trang (`cbz_page`) đều chạy lại toàn bộ
/// hàm này (mở file + `by_index` từng entry + sắp xếp) rồi mới giải nén
/// trang đó; mở 1 file CBZ 300MB là 4 lần quét, mỗi lần lật trang lại
/// quét thêm — trên ổ chậm là đơ cứng cả app ("not responding").
/// Quét chỉ mục CBZ: chỉ tên file ảnh, sắp xếp tự nhiên (page1, page2,
/// page10...). Không giải nén gì cả. Dùng chung cho lệnh `cbz_index`
/// (có cache) và protocol `mio-page://` (không cache, mỗi lần gọi quét
/// lại central directory — chỉ vài ms, chạy trên luồng nền của WebView).
fn scan_cbz_entries(path: &str) -> Result<Vec<(usize, String)>, String> {
    let f = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut entries: Vec<(usize, String)> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| (i, f.name().to_string())))
        .filter(|(_, n)| {
            let lower = n.to_lowercase();
            IMAGE_EXTS.iter().any(|e| lower.ends_with(e))
                && !lower.contains("__macosx")
                && !lower.ends_with("comicinfo.xml")
        })
        .collect();
    entries.sort_by(|a, b| natural_cmp(&a.1, &b.1));
    Ok(entries)
}

/// Đọc ĐÚNG 1 entry trong ZIP ra bytes thô (không base64). Dùng chung
/// cho lệnh `cbz_page` và protocol `mio-page://`.
fn read_cbz_entry(path: &str, archive_idx: usize) -> Result<Vec<u8>, String> {
    let f = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut entry = zip.by_index(archive_idx).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn cbz_entries(state: &State<AppState>, path: &str) -> Result<Vec<(usize, String)>, String> {
    let m = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size = m.len();
    let modified = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    {
        let cache = state.cbz_cache.lock().map_err(|e| e.to_string())?;
        if let Some(c) = cache.get(path) {
            if c.size == size && c.modified == modified {
                return Ok(c.entries.clone());
            }
        }
    }
    let entries = scan_cbz_entries(path)?;
    {
        let mut cache = state.cbz_cache.lock().map_err(|e| e.to_string())?;
        if cache.len() >= 8 {
            // Giữ cache gọn: quá 8 file thì dọn bớt 1 mục cũ bất kỳ.
            if let Some(k) = cache.keys().next().cloned() {
                cache.remove(&k);
            }
        }
        cache.insert(
            path.to_string(),
            CbzIndexCache {
                size,
                modified,
                entries: entries.clone(),
            },
        );
    }
    Ok(entries)
}

/// Đọc chỉ mục ZIP: chỉ tên file ảnh, sắp xếp tự nhiên (page1, page2, page10...).
/// Không giải nén gì cả.
#[tauri::command]
fn cbz_index(state: State<AppState>, path: String) -> Result<Vec<String>, String> {
    Ok(cbz_entries(&state, &path)?
        .into_iter()
        .map(|(_, n)| n)
        .collect())
}

fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    // So sánh tự nhiên đơn giản: tách số ra so theo số.
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek(), bi.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(&ac), Some(&bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    let an: String = ai.by_ref().take_while(|c| c.is_ascii_digit()).collect();
                    let bn: String = bi.by_ref().take_while(|c| c.is_ascii_digit()).collect();
                    let (av, bv) = (
                        an.parse::<u64>().unwrap_or(0),
                        bn.parse::<u64>().unwrap_or(0),
                    );
                    match av.cmp(&bv) {
                        std::cmp::Ordering::Equal => continue,
                        o => return o,
                    }
                }
                match ac.cmp(&bc) {
                    std::cmp::Ordering::Equal => {
                        ai.next();
                        bi.next();
                    }
                    o => return o,
                }
            }
        }
    }
}

/// Đọc ĐÚNG 1 trang ảnh trong CBZ, trả về data URL base64.
/// File gốc không bao giờ bị copy hay sửa.
/// Dùng chỉ mục đã cache (xem cbz_entries) + `by_index` thẳng tới entry —
/// không quét lại file, không tìm tên tuyến tính như trước v0.3.2.
#[tauri::command]
fn cbz_page(state: State<AppState>, path: String, index: usize) -> Result<CbzPage, String> {
    let entries = cbz_entries(&state, &path)?;
    let total = entries.len();
    let (archive_idx, name) = entries
        .get(index)
        .ok_or("Trang không tồn tại")?
        .clone();
    drop(entries);
    let buf = read_cbz_entry(&path, archive_idx)?;
    let mime = match ext_of(Path::new(&name)).as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        _ => "image/jpeg",
    };
    Ok(CbzPage {
        data_url: format!("data:{};base64,{}", mime, B64.encode(&buf)),
        name,
        index,
        total,
    })
}

/// Đọc 1 đoạn byte bất kỳ trong file local (dùng cho EPUB/CBZ range, và để
/// frontend tự giải nén khi cần). Trả base64, không copy file.
#[tauri::command]
fn read_range(path: String, offset: u64, length: u64) -> Result<String, String> {
    let mut f = File::open(&path).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; length as usize];
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok(B64.encode(&buf))
}

// ---------- EPUB: chỉ đọc trong RAM ----------

#[tauri::command]
fn epub_toc(path: String) -> Result<Vec<epub::Chapter>, String> {
    epub::toc(&path)
}

#[tauri::command]
fn epub_chapter(path: String, href: String) -> Result<String, String> {
    epub::chapter_html(&path, &href)
}

// ---------- history (SQLite, xem history.rs) ----------

#[tauri::command]
fn history_list(state: State<AppState>) -> Result<Vec<HistoryEntry>, String> {
    let p = state.db_path.lock().unwrap().clone();
    history::list(&p)
}

#[tauri::command]
fn history_save(state: State<AppState>, entry: HistorySave) -> Result<(), String> {
    let p = state.db_path.lock().unwrap().clone();
    history::save(&p, entry)
}

#[tauri::command]
fn history_bookmark(state: State<AppState>, b: Bookmark) -> Result<(), String> {
    let p = state.db_path.lock().unwrap().clone();
    history::add_bookmark(&p, b)
}

#[tauri::command]
fn bookmarks_list(state: State<AppState>, book_id: String) -> Result<Vec<BookmarkOut>, String> {
    let p = state.db_path.lock().unwrap().clone();
    history::list_bookmarks(&p, &book_id)
}

#[tauri::command]
fn bookmark_delete(state: State<AppState>, id: i64) -> Result<(), String> {
    let p = state.db_path.lock().unwrap().clone();
    history::delete_bookmark(&p, id)
}

#[tauri::command]
fn bookmarks_book_count(state: State<AppState>) -> Result<i64, String> {
    let p = state.db_path.lock().unwrap().clone();
    history::bookmarks_book_count(&p)
}

#[tauri::command]
fn highlight_add(state: State<AppState>, h: HighlightNew) -> Result<i64, String> {
    let p = state.db_path.lock().unwrap().clone();
    history::add_highlight(&p, h)
}

#[tauri::command]
fn highlights_list(state: State<AppState>, book_id: String) -> Result<Vec<Highlight>, String> {
    let p = state.db_path.lock().unwrap().clone();
    history::list_highlights(&p, &book_id)
}

#[tauri::command]
fn highlight_delete(state: State<AppState>, id: i64) -> Result<(), String> {
    let p = state.db_path.lock().unwrap().clone();
    history::delete_highlight(&p, id)
}

#[tauri::command]
fn history_settings_get(state: State<AppState>, book_id: String) -> Result<Option<String>, String> {
    let p = state.db_path.lock().unwrap().clone();
    history::load_settings(&p, &book_id)
}

#[tauri::command]
fn history_settings_save(
    state: State<AppState>,
    book_id: String,
    settings: String,
) -> Result<(), String> {
    let p = state.db_path.lock().unwrap().clone();
    history::save_settings(&p, &book_id, &settings)
}

#[tauri::command]
fn history_relink(
    state: State<AppState>,
    old_id: String,
    new_path: String,
) -> Result<(), String> {
    let p = state.db_path.lock().unwrap().clone();
    history::relink(&p, &old_id, &new_path)
}

#[tauri::command]
fn history_delete(state: State<AppState>, id: String) -> Result<(), String> {
    let p = state.db_path.lock().unwrap().clone();
    history::delete(&p, &id)
}

// ---------- P2: thống kê đọc ----------

#[tauri::command]
fn stats_session(state: State<AppState>, s: StatsSession) -> Result<(), String> {
    let p = state.db_path.lock().unwrap().clone();
    history::record_session(&p, s)
}

#[tauri::command]
fn stats_summary(state: State<AppState>) -> Result<StatsSummary, String> {
    let p = state.db_path.lock().unwrap().clone();
    history::stats_summary(&p)
}

#[tauri::command]
fn stats_per_book(state: State<AppState>) -> Result<Vec<StatsPerBook>, String> {
    let p = state.db_path.lock().unwrap().clone();
    history::stats_per_book(&p)
}

// ---------- P2: OPDS — ghi file sách đã tải về (frontend tải qua fetch,
// Rust chỉ ghi bytes ra đĩa; không copy gì vào app) ----------

#[tauri::command]
fn write_file_bytes(path: String, b64: String) -> Result<u64, String> {
    let bytes = B64.decode(&b64).map_err(|e| e.to_string())?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

// ---------- custom protocol mio-page:// (v0.3.9) ----------
//
// Trang ảnh CBZ nạp qua URL thật thay vì base64 qua invoke: WebView
// load ảnh như ảnh web bình thường (bất đồng bộ, cache theo URL, giải
// mã ngoài luồng chính) — đúng mô hình blob URL của bản web mà Thiện
// khen mượt. Không có base64 (+33%), không có chuỗi JSON vài MB qua
// cầu invoke, không giải mã lại khi lật tới-lui cùng trang.
//
// URL: mio-page://cbz/<đường dẫn file đã encodeURIComponent>/<số trang>
// Handler KHÔNG dùng AppState (không phụ thuộc API UriSchemeContext):
// mỗi request quét lại central directory của ZIP (vài ms, trên luồng
// nền của WebView) rồi đọc đúng 1 entry — cùng hàm scan_cbz_entries
// và read_cbz_entry với lệnh cbz_index/cbz_page nên thứ tự trang
// giống hệt nhau, không lệch nhãn/ảnh.
// Nếu protocol lỗi (vd file đã đổi/xóa), frontend dùng fallback base64
// qua lệnh cbz_page (xem ReaderPage.fallback) — trang vẫn hiện.

/// Giải mã percent-encoding (đường dẫn đã encodeURIComponent ở frontend).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Phục vụ 1 trang ảnh CBZ cho custom protocol. Trả 404 khi sách hoặc
/// trang không còn tồn tại (frontend sẽ dùng fallback base64).
fn page_response(uri: &http::Uri) -> http::Response<Vec<u8>> {
    let err = |status: http::StatusCode, msg: &str| {
        http::Response::builder()
            .status(status)
            .header("content-type", "text/plain; charset=utf-8")
            .body(msg.as_bytes().to_vec())
            .unwrap()
    };
    // mio-page://cbz/<encoded-path>/<index> -> path() = "/<encoded>/<index>"
    let path = uri.path();
    let Some(rest) = path.strip_prefix('/') else {
        return err(http::StatusCode::BAD_REQUEST, "bad page url");
    };
    let Some(after_kind) = rest.strip_prefix("cbz/") else {
        return err(http::StatusCode::NOT_FOUND, "unknown page source");
    };
    let Some(slash) = after_kind.rfind('/') else {
        return err(http::StatusCode::BAD_REQUEST, "bad page url");
    };
    let (enc_path, idx_str) = (&after_kind[..slash], &after_kind[slash + 1..]);
    let Ok(index) = idx_str.parse::<usize>() else {
        return err(http::StatusCode::BAD_REQUEST, "bad page index");
    };
    let file_path = percent_decode(enc_path);
    let entries = match scan_cbz_entries(&file_path) {
        Ok(e) => e,
        Err(_) => return err(http::StatusCode::NOT_FOUND, "book not found"),
    };
    let Some((archive_idx, name)) = entries.get(index) else {
        return err(http::StatusCode::NOT_FOUND, "page not found");
    };
    let (archive_idx, name) = (*archive_idx, name.clone());
    let mime = match ext_of(Path::new(&name)).as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        _ => "image/jpeg",
    };
    let bytes = match read_cbz_entry(&file_path, archive_idx) {
        Ok(b) => b,
        Err(_) => return err(http::StatusCode::NOT_FOUND, "page not found"),
    };
    http::Response::builder()
        .header("content-type", mime)
        // Ảnh trang được cache theo URL: lật tới-lui không tải lại.
        .header("cache-control", "public, max-age=86400")
        // Cho fetch() (vd thu nhỏ thumbnail) đọc được từ origin tauri://.
        .header("access-control-allow-origin", "*")
        .body(bytes)
        .unwrap()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // v0.3.9: trang ảnh CBZ nạp qua URL thật (mio-page://) thay vì
        // base64 qua invoke — xem page_response ở trên.
        .register_uri_scheme_protocol("mio-page", |_ctx, request| {
            page_response(request.uri())
        })
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("không lấy được thư mục dữ liệu app");
            std::fs::create_dir_all(&dir).ok();
            let db_path = dir.join("history.sqlite3");
            db::init(&db_path).expect("không khởi tạo được SQLite");
            app.manage(AppState {
                db_path: Mutex::new(db_path),
                cbz_cache: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_file_app,
            pick_folder_app,
            file_metadata,
            list_books,
            list_folder,
            cbz_index,
            cbz_page,
            read_range,
            epub_toc,
            epub_chapter,
            history_list,
            history_save,
            history_bookmark,
            bookmarks_list,
            bookmark_delete,
            bookmarks_book_count,
            highlight_add,
            highlights_list,
            highlight_delete,
            history_settings_get,
            history_settings_save,
            history_relink,
            history_delete,
            stats_session,
            stats_summary,
            stats_per_book,
            write_file_bytes
        ])
        .run(tauri::generate_context!())
        .expect("lỗi khi chạy app Tauri");
}

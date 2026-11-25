#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
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

use history::{Bookmark, HistoryEntry, HistorySave};

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

// ---------- CBZ: đọc lười từng trang ----------

/// Đọc chỉ mục ZIP: chỉ tên file ảnh, sắp xếp tự nhiên (page1, page2, page10...).
/// Không giải nén gì cả.
#[tauri::command]
fn cbz_index(path: String) -> Result<Vec<String>, String> {
    let f = File::open(&path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .filter(|n| {
            let lower = n.to_lowercase();
            IMAGE_EXTS.iter().any(|e| lower.ends_with(e))
                && !lower.contains("__macosx")
                && !lower.ends_with("comicinfo.xml")
        })
        .collect();
    names.sort_by(|a, b| natural_cmp(a, b));
    Ok(names)
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
#[tauri::command]
fn cbz_page(path: String, index: usize) -> Result<CbzPage, String> {
    let names = cbz_index(path.clone())?;
    let name = names.get(index).ok_or("Trang không tồn tại")?.clone();
    let f = File::open(&path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut entry = zip.by_name(&name).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
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
        total: names.len(),
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_file_app,
            pick_folder_app,
            file_metadata,
            list_books,
            cbz_index,
            cbz_page,
            read_range,
            epub_toc,
            epub_chapter,
            history_list,
            history_save,
            history_bookmark,
            history_relink,
            history_delete
        ])
        .run(tauri::generate_context!())
        .expect("lỗi khi chạy app Tauri");
}

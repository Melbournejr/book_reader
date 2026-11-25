use rusqlite::Connection;
use std::path::Path;

/// Khởi tạo SQLite local. File DB nằm trong thư mục dữ liệu của app
/// (Windows: %APPDATA%\vn.thien.doc-sach\), chỉ chứa metadata + vị trí đọc.
pub fn init(path: &Path) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,          -- 'local' | 'telegram'
            path TEXT,                      -- đường dẫn local, null nếu nguồn Telegram
            telegram_file_id TEXT,          -- file_id Telegram, null nếu local
            telegram_msg_id INTEGER,
            title TEXT NOT NULL,
            format TEXT NOT NULL,           -- cbz | epub | pdf | mobi
            current_page INTEGER NOT NULL DEFAULT 0,
            total_pages INTEGER NOT NULL DEFAULT 0,
            chapter TEXT,
            percent REAL NOT NULL DEFAULT 0,
            last_read INTEGER NOT NULL,     -- epoch ms
            status TEXT NOT NULL DEFAULT 'reading' -- reading | done
        );
        CREATE TABLE IF NOT EXISTS bookmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id TEXT NOT NULL,
            page INTEGER NOT NULL,
            chapter TEXT,
            note TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS highlights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id TEXT NOT NULL,
            page INTEGER NOT NULL,       -- chỉ số chương/trang (EPUB/MOBI)
            chapter TEXT,                -- tên chương lúc gạch, để hiển thị
            color TEXT NOT NULL DEFAULT 'yellow',
            text TEXT NOT NULL,          -- đoạn chữ đã gạch
            note TEXT,                   -- ghi chú kèm theo (tùy chọn)
            start_off INTEGER NOT NULL DEFAULT 0, -- vị trí bắt đầu trong text chương
            end_off INTEGER NOT NULL DEFAULT 0,   -- vị trí kết thúc trong text chương
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_history_last_read ON history(last_read DESC);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
        CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
",
    )
    .map_err(|e| e.to_string())?;
    // Cột settings (JSON: zoom/fit/crop/2-trang...) thêm sau cho DB đã tạo
    // từ bản trước — ALTER lỗi nếu cột đã có thì bỏ qua, không chặn app.
    let _ = conn.execute("ALTER TABLE history ADD COLUMN settings TEXT", rusqlite::params![]);
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection, String> {
    Connection::open(path).map_err(|e| e.to_string())
}

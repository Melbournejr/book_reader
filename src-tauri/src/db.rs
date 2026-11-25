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
        CREATE INDEX IF NOT EXISTS idx_history_last_read ON history(last_read DESC);",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection, String> {
    Connection::open(path).map_err(|e| e.to_string())
}

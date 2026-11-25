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
        -- P2: thống kê đọc — mỗi dòng là 1 phiên đọc (mở sách -> đóng sách).
        -- Ghi khi đóng sách: giây đọc, số trang lật được, có đọc hết sách không.
        -- Không có cột "ngày" riêng: ngày tính từ started_at (epoch ms).
        CREATE TABLE IF NOT EXISTS reading_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id TEXT NOT NULL,
            started_at INTEGER NOT NULL, -- epoch ms lúc mở sách
            ended_at INTEGER NOT NULL,   -- epoch ms lúc đóng sách
            seconds INTEGER NOT NULL DEFAULT 0,
            pages_read INTEGER NOT NULL DEFAULT 0,
            finished INTEGER NOT NULL DEFAULT 0 -- 1 = phiên này đọc tới trang cuối
        );
        CREATE INDEX IF NOT EXISTS idx_history_last_read ON history(last_read DESC);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
        CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_book ON reading_sessions(book_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_started ON reading_sessions(started_at);",
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

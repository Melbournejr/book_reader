use crate::db;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: String,
    pub source: String,
    pub path: Option<String>,
    pub telegram_file_id: Option<String>,
    pub telegram_msg_id: Option<i64>,
    pub title: String,
    pub format: String,
    pub current_page: i64,
    pub total_pages: i64,
    pub chapter: Option<String>,
    pub percent: f64,
    pub last_read: i64,
    pub status: String,
    /// Frontend tự kiểm tra: file local còn tồn tại không.
    /// Nếu false -> hiển thị "mất file, chỉ lại đường dẫn".
    pub file_exists: bool,
}

#[derive(Debug, Deserialize)]
pub struct HistorySave {
    pub id: String,
    pub source: String,
    pub path: Option<String>,
    pub telegram_file_id: Option<String>,
    pub telegram_msg_id: Option<i64>,
    pub title: String,
    pub format: String,
    pub current_page: i64,
    pub total_pages: i64,
    pub chapter: Option<String>,
    pub percent: f64,
    pub last_read: i64,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct Bookmark {
    pub book_id: String,
    pub page: i64,
    pub chapter: Option<String>,
    pub note: Option<String>,
    pub created_at: i64,
}

pub fn list(db_path: &Path) -> Result<Vec<HistoryEntry>, String> {
    let conn = db::open(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, source, path, telegram_file_id, telegram_msg_id, title, format,
                    current_page, total_pages, chapter, percent, last_read, status
             FROM history ORDER BY last_read DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let path: Option<String> = r.get(2)?;
            let file_exists = match &path {
                Some(p) => Path::new(p).exists(),
                None => true, // nguồn Telegram: không kiểm tra local
            };
            Ok(HistoryEntry {
                id: r.get(0)?,
                source: r.get(1)?,
                path,
                telegram_file_id: r.get(3)?,
                telegram_msg_id: r.get(4)?,
                title: r.get(5)?,
                format: r.get(6)?,
                current_page: r.get(7)?,
                total_pages: r.get(8)?,
                chapter: r.get(9)?,
                percent: r.get(10)?,
                last_read: r.get(11)?,
                status: r.get(12)?,
                file_exists,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn save(db_path: &Path, e: HistorySave) -> Result<(), String> {
    let conn = db::open(db_path)?;
    conn.execute(
        "INSERT INTO history
            (id, source, path, telegram_file_id, telegram_msg_id, title, format,
             current_page, total_pages, chapter, percent, last_read, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
            current_page = excluded.current_page,
            total_pages = excluded.total_pages,
            chapter = excluded.chapter,
            percent = excluded.percent,
            last_read = excluded.last_read,
            status = excluded.status,
            path = excluded.path",
        rusqlite::params![
            e.id, e.source, e.path, e.telegram_file_id, e.telegram_msg_id, e.title, e.format,
            e.current_page, e.total_pages, e.chapter, e.percent, e.last_read, e.status
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn add_bookmark(db_path: &Path, b: Bookmark) -> Result<(), String> {
    let conn = db::open(db_path)?;
    conn.execute(
        "INSERT INTO bookmarks (book_id, page, chapter, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![b.book_id, b.page, b.chapter, b.note, b.created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// File local bị đổi tên / dời chỗ: chỉ lại đường dẫn mới, giữ nguyên lịch sử.
pub fn relink(db_path: &Path, old_id: &str, new_path: &str) -> Result<(), String> {
    let conn = db::open(db_path)?;
    conn.execute(
        "UPDATE history SET path = ?2 WHERE id = ?1",
        rusqlite::params![old_id, new_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete(db_path: &Path, id: &str) -> Result<(), String> {
    let conn = db::open(db_path)?;
    conn.execute("DELETE FROM history WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM bookmarks WHERE book_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

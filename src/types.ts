export type Source = "local" | "telegram";

export interface BookMeta {
  path: string;
  name: string;
  format: string; // cbz | cbr | epub | pdf | mobi
  size: number;
  modified: number;
  id: string;
}

export interface HistoryEntry {
  id: string;
  source: Source;
  path?: string | null;
  telegram_file_id?: string | null;
  telegram_msg_id?: number | null;
  title: string;
  format: string;
  current_page: number;
  total_pages: number;
  chapter?: string | null;
  percent: number;
  last_read: number;
  status: string;
  file_exists: boolean;
}

export interface TelegramFile {
  msg_id: number;
  file_id: string;
  name: string;
  size: number;
  mime: string;
  date: number;
}

export interface Chapter {
  title: string;
  href: string;
}

/** 1 bookmark đã lưu trong SQLite (bảng bookmarks). */
export interface Bookmark {
  id: number;
  book_id: string;
  page: number;
  chapter?: string | null;
  note?: string | null;
  created_at: number;
}

/** 1 đoạn gạch chân đã lưu (bảng highlights, chỉ EPUB/MOBI). */
export interface Highlight {
  id: number;
  book_id: string;
  page: number;
  chapter?: string | null;
  color: string; // yellow | pink | green | blue
  text: string;
  note?: string | null;
  start_off: number; // vị trí bắt đầu trong text thuần của chương
  end_off: number;
  created_at: number;
}

/** 1 phiên đọc (bảng reading_sessions, P2): ghi khi đóng sách. */
export interface StatsSession {
  book_id: string;
  started_at: number; // epoch ms lúc mở sách
  ended_at: number; // epoch ms lúc đóng sách
  seconds: number;
  pages_read: number;
  finished: number; // 0 | 1 — phiên này đọc tới trang cuối
}

/** Tổng thống kê toàn app. `days` = các số ngày UTC đã đọc
 * (started_at / 86_400_000); streak tính ở frontend từ danh sách này. */
export interface StatsSummary {
  total_seconds: number;
  total_pages: number;
  total_sessions: number;
  books_finished: number;
  days: number[];
}

/** Thống kê theo từng cuốn (kể cả cuốn chưa có phiên nào: toàn 0). */
export interface StatsPerBook {
  book_id: string;
  title: string;
  seconds: number;
  pages: number;
  sessions: number;
  finished: number; // 0 | 1 — đã từng đọc hết cuốn này chưa
  last_read: number;
}

/** Hộp bao quanh 1 từ/cụm trong trang PDF (hệ tọa độ viewport scale 1). */
export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 1 kết quả tìm trong sách. */
export interface SearchResult {
  page: number;
  label: string;
  snippet: string;
  /** PDF: các hộp chữ khớp để vẽ highlight lên trang khi nhảy tới. */
  rects?: PdfRect[];
}

/** Lề cắt từng phía, tính theo % bề rộng/cao của trang ảnh. */
export interface CropMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Cài đặt riêng từng cuốn, lưu JSON trong history.settings. */
export interface ReaderSettings {
  zoom?: number; // hệ số zoom so với vừa trang, 0.5–3, mặc định 1
  fit?: "page" | "width" | "height"; // mặc định "page"
  crop?: CropMargins;
  twoPage?: boolean; // nhớ chế độ 1/2 trang của cuốn này
  rtl?: boolean; // nhớ chế độ manga phải → trái của cuốn này
}

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#ffe066",
  pink: "#ffb3c7",
  green: "#b7f0b1",
  blue: "#a8d8ff",
};

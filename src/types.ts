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

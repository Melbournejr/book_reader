import { invoke } from "@tauri-apps/api/core";
import type {
  Bookmark,
  BookMeta,
  Chapter,
  Highlight,
  HistoryEntry,
  StatsPerBook,
  StatsSummary,
} from "../types";

export const api = {
  pickFile: () => invoke<string | null>("pick_file_app"),
  pickFolder: () => invoke<string | null>("pick_folder_app"),
  listBooks: (folder: string) => invoke<BookMeta[]>("list_books", { folder }),
  fileMetadata: (path: string) => invoke<BookMeta>("file_metadata", { path }),
  cbzIndex: (path: string) => invoke<string[]>("cbz_index", { path }),
  cbzPage: (path: string, index: number) =>
    invoke<{ name: string; index: number; total: number; data_url: string }>(
      "cbz_page",
      { path, index },
    ),
  readRange: (path: string, offset: number, length: number) =>
    invoke<string>("read_range", { path, offset, length }),
  epubToc: (path: string) => invoke<Chapter[]>("epub_toc", { path }),
  epubChapter: (path: string, href: string) =>
    invoke<string>("epub_chapter", { path, href }),
  historyList: () => invoke<HistoryEntry[]>("history_list"),
  historySave: (entry: Record<string, unknown>) =>
    invoke("history_save", { entry }),
  historyRelink: (oldId: string, newPath: string) =>
    invoke("history_relink", { oldId, newPath }),
  historyDelete: (id: string) => invoke("history_delete", { id }),
  bookmarkAdd: (b: {
    book_id: string;
    page: number;
    chapter: string | null;
    note: string | null;
    created_at: number;
  }) => invoke("history_bookmark", { b }),
  bookmarksList: (bookId: string) =>
    invoke<Bookmark[]>("bookmarks_list", { book_id: bookId }),
  bookmarkDelete: (id: number) => invoke("bookmark_delete", { id }),
  highlightAdd: (h: {
    book_id: string;
    page: number;
    chapter: string | null;
    color: string;
    text: string;
    note: string | null;
    start_off: number;
    end_off: number;
    created_at: number;
  }) => invoke<number>("highlight_add", { h }),
  highlightsList: (bookId: string) =>
    invoke<Highlight[]>("highlights_list", { book_id: bookId }),
  highlightDelete: (id: number) => invoke("highlight_delete", { id }),
  historySettingsGet: (bookId: string) =>
    invoke<string | null>("history_settings_get", { book_id: bookId }),
  historySettingsSave: (bookId: string, settings: string) =>
    invoke("history_settings_save", { book_id: bookId, settings }),
  statsSession: (s: {
    book_id: string;
    started_at: number;
    ended_at: number;
    seconds: number;
    pages_read: number;
    finished: number;
  }) => invoke("stats_session", { s }),
  statsSummary: () => invoke<StatsSummary>("stats_summary"),
  statsPerBook: () => invoke<StatsPerBook[]>("stats_per_book"),
  saveBytes: (path: string, b64: string) =>
    invoke<number>("write_file_bytes", { path, b64 }),
};

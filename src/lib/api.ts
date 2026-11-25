import { invoke } from "@tauri-apps/api/core";
import type { BookMeta, Chapter, HistoryEntry } from "../types";

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
};

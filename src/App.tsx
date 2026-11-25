import { useCallback, useEffect, useState } from "react";
import type { TelegramClient } from "telegram";
import { api } from "./lib/api";
import { telegramCbzIndex, telegramCbzPage } from "./lib/telegram";
import type { BookMeta, HistoryEntry, TelegramFile } from "./types";
import Library from "./components/Library";
import Reader, { type ReaderPage } from "./components/Reader";
import TelegramPanel from "./components/TelegramPanel";
import UpdateBanner from "./components/UpdateBanner";

type OpenBook =
  | { kind: "local"; meta: BookMeta; startPage: number }
  | { kind: "telegram"; file: TelegramFile; client: TelegramClient; startPage: number }
  | null;

export default function App() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [localBooks, setLocalBooks] = useState<BookMeta[]>([]);
  const [open, setOpen] = useState<OpenBook>(null);
  const [pages, setPages] = useState<ReaderPage[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState("");
  const [rtl, setRtl] = useState(false);

  const reloadHistory = useCallback(async () => {
    try {
      setHistory(await api.historyList());
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void reloadHistory();
  }, [reloadHistory]);

  const saveProgress = useCallback(
    async (id: string, page: number, totalPages: number, extra: Partial<HistoryEntry> = {}) => {
      const entry = history.find((h) => h.id === id);
      const base: Record<string, unknown> = {
        id,
        source: extra.source ?? entry?.source ?? "local",
        path: extra.path ?? entry?.path ?? null,
        telegram_file_id: extra.telegram_file_id ?? entry?.telegram_file_id ?? null,
        telegram_msg_id: extra.telegram_msg_id ?? entry?.telegram_msg_id ?? null,
        title: extra.title ?? entry?.title ?? title,
        format: extra.format ?? entry?.format ?? "cbz",
        current_page: page,
        total_pages: totalPages,
        chapter: extra.chapter ?? entry?.chapter ?? null,
        percent: totalPages > 0 ? page / Math.max(1, totalPages - 1) : 0,
        last_read: Date.now(),
        status: page >= totalPages - 1 && totalPages > 0 ? "done" : "reading",
      };
      await api.historySave(base);
      void reloadHistory();
    },
    [history, title],
  );

  // ---- Mở sách local: CBZ đọc lười từng trang, EPUB đọc chương trong RAM ----
  const openLocal = async (meta: BookMeta, startPage = 0) => {
    setLoading(`Đang mở ${meta.name}…`);
    try {
      if (meta.format === "cbz") {
        const names = await api.cbzIndex(meta.path);
        const total = names.length;
        // Nạp trước trang đầu + 2 trang kề, còn lại nạp khi lật tới.
        const load = async (i: number): Promise<ReaderPage> => {
          const p = await api.cbzPage(meta.path, i);
          return { content: p.data_url, isImage: true, label: names[i] };
        };
        const first = await Promise.all(
          [startPage, startPage + 1, startPage + 2]
            .filter((i) => i < total)
            .map(load),
        );
        // Reader nhận danh sách đầy đủ bằng lazy loader: ở scaffold này nạp
        // trước 3 trang, các trang sau nạp khi lật (xem README — cần hoàn thiện
        // lazy loader cho CBZ 2028 trang trước khi dùng thật).
        setPages(first);
        setTitle(meta.name);
        setOpen({ kind: "local", meta, startPage });
        await saveProgress(meta.id, startPage, total, {
          source: "local",
          path: meta.path,
          title: meta.name,
          format: "cbz",
        });
      } else if (meta.format === "epub") {
        const toc = await api.epubToc(meta.path);
        const loaded: ReaderPage[] = [];
        for (const ch of toc) {
          const html = await api.epubChapter(meta.path, ch.href);
          loaded.push({ content: html, isImage: false, label: ch.title });
        }
        setPages(loaded);
        setTitle(meta.name);
        setOpen({ kind: "local", meta, startPage });
        await saveProgress(meta.id, startPage, loaded.length, {
          source: "local",
          path: meta.path,
          title: meta.name,
          format: "epub",
        });
      } else {
        setLoading(`Định dạng ${meta.format.toUpperCase()} ở bản scaffold này chỉ mở xem metadata — PDF/MOBI lật trang sẽ thêm sau (xem README).`);
        return;
      }
    } catch (e) {
      setLoading(`Lỗi mở sách: ${String(e)}`);
    } finally {
      setLoading("");
    }
  };

  // ---- Mở sách trên Telegram: tải chỉ mục ZIP từ đuôi file, rồi từng trang ----
  const openTelegram = async (file: TelegramFile, client: TelegramClient) => {
    setLoading(`Đang mở ${file.name} từ Telegram…`);
    try {
      const entries = await telegramCbzIndex(client, file);
      const first = await Promise.all(
        entries.slice(0, 3).map(async (e) => ({
          content: await telegramCbzPage(client, file, e),
          isImage: true,
          label: e.name,
        })),
      );
      setPages(first);
      setTitle(file.name);
      setOpen({ kind: "telegram", file, client, startPage: 0 });
      const id = `tg:${file.file_id}`;
      await saveProgress(id, 0, entries.length, {
        source: "telegram",
        telegram_file_id: file.file_id,
        telegram_msg_id: file.msg_id,
        title: file.name,
        format: "cbz",
      });
    } catch (e) {
      setLoading(`Lỗi mở file Telegram: ${String(e)} — xem README mục "Telegram: phần rủi ro nhất".`);
    } finally {
      setLoading("");
    }
  };

  const resume = async (h: HistoryEntry) => {
    if (h.source === "local" && h.path) {
      const meta = await api.fileMetadata(h.path);
      await openLocal(meta, h.current_page);
    } else {
      setLoading("Sách Telegram: mở lại từ tab Telegram bên dưới để tải trang theo byte-range.");
    }
  };

  const relink = async (h: HistoryEntry) => {
    const p = await api.pickFile();
    if (p) {
      await api.historyRelink(h.id, p);
      void reloadHistory();
    }
  };

  return (
    <main>
      <header className="topbar">
        <h1>Phần Mềm Đọc Sách</h1>
        <label>
          <input type="checkbox" checked={rtl} onChange={(e) => setRtl(e.target.checked)} />
          Manga phải → trái
        </label>
      </header>
      {loading && <p className="status">{loading}</p>}
      <UpdateBanner />
      {open ? (
        <Reader
          title={title}
          pages={pages}
          startPage={open.startPage}
          rtl={rtl}
          onProgress={(page, total) => {
            const id =
              open.kind === "local" ? open.meta.id : `tg:${open.file.file_id}`;
            void saveProgress(id, page, total);
          }}
          onClose={() => {
            setOpen(null);
            setPages([]);
            void reloadHistory();
          }}
        />
      ) : (
        <>
          <Library
            history={history}
            localBooks={localBooks}
            onOpenLocal={(b) => void openLocal(b)}
            onResume={(h) => void resume(h)}
            onRelink={(h) => void relink(h)}
            onRemoveHistory={(id) => {
              void api.historyDelete(id).then(() => reloadHistory());
            }}
            onPickFile={async () => {
              const p = await api.pickFile();
              if (p) {
                const meta = await api.fileMetadata(p);
                await openLocal(meta);
              }
            }}
            onPickFolder={async () => {
              const f = await api.pickFolder();
              if (f) setLocalBooks(await api.listBooks(f));
            }}
          />
          <TelegramPanel onOpenTelegramBook={(f, c) => void openTelegram(f, c)} />
        </>
      )}
    </main>
  );
}

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { TelegramClient } from "telegram";
import { api } from "./lib/api";
import type { BookMeta, HistoryEntry, TelegramFile } from "./types";
import Library from "./components/Library";
import Reader, { type ReaderPage } from "./components/Reader";
import UpdateBanner from "./components/UpdateBanner";
import { parseMobi } from "./lib/mobi";
import { readFileBytes } from "./lib/files";

// Telegram (GramJS) KHÔNG import tĩnh ở đây: GramJS cần Node (net/socket)
// mà WebView của Tauri không có, import tĩnh làm cả app trắng màn hình
// (bản 0.1.0). Panel Telegram chỉ nạp khi mở tab, qua dynamic import.
const TelegramPanel = lazy(() => import("./components/TelegramPanel"));

type OpenBook =
  | { kind: "local"; meta: BookMeta; startPage: number }
  | { kind: "telegram"; file: TelegramFile; client: TelegramClient; startPage: number }
  | null;

export default function App() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [localBooks, setLocalBooks] = useState<BookMeta[]>([]);
  const [open, setOpen] = useState<OpenBook>(null);
  const [reader, setReader] = useState<{
    total: number;
    initialPages: (ReaderPage | null)[];
    loadPage: (i: number) => Promise<ReaderPage>;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState("");
  const [rtl, setRtl] = useState(false);
  /** Dọn dẹp sách đang mở (đóng PDF...) khi thoát khỏi trình đọc. */
  const cleanupRef = useRef<(() => void) | null>(null);

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

  // Dịch mã lỗi từ các bộ đọc (PDF/MOBI/CBR) thành câu báo rõ cho người đọc.
  const friendlyOpenError = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("PDF_MAT_KHAU"))
      return "File PDF này có mật khẩu — app chưa mở được PDF có mật khẩu.";
    if (msg.includes("MOBI_DRM"))
      return "File MOBI/AZW3 này có DRM — app không mở được sách có DRM.";
    if (msg.includes("MOBI_HUFF"))
      return "File MOBI này dùng nén Huff/CDIC — app chưa hỗ trợ, chỉ đọc được nén PalmDOC/không nén.";
    if (msg.includes("MOBI_KF8"))
      return "File AZW3 này chỉ có phần KF8 — app chưa đọc được, chỉ đọc được file có phần Mobi7.";
    if (msg.includes("MOBI_KHONG_HOP_LE"))
      return "File này không phải MOBI/AZW3 hợp lệ.";
    if (msg.includes("CBR_MA_KHAU"))
      return "File RAR này có mật khẩu — app chưa mở được RAR có mật khẩu.";
    if (msg.includes("CBR_TAP"))
      return "File RAR này chia nhiều tập — app chưa mở được RAR nhiều tập, gom lại 1 file rồi mở.";
    if (msg.includes("CBR_KHONG_CO_ANH"))
      return "File RAR này không có ảnh truyện nào bên trong.";
    if (msg.includes("CBR_KHONG_MO_DUOC"))
      return "Không mở được file RAR này (file hỏng hoặc định dạng lạ).";
    if (msg.includes("CBR_WASM"))
      return "Không nạp được bộ giải nén RAR — thử mở lại app.";
    return msg;
  };

  // ---- Mở sách local: CBZ/CBR đọc lười từng trang, EPUB/MOBI đọc chương,
  // PDF render từng trang qua pdf.js (range transport, không nạp cả file) ----
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
        // Mảng thưa: chỉ 3 trang đầu có sẵn, các trang sau Reader nạp lười
        // qua loadPage khi lật tới — đọc được tới trang cuối của CBZ 2028 trang.
        const initialPages: (ReaderPage | null)[] = Array(total).fill(null);
        first.forEach((p, k) => {
          initialPages[startPage + k] = p;
        });
        setReader({ total, initialPages, loadPage: load });
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
        setReader({
          total: loaded.length,
          initialPages: loaded,
          loadPage: async (i) => loaded[i],
        });
        setTitle(meta.name);
        setOpen({ kind: "local", meta, startPage });
        await saveProgress(meta.id, startPage, loaded.length, {
          source: "local",
          path: meta.path,
          title: meta.name,
          format: "epub",
        });
      } else if (meta.format === "pdf") {
        // pdf.js nặng (~500KB) nên chỉ nạp khi mở PDF, như GramJS chỉ nạp
        // khi mở tab Telegram — app mở lên vẫn nhẹ.
        const { openPdf, setupPdfWorker } = await import("./lib/pdf");
        setupPdfWorker();
        const book = await openPdf(meta.path, meta.size);
        cleanupRef.current = book.close;
        const total = book.numPages;
        const load = (i: number) => book.renderPage(i);
        const first = await Promise.all(
          [startPage, startPage + 1, startPage + 2]
            .filter((i) => i < total)
            .map(load),
        );
        const initialPages: (ReaderPage | null)[] = Array(total).fill(null);
        first.forEach((p, k) => {
          initialPages[startPage + k] = p;
        });
        setReader({ total, initialPages, loadPage: load });
        setTitle(meta.name);
        setOpen({ kind: "local", meta, startPage });
        await saveProgress(meta.id, startPage, total, {
          source: "local",
          path: meta.path,
          title: meta.name,
          format: "pdf",
        });
      } else if (meta.format === "mobi") {
        const bytes = await readFileBytes(meta.path, meta.size);
        const book = parseMobi(bytes, meta.name);
        const total = book.pages.length;
        setReader({
          total,
          initialPages: book.pages,
          loadPage: async (i) => book.pages[i],
        });
        setTitle(book.title);
        setOpen({ kind: "local", meta, startPage });
        await saveProgress(meta.id, startPage, total, {
          source: "local",
          path: meta.path,
          title: book.title,
          format: "mobi",
        });
      } else if (meta.format === "cbr") {
        const { openCbr } = await import("./lib/cbr");
        const bytes = await readFileBytes(meta.path, meta.size);
        const book = await openCbr(bytes);
        const total = book.names.length;
        const load = (i: number) => book.page(i);
        const first = await Promise.all(
          [startPage, startPage + 1, startPage + 2]
            .filter((i) => i < total)
            .map(load),
        );
        const initialPages: (ReaderPage | null)[] = Array(total).fill(null);
        first.forEach((p, k) => {
          initialPages[startPage + k] = p;
        });
        setReader({ total, initialPages, loadPage: load });
        setTitle(meta.name);
        setOpen({ kind: "local", meta, startPage });
        await saveProgress(meta.id, startPage, total, {
          source: "local",
          path: meta.path,
          title: meta.name,
          format: "cbr",
        });
      } else {
        setLoading(`Định dạng ${meta.format.toUpperCase()} chưa hỗ trợ ở bản này.`);
        return;
      }
    } catch (e) {
      setLoading(`Lỗi mở sách: ${friendlyOpenError(e)}`);
    } finally {
      setLoading("");
    }
  };

  // ---- Mở sách trên Telegram: tải chỉ mục ZIP từ đuôi file, rồi từng trang ----
  // Nạp GramJS động ở đây (không import tĩnh): nếu WebView không chạy được
  // GramJS thì chỉ tab Telegram lỗi, thư viện local vẫn đọc bình thường.
  const openTelegram = async (file: TelegramFile, client: TelegramClient) => {
    setLoading(`Đang mở ${file.name} từ Telegram…`);
    try {
      const { telegramCbzIndex, telegramCbzPage } = await import("./lib/telegram");
      const entries = await telegramCbzIndex(client, file);
      const load = async (i: number): Promise<ReaderPage> => ({
        content: await telegramCbzPage(client, file, entries[i]),
        isImage: true,
        label: entries[i].name,
      });
      const first = await Promise.all([0, 1, 2].filter((i) => i < entries.length).map(load));
      const initialPages: (ReaderPage | null)[] = Array(entries.length).fill(null);
      first.forEach((p, k) => {
        initialPages[k] = p;
      });
      setReader({ total: entries.length, initialPages, loadPage: load });
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
        <h1>Mio Reader</h1>
        <label>
          <input type="checkbox" checked={rtl} onChange={(e) => setRtl(e.target.checked)} />
          Manga phải → trái
        </label>
      </header>
      {loading && <p className="status">{loading}</p>}
      <UpdateBanner />
      {open && reader ? (
        <Reader
          title={title}
          total={reader.total}
          initialPages={reader.initialPages}
          loadPage={reader.loadPage}
          startPage={open.startPage}
          rtl={rtl}
          onProgress={(page, total) => {
            const id =
              open.kind === "local" ? open.meta.id : `tg:${open.file.file_id}`;
            void saveProgress(id, page, total);
          }}
          onClose={() => {
            cleanupRef.current?.();
            cleanupRef.current = null;
            setOpen(null);
            setReader(null);
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
          <Suspense fallback={<p className="status">Đang tải tab Telegram…</p>}>
            <TelegramPanel onOpenTelegramBook={(f, c) => void openTelegram(f, c)} />
          </Suspense>
        </>
      )}
    </main>
  );
}

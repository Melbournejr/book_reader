import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TelegramClient } from "telegram";
import { api } from "./lib/api";
import type {
  BookMeta,
  HistoryEntry,
  PdfRect,
  ReaderSettings,
  SearchResult,
  StatsPerBook,
  StatsSummary,
  TelegramFile,
} from "./types";
import Library from "./components/Library";
import Reader, {
  type JumpRequest,
  type ReaderPage,
  type ReaderSearchApi,
  type ReaderThumbApi,
} from "./components/Reader";
import StatsView from "./components/StatsView";
import FolderTree from "./components/FolderTree";
import SourcesView from "./components/SourcesView";
import UpdateBanner from "./components/UpdateBanner";
import { readFileBytes } from "./lib/files";
import { pageUrl } from "./lib/pageUrl";
import { searchTextPages, stripHtml } from "./lib/search";
import { downscaleDataUrl } from "./lib/thumbs";
import { resolveInitialRtl } from "./lib/spread";
import { APP_VERSION } from "./lib/update";

type OpenBook =
  | { kind: "local"; meta: BookMeta; startPage: number }
  | { kind: "telegram"; file: TelegramFile; client: TelegramClient; startPage: number }
  | null;

type Screen = "library" | "folders" | "stats" | "sources";

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function loadStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export default function App() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [localBooks, setLocalBooks] = useState<BookMeta[]>([]);
  const [open, setOpen] = useState<OpenBook>(null);
  const [reader, setReader] = useState<{
    total: number;
    initialPages: (ReaderPage | null)[];
    loadPage: (i: number) => Promise<ReaderPage>;
    searchApi: ReaderSearchApi;
    thumbApi: ReaderThumbApi;
  } | null>(null);
  const [initialSettings, setInitialSettings] = useState<ReaderSettings | null>(null);
  const [jumpRequest, setJumpRequest] = useState<JumpRequest | null>(null);
  /** Trang PDF đang cần vẽ highlight vàng khi nhảy tới kết quả tìm. */
  const pdfHlRef = useRef<{ page: number; rects: PdfRect[] } | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState("");
  /** Mặc định RTL chung cho sách chưa có cài đặt riêng (Cài đặt).
   *  Truyện tranh (CBZ/CBR) thì auto-RTL khi mở, xem resolveInitialRtl. */
  const [rtl, setRtl] = useState(false);
  /** Dọn dẹp sách đang mở (đóng PDF...) khi thoát khỏi trình đọc. */
  const cleanupRef = useRef<(() => void) | null>(null);
  /** P2: TTS cho PDF — text từng trang lấy từ pdf.js (book mở trong openLocal). */
  const ttsTextRef = useRef<((page: number) => Promise<string | null>) | null>(null);
  /** P2: thống kê đọc — 1 phiên = mở sách -> đóng sách (ghi SQLite lúc đóng). */
  const [statsSummary, setStatsSummary] = useState<StatsSummary | null>(null);
  const [statsPerBook, setStatsPerBook] = useState<StatsPerBook[]>([]);
  const sessionRef = useRef<{
    bookId: string;
    startedAt: number;
    startPage: number;
    maxPage: number;
    total: number;
  } | null>(null);

  // ---- v0.3.0: màn hình chính (thư viện / thống kê / nguồn sách) ----
  const [screen, setScreen] = useState<Screen>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localFolder, setLocalFolder] = useState<string | null>(() =>
    loadStored("mio-local-folder"),
  );
  const [opdsPaths, setOpdsPaths] = useState<string[]>(() => {
    try {
      const raw = loadStored("mio-opds-paths");
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const [bookmarkCount, setBookmarkCount] = useState(0);

  const telegramHistory = useMemo(
    () => history.filter((h) => h.source === "telegram"),
    [history],
  );
  const continueBook = useMemo(
    () => history.find((h) => h.status === "reading") ?? null,
    [history],
  );
  const totalSize = useMemo(
    () => localBooks.reduce((a, b) => a + (b.size || 0), 0),
    [localBooks],
  );

  const reloadStats = useCallback(async () => {
    try {
      setStatsSummary(await api.statsSummary());
      setStatsPerBook(await api.statsPerBook());
    } catch {
      setStatsSummary(null);
      setStatsPerBook([]);
    }
  }, []);

  useEffect(() => {
    void reloadStats();
  }, [reloadStats]);

  const reloadBookmarkCount = useCallback(async () => {
    try {
      setBookmarkCount(await api.bookmarksBookCount());
    } catch {
      setBookmarkCount(0);
    }
  }, []);

  useEffect(() => {
    void reloadBookmarkCount();
  }, [reloadBookmarkCount]);

  /** Ghi phiên đọc vừa xong vào SQLite (quá ngắn + không lật trang nào thì bỏ qua). */
  const flushSession = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (!s) return;
    const endedAt = Date.now();
    const seconds = Math.max(0, Math.round((endedAt - s.startedAt) / 1000));
    const pages = Math.max(0, s.maxPage - s.startPage);
    const finished = s.maxPage >= s.total - 1 ? 1 : 0;
    if (seconds < 3 && pages === 0 && finished === 0) return;
    try {
      await api.statsSession({
        book_id: s.bookId,
        started_at: s.startedAt,
        ended_at: endedAt,
        seconds,
        pages_read: pages,
        finished,
      });
    } catch {
      // Ghi thống kê lỗi thì kệ, không chặn việc đọc.
    }
  }, []);

  // Mở sách -> bắt đầu phiên; đóng sách (open -> null) -> ghi phiên.
  useEffect(() => {
    if (!open || !reader) return;
    const id = open.kind === "local" ? open.meta.id : `tg:${open.file.file_id}`;
    sessionRef.current = {
      bookId: id,
      startedAt: Date.now(),
      startPage: open.startPage,
      maxPage: open.startPage,
      total: reader.total,
    };
    return () => {
      // Ghi phiên xong rồi mới tải lại thống kê (kẻo thống kê tải
      // trước khi phiên kịp ghi vào SQLite).
      void flushSession().then(() => void reloadStats());
    };
  }, [open, reader, flushSession, reloadStats]);

  /** Cài đặt riêng cuốn này đã lưu (zoom/fit/crop/2-trang...), hỏng thì mặc định. */
  const loadSettings = async (id: string): Promise<ReaderSettings | null> => {
    try {
      const raw = await api.historySettingsGet(id);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ReaderSettings;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

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

  // Nhớ thư mục đã chọn lần trước: mở app lên là kệ có sẵn sách.
  useEffect(() => {
    const f = loadStored("mio-local-folder");
    if (!f) return;
    api
      .listBooks(f)
      .then((books) => setLocalBooks(books))
      .catch(() => setLocalBooks([]));
  }, []);

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
        // v0.3.9: trang nạp qua URL protocol mio-page:// (Rust phục vụ
        // đúng 1 entry trong ZIP) thay vì base64 qua invoke — ảnh nạp
        // như ảnh web bình thường: bất đồng bộ, cache theo URL, giải
        // mã ngoài luồng chính (đúng mô hình blob URL của bản web mà
        // Thiện khen mượt). fallback base64 dùng khi protocol lỗi
        // (vd file đã đổi/xóa sau khi mở) — trang vẫn hiện, chỉ chậm.
        const load = async (i: number): Promise<ReaderPage> => ({
          content: pageUrl("cbz", meta.path, i),
          isImage: true,
          label: names[i],
          fallback: async () => {
            const p = await api.cbzPage(meta.path, i);
            return p.data_url;
          },
        });
        // Nạp trước trang đầu + 2 trang kề (chỉ tạo URL, không tải
        // byte nào), còn lại nạp khi lật tới.
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
        // Truyện ảnh: không tìm được chữ trong tranh; thumbnail thu nhỏ
        // từ trang đầy đủ khi lưới trang cuộn tới. Thumbnail dùng base64
        // riêng (downscaleDataUrl đọc qua fetch — fetch không đọc được
        // protocol URL của ảnh gốc nếu chưa cache, nên vẫn lấy base64).
        const thumb = async (i: number): Promise<string | null> => {
          const p = await api.cbzPage(meta.path, i);
          return downscaleDataUrl(p.data_url);
        };
        setReader({
          total,
          initialPages,
          loadPage: load,
          searchApi: { search: null },
          thumbApi: { thumb },
        });
        setInitialSettings(await loadSettings(meta.id));
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
          // Sách chữ: tìm trong text các chương (đã bóc thẻ HTML).
          searchApi: {
            search: async (query, onProgress) => {
              const texts = loaded.map((p) => ({ label: p.label, text: stripHtml(p.content) }));
              return searchTextPages(texts, query, onProgress);
            },
          },
          // Sách chữ: lưới trang hiện danh sách chương thay vì ảnh.
          thumbApi: { thumb: null, chapterTitles: loaded.map((p) => p.label) },
        });
        setInitialSettings(await loadSettings(meta.id));
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
        ttsTextRef.current = (i) => book.pageText(i);
        const total = book.numPages;
        // Trang đang nhảy tới từ kết quả tìm thì render kèm highlight vàng.
        const load = (i: number) =>
          book.renderPage(i, pdfHlRef.current?.page === i ? pdfHlRef.current.rects : undefined);
        const first = await Promise.all(
          [startPage, startPage + 1, startPage + 2]
            .filter((i) => i < total)
            .map(load),
        );
        const initialPages: (ReaderPage | null)[] = Array(total).fill(null);
        first.forEach((p, k) => {
          initialPages[startPage + k] = p;
        });
        setReader({
          total,
          initialPages,
          loadPage: load,
          searchApi: {
            search: (q, onProgress, signal) => book.search(q, onProgress, signal),
            onJump: (r: SearchResult) => {
              pdfHlRef.current = { page: r.page, rects: r.rects ?? [] };
              setJumpRequest({ page: r.page, key: Date.now() });
            },
          },
          thumbApi: { thumb: (i) => book.renderThumb(i) },
        });
        setInitialSettings(await loadSettings(meta.id));
        setTitle(meta.name);
        setOpen({ kind: "local", meta, startPage });
        await saveProgress(meta.id, startPage, total, {
          source: "local",
          path: meta.path,
          title: meta.name,
          format: "pdf",
        });
      } else if (meta.format === "mobi") {
        // v0.3.9: MOBI nạp lười — chỉ đọc header + bảng offsets + vùng
        // text (vài MB) rồi chia trang; ảnh nhúng chỉ chuyển base64
        // khi trang đó được render. Trước đây đọc CẢ file (412MB) +
        // giải nén TẤT CẢ record + chuyển MỌI ảnh sang base64 TRƯỚC
        // khi mở reader nên cả app đơ ở toast "Đang mở...". Số trang
        // có thể lệch nhẹ so với bản cũ (ảnh không còn ăn vào ngân
        // sách 6000 ký tự của trang — trang chứa nhiều chữ hơn, tổng
        // số trang ít hơn; vị trí đọc đã lưu có thể lệch vài trang).
        const { openMobiLazy } = await import("./lib/mobiLazy");
        const book = await openMobiLazy(meta.path, meta.size, meta.name);
        const total = book.total;
        // loadPage của sách lười đã trả ReaderPage (HTML + ảnh của
        // đúng trang đó đã chuyển base64, cache LRU 16 ảnh).
        const load = async (i: number): Promise<ReaderPage> => book.loadPage(i);
        const first = await Promise.all(
          [startPage, startPage + 1, startPage + 2]
            .filter((i) => i < total)
            .map(load),
        );
        const initialPages: (ReaderPage | null)[] = Array(total).fill(null);
        first.forEach((p, k) => {
          initialPages[startPage + k] = p;
        });
        setReader({
          total,
          initialPages,
          loadPage: load,
          searchApi: {
            search: async (query, onProgress) => book.search(query, onProgress),
          },
          thumbApi: { thumb: null, chapterTitles: book.chapterTitles },
        });
        setInitialSettings(await loadSettings(meta.id));
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
        const thumb = async (i: number): Promise<string | null> => {
          const p = await load(i);
          return p.isImage ? downscaleDataUrl(p.content) : null;
        };
        setReader({
          total,
          initialPages,
          loadPage: load,
          searchApi: { search: null },
          thumbApi: { thumb },
        });
        setInitialSettings(await loadSettings(meta.id));
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
      const thumb = async (i: number): Promise<string | null> => {
        const p = await load(i);
        return p.isImage ? downscaleDataUrl(p.content) : null;
      };
      setReader({
        total: entries.length,
        initialPages,
        loadPage: load,
        searchApi: { search: null },
        thumbApi: { thumb },
      });
      const id = `tg:${file.file_id}`;
      setInitialSettings(await loadSettings(id));
      setTitle(file.name);
      setOpen({ kind: "telegram", file, client, startPage: 0 });
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
      try {
        const meta = await api.fileMetadata(h.path);
        await openLocal(meta, h.current_page);
      } catch {
        setLoading("Không mở được — file đã bị dời hoặc xóa. Bấm vào sách đó trong thư viện để chỉ lại đường dẫn.");
      }
    } else {
      // Sách Telegram: mở lại từ màn Nguồn sách (panel Telegram giữ client).
      setScreen("sources");
    }
  };

  const resumeById = async (bookId: string) => {
    const h = history.find((x) => x.id === bookId);
    if (h) await resume(h);
  };

  const relink = async (h: HistoryEntry) => {
    const p = await api.pickFile();
    if (p) {
      await api.historyRelink(h.id, p);
      void reloadHistory();
    }
  };

  const pickFile = async () => {
    const p = await api.pickFile();
    if (p) {
      const meta = await api.fileMetadata(p);
      await openLocal(meta);
    }
  };

  const pickFolder = async () => {
    const f = await api.pickFolder();
    if (f) {
      setLocalFolder(f);
      try {
        localStorage.setItem("mio-local-folder", f);
      } catch {
        // Bỏ qua lỗi lưu.
      }
      setLocalBooks(await api.listBooks(f));
    }
  };

  const openDownloaded = async (path: string) => {
    setOpdsPaths((prev) => {
      if (prev.includes(path)) return prev;
      const next = [...prev, path];
      try {
        localStorage.setItem("mio-opds-paths", JSON.stringify(next));
      } catch {
        // Bỏ qua lỗi lưu.
      }
      return next;
    });
    const meta = await api.fileMetadata(path);
    await openLocal(meta);
  };

  const closeReader = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    ttsTextRef.current = null;
    pdfHlRef.current = null;
    setJumpRequest(null);
    setInitialSettings(null);
    setOpen(null);
    setReader(null);
    void reloadHistory();
    void reloadBookmarkCount();
  }, [reloadHistory, reloadBookmarkCount]);

  // Thông tin sách cho menu ⋯ trong trình đọc.
  const bookInfo = useMemo(() => {
    if (!open) return "";
    if (open.kind === "local") {
      return `${open.meta.format.toUpperCase()} · ${formatSize(open.meta.size)}`;
    }
    return `CBZ · ${formatSize(open.file.size)} · Telegram`;
  }, [open]);

  const readerRtl = open
    ? resolveInitialRtl(
        open.kind === "local" ? open.meta.format : "cbz",
        initialSettings?.rtl,
        rtl,
      )
    : rtl;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <span>
            <span className="brand-name">Mio Reader</span>
            <br />
            <span className="brand-sub">Đọc sách &amp; truyện</span>
          </span>
        </div>
        <button
          className={`nav-item${screen === "library" && !open ? " active" : ""}`}
          onClick={() => setScreen("library")}
        >
          <span className="nic">📚</span> Thư viện
          <span className="cnt">{localBooks.length + telegramHistory.length}</span>
        </button>
        <button
          className={`nav-item${screen === "folders" && !open ? " active" : ""}`}
          onClick={() => setScreen("folders")}
        >
          <span className="nic">🗂</span> Thư mục
        </button>
        <button
          className="nav-item"
          onClick={() => {
            if (continueBook) void resume(continueBook);
            else setScreen("library");
          }}
        >
          <span className="nic">▶</span> Đang đọc
        </button>
        <button
          className={`nav-item${screen === "stats" && !open ? " active" : ""}`}
          onClick={() => setScreen("stats")}
        >
          <span className="nic">📊</span> Thống kê
        </button>
        <button
          className={`nav-item${screen === "sources" && !open ? " active" : ""}`}
          onClick={() => setScreen("sources")}
        >
          <span className="nic">🌐</span> Nguồn sách
        </button>
        <div className="side-label">Kệ của tôi</div>
        <button className="nav-item" onClick={() => setScreen("library")}>
          <span className="nic">🔖</span> Đã đánh dấu
          <span className="cnt">{bookmarkCount}</span>
        </button>
        <button className="nav-item" onClick={() => setScreen("library")}>
          <span className="nic">⬇</span> Đã tải xuống
          <span className="cnt">{localBooks.length}</span>
        </button>
        <div className="side-foot">
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>
            <span className="nic">⚙</span> Cài đặt
          </button>
          <div className="storage-bar">
            <i style={{ width: `${Math.min(100, (totalSize / (5 * 1073741824)) * 100)}%` }} />
          </div>
          <div className="storage-txt">
            Kệ sách: {formatSize(totalSize) || "0 KB"} · {localBooks.length} cuốn
          </div>
          <div className="storage-txt">Mio Reader v{APP_VERSION}</div>
        </div>
      </aside>

      <div className="main">
        {loading && <div className="loading-bar">{loading}</div>}
        {open && reader ? (
          <Reader
            title={title}
            bookId={open.kind === "local" ? open.meta.id : `tg:${open.file.file_id}`}
            format={open.kind === "local" ? open.meta.format : "cbz"}
            total={reader.total}
            initialPages={reader.initialPages}
            loadPage={reader.loadPage}
            startPage={open.startPage}
            rtl={readerRtl}
            onProgress={(page, total) => {
              const id =
                open.kind === "local" ? open.meta.id : `tg:${open.file.file_id}`;
              if (sessionRef.current) {
                sessionRef.current.maxPage = Math.max(sessionRef.current.maxPage, page);
              }
              void saveProgress(id, page, total);
            }}
            onClose={closeReader}
            searchApi={reader.searchApi}
            thumbApi={reader.thumbApi}
            initialSettings={initialSettings}
            jumpRequest={jumpRequest}
            ttsTextForPage={(page) => ttsTextRef.current?.(page) ?? Promise.resolve(null)}
            bookInfo={bookInfo}
            onOpenStats={() => {
              closeReader();
              setScreen("stats");
            }}
          />
        ) : screen === "library" ? (
          <Library
            localBooks={localBooks}
            history={history}
            opdsPaths={opdsPaths}
            continueBook={continueBook}
            onOpenLocal={(b) => void openLocal(b)}
            onPickFile={() => void pickFile()}
            onPickFolder={() => void pickFolder()}
            onResume={(h) => void resume(h)}
            onOpenSources={() => setScreen("sources")}
            onRelink={(h) => void relink(h)}
            onRemoveHistory={(id) => {
              void api.historyDelete(id).then(() => reloadHistory());
            }}
          />
        ) : screen === "folders" ? (
          <FolderTree
            root={localFolder}
            onPickFolder={() => void pickFolder()}
            onOpenLocal={(b) => void openLocal(b)}
          />
        ) : screen === "stats" ? (
          <StatsView
            summary={statsSummary}
            perBook={statsPerBook}
            history={history}
            onResume={(id) => void resumeById(id)}
          />
        ) : (
          <SourcesView
            localFolder={localFolder}
            localCount={localBooks.length}
            onPickFolder={() => void pickFolder()}
            onOpenTelegramBook={(f, c) => void openTelegram(f, c)}
            onOpenDownloaded={(path) => openDownloaded(path)}
          />
        )}
      </div>

      {settingsOpen && (
        <>
          <div className="scrim" onClick={() => setSettingsOpen(false)} />
          <aside className="sheet" role="dialog" aria-label="Cài đặt">
            <div className="sheet-head">
              <h2>Cài đặt</h2>
              <button className="x" onClick={() => setSettingsOpen(false)} aria-label="Đóng">
                ✕
              </button>
            </div>
            <div className="sheet-body">
              <p className="mgroup">Đọc sách</p>
              <div className="settings-row">
                <span className="sr-label">
                  <span className="t">Manga phải → trái (mặc định)</span>
                  <br />
                  <span className="d">
                    Áp dụng cho sách chưa có cài đặt riêng. Truyện tranh
                    (CBZ/CBR) thì mặc định đã bật RTL khi mở.
                  </span>
                </span>
                <button
                  className={`switch${rtl ? " on" : ""}`}
                  role="switch"
                  aria-checked={rtl}
                  aria-label="Manga phải sang trái mặc định"
                  onClick={() => setRtl((v) => !v)}
                />
              </div>
              <p className="mgroup">Cập nhật</p>
              <UpdateBanner />
              <p className="mgroup">Giới thiệu</p>
              <div className="settings-row">
                <span className="sr-label">
                  <span className="t">Mio Reader v{APP_VERSION}</span>
                  <br />
                  <span className="d">
                    Đọc sách &amp; truyện trên PC — đọc trực tiếp từ ổ cứng,
                    không nhân bản file. Lịch sử &amp; thống kê chỉ lưu trên
                    máy này.
                  </span>
                </span>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

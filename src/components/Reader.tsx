import { useCallback, useEffect, useRef, useState } from "react";
import { easeOutQuart, FLIP_MS, foldGeometry } from "../lib/curl";
import {
  leafForFlip,
  nextSpreadStart,
  spreadSides,
  spreadStartForPage,
} from "../lib/spread";
import { api } from "../lib/api";
import { stripHtml } from "../lib/search";
import {
  clearTtsMark,
  markTtsSentence,
  splitSentences,
  TtsEngine,
  type TtsState,
} from "../lib/tts";
import DictionaryBox from "./DictionaryBox";
import {
  clampCrop,
  cropImgStyle,
  detectMarginsFromImage,
  hasCrop,
  NO_CROP,
} from "../lib/crop";
import {
  applyHighlights,
  clearSearchHit,
  markSearchHit,
  selectionOffsets,
} from "../lib/highlights";
import { ThumbCache } from "../lib/thumbs";
import type {
  Bookmark,
  CropMargins,
  Highlight,
  ReaderSettings,
  SearchResult,
} from "../types";
import ReaderPanels, { type PanelTab } from "./ReaderPanels";

export interface ReaderPage {
  /** Ảnh (data URL) hoặc HTML chương EPUB. */
  content: string;
  isImage: boolean;
  label: string;
}

/** Khả năng tìm trong sách: null = sách ảnh, không tìm được chữ trong tranh. */
export interface ReaderSearchApi {
  search:
    | ((
        query: string,
        onProgress: (done: number, total: number) => void,
        signal: AbortSignal,
      ) => Promise<SearchResult[]>)
    | null;
  /** Gọi khi nhảy tới 1 kết quả (PDF: App bật highlight lên trang đó). */
  onJump?: (r: SearchResult) => void;
}

/** Nguồn thumbnail cho lưới trang; null = hiện danh sách chương (sách chữ). */
export interface ReaderThumbApi {
  thumb: ((i: number) => Promise<string | null>) | null;
  chapterTitles?: string[];
}

export interface JumpRequest {
  page: number;
  key: number;
  query?: string;
}

interface Props {
  title: string;
  bookId: string;
  format: string; // cbz | cbr | epub | pdf | mobi
  total: number;
  /** Mảng thưa: trang nào đã nạp thì có sẵn, chưa nạp là null. */
  initialPages: (ReaderPage | null)[];
  /** Nạp 1 trang theo chỉ số (CBZ local/Telegram: giải mã từng trang). */
  loadPage: (i: number) => Promise<ReaderPage>;
  startPage: number;
  rtl: boolean;
  onProgress: (page: number, total: number) => void;
  onClose: () => void;
  searchApi: ReaderSearchApi;
  thumbApi: ReaderThumbApi;
  /** Cài đặt riêng cuốn này đã lưu (zoom/fit/crop/2-trang), null = mặc định. */
  initialSettings: ReaderSettings | null;
  /** App yêu cầu nhảy tới 1 trang (kết quả tìm PDF đã có highlight). */
  jumpRequest: JumpRequest | null;
  /** P2: text từng trang PDF (từ pdf.js) để TTS đọc; EPUB/MOBI tự bóc từ chương. */
  ttsTextForPage?: (page: number) => Promise<string | null>;
}

const HL_COLORS = [
  { id: "yellow", label: "Vàng" },
  { id: "pink", label: "Hồng" },
  { id: "green", label: "Xanh lá" },
  { id: "blue", label: "Xanh dương" },
] as const;

const clampZoom = (z: number) => Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));

/**
 * Trình đọc 2 trang/spread với page-curl như bản web (P0) + P1:
 * - Nạp lười từng trang, lá lật 1 trang quanh gáy, bóng + nếp gấp.
 * - Bookmarks (phím B), tìm trong sách (Ctrl+F), lưới trang thumbnail
 *   lười, zoom + vừa trang/rộng/cao, cắt lề trang ảnh, gạch chân EPUB.
 * - Zoom vượt vừa trang thì tắt lật, kéo chuột để rê trang thay vì lật.
 * - Sách chữ: kéo chuột để bôi đen chữ (gạch chân), lật bằng nút/phím.
 */
export default function Reader({
  title,
  bookId,
  format,
  total,
  initialPages,
  loadPage,
  startPage,
  rtl: rtlDefault,
  onProgress,
  onClose,
  searchApi,
  thumbApi,
  initialSettings,
  jumpRequest,
  ttsTextForPage,
}: Props) {
  const isTextBook = format === "epub" || format === "mobi";
  const ttsAvailable = isTextBook || format === "pdf";
  // Chế độ đọc của cuốn này: cài đặt đã lưu thắng, chưa lưu thì lấy mặc
  // định chung của App (checkbox Manga ở thư viện). Đổi trong menu (⋯)
  // thì nhớ theo từng cuốn.
  const initTwoPage = initialSettings?.twoPage ?? true;
  const initRtl = initialSettings?.rtl ?? rtlDefault;
  const [spread, setSpread] = useState(() =>
    spreadStartForPage(startPage, initTwoPage, initRtl, total),
  );
  const [twoPage, setTwoPage] = useState(initTwoPage);
  const [rtl, setRtl] = useState(initRtl);
  const [flipOn, setFlipOn] = useState(true);
  // ---- v0.2.0: chế độ đọc toàn màn hình "chìm" (immersive) ----
  // Chỉ còn trang sách + thanh tiến độ mỏng + cụm nút nổi (tự ẩn sau
  // ~2.5s không cử động chuột). Trạng thái này KHÔNG phụ thuộc vào
  // Fullscreen API: nếu WebView chặn requestFullscreen thì CSS vẫn ẩn
  // hết chrome như thường (fallback đã kiểm bằng code, xem README).
  const [immersive, setImmersive] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  // Trong lúc lật, nền hiển thị spread đích để lá lật xong là khớp, không giật.
  const [curlTarget, setCurlTarget] = useState<number | null>(null);
  const [, setCacheVersion] = useState(0);

  // ---- P1: panel bên phải ----
  const [panel, setPanel] = useState<PanelTab | "none">("none");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // ---- P1: zoom / fit ----
  const [zoom, setZoom] = useState(initialSettings?.zoom ?? 1);
  const [fit, setFit] = useState<"page" | "width" | "height">(initialSettings?.fit ?? "page");
  const [vpSize, setVpSize] = useState({ w: 1200, h: 700 });
  const [baseH, setBaseH] = useState(600);

  // ---- P1: cắt lề (chỉ trang ảnh) ----
  const [crop, setCrop] = useState<CropMargins>(initialSettings?.crop ?? NO_CROP);
  const [showCrop, setShowCrop] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropMsg, setCropMsg] = useState("");

  // ---- P1: tìm trong sách ----
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [pendingMark, setPendingMark] = useState<{ page: number; query: string } | null>(null);

  // ---- P1: gạch chân (chọn chữ trong chương) ----
  const [pendingSelection, setPendingSelection] = useState<{
    start: number;
    end: number;
    text: string;
    page: number;
  } | null>(null);
  const [hlColor, setHlColor] = useState<string>("yellow");
  const [hlNote, setHlNote] = useState("");

  // ---- P2: đọc thành tiếng (TTS) + từ điển ----
  const [ttsOpen, setTtsOpen] = useState(false);
  const [ttsState, setTtsState] = useState<TtsState>("idle");
  const [ttsRate, setTtsRate] = useState(1);
  const [ttsVoiceURI, setTtsVoiceURI] = useState<string | null>(() => {
    try {
      return localStorage.getItem("mio-tts-voice");
    } catch {
      return null;
    }
  });
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsMsg, setTtsMsg] = useState("");
  const [dictOpen, setDictOpen] = useState(false);
  const [dictWord, setDictWord] = useState("");
  const ttsRef = useRef<TtsEngine | null>(null);
  const ttsPageRef = useRef(-1);
  const ttsEndRef = useRef(0);
  /** true trong lúc TTS tự lật trang (để lật trang không dừng TTS). */
  const ttsAutoRef = useRef(false);
  const startTtsRef = useRef<(page?: number) => Promise<void>>(async () => {});
  const stopTtsRef = useRef<() => void>(() => {});

  const cacheRef = useRef(new Map<number, ReaderPage>());
  const inflightRef = useRef(new Set<number>());
  const busyRef = useRef(false);
  const leafRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const creaseRef = useRef<HTMLDivElement>(null);
  const spreadRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    grabX: number;
    grabY: number;
    dir: 1 | -1;
    spineLeft: boolean;
    next: number;
    rect: DOMRect;
  } | null>(null);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const curlRef = useRef<{
    dir: 1 | -1;
    spineLeft: boolean;
    next: number;
    front: number;
    back: number;
  } | null>(null);
  const thumbCacheRef = useRef(new ThumbCache(60));
  const settingsSavedRef = useRef(false);

  // ---- v0.2.0: toàn màn hình "chìm" ----
  const menuOpenRef = useRef(false);
  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    // Menu đang mở thì đừng tự ẩn cụm nút (người đọc còn đang chọn).
    if (menuOpenRef.current) return;
    idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2500);
  }, []);
  // Cử động chuột thì hiện cụm nút nổi, để yên ~2.5s thì tự ẩn.
  useEffect(() => {
    if (!immersive) return;
    pokeControls();
    window.addEventListener("mousemove", pokeControls);
    return () => {
      window.removeEventListener("mousemove", pokeControls);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [immersive, pokeControls]);
  // Ẩn cả header của App (nằm ngoài Reader) khi đang đọc chìm.
  useEffect(() => {
    document.body.classList.toggle("immersive-reading", immersive);
    return () => {
      document.body.classList.remove("immersive-reading");
      // Đóng sách khi đang ở fullscreen thật thì thoát fullscreen luôn.
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [immersive]);
  // Người đọc bấm Esc trong fullscreen thật: trình duyệt tự thoát
  // fullscreen -> đồng bộ tắt luôn chế độ chìm.
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const enterImmersive = useCallback(async () => {
    setImmersive(true);
    setControlsVisible(true);
    try {
      // WebView2 thường cho fullscreen; nếu bị chặn thì catch bên dưới
      // và CSS vẫn ẩn hết chrome — đọc chìm không phụ thuộc API này.
      await document.documentElement.requestFullscreen();
    } catch {
      // Fallback: chỉ ẩn chrome bằng CSS, vẫn đọc toàn màn hình.
    }
  }, []);
  const exitImmersive = useCallback(async () => {
    setImmersive(false);
    setMenuOpen(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Kệ, đã tắt chế độ chìm bằng CSS rồi.
      }
    }
  }, []);

  // Nạp cache ban đầu từ trang đã nạp sẵn.
  useEffect(() => {
    initialPages.forEach((p, i) => {
      if (p) cacheRef.current.set(i, p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `cur` = trang đầu tiên theo thứ tự đọc của spread đang mở.
  const cur = Math.min(spread, Math.max(0, total - 1));
  const shownSpread = curlTarget ?? cur;
  // Trang ở mỗi bên (RTL: trang đọc trước nằm bên PHẢI, trang sau bên TRÁI).
  const shownSides = spreadSides(shownSpread, twoPage, rtl, total);
  const left = shownSides.left !== null ? cacheRef.current.get(shownSides.left) : undefined;
  const right = shownSides.right !== null ? cacheRef.current.get(shownSides.right) : undefined;
  const leftIndex = shownSides.left;
  const rightIndex = shownSides.right;
  // Spread tiếp theo theo chiều đọc (để nạp trước khi lật tới).
  const nextSpread = nextSpreadStart(cur, 1, twoPage, rtl, total);

  // ---- Đo kích thước để tính zoom/fit ----
  const baseW = twoPage
    ? Math.min(1200, Math.max(320, vpSize.w - 24))
    : Math.min(600, Math.max(320, vpSize.w - 24));
  // Chương sách chữ dài hơn viewport thì fit theo chiều rộng là chính,
  // không thu nhỏ chữ tới mức không đọc được.
  const effH = Math.min(baseH, vpSize.h);
  const fitScale =
    fit === "width" ? vpSize.w / baseW : fit === "height" ? vpSize.h / effH : Math.min(vpSize.w / baseW, vpSize.h / effH);
  const scale = fitScale * zoom;
  const zoomedBeyondFit = zoom > 1.02;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setVpSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setVpSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = spreadRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.offsetHeight > 0) setBaseH(el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl + lăn chuột để zoom (listener không passive để chặn cuộn mặc định).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  // ---- Nạp bookmarks + highlights của cuốn này ----
  const refreshBookmarks = useCallback(async () => {
    try {
      setBookmarks(await api.bookmarksList(bookId));
    } catch {
      setBookmarks([]);
    }
  }, [bookId]);
  const refreshHighlights = useCallback(async () => {
    try {
      setHighlights(await api.highlightsList(bookId));
    } catch {
      setHighlights([]);
    }
  }, [bookId]);
  useEffect(() => {
    void refreshBookmarks();
    void refreshHighlights();
  }, [refreshBookmarks, refreshHighlights]);

  // ---- Lưu cài đặt riêng cuốn này (zoom/fit/crop/2-trang/manga), debounce 500ms ----
  useEffect(() => {
    if (!settingsSavedRef.current) {
      settingsSavedRef.current = true;
      return;
    }
    const t = setTimeout(() => {
      void api
        .historySettingsSave(bookId, JSON.stringify({ zoom, fit, crop, twoPage, rtl }))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [zoom, fit, crop, twoPage, rtl, bookId]);

  const ensure = useCallback(
    async (indices: number[]): Promise<void> => {
      const missing = indices.filter(
        (i) => i >= 0 && i < total && !cacheRef.current.has(i) && !inflightRef.current.has(i),
      );
      if (missing.length === 0) return;
      await Promise.all(
        missing.map(async (i) => {
          inflightRef.current.add(i);
          try {
            const p = await loadPage(i);
            cacheRef.current.set(i, p);
          } catch {
            // Để trống, lần sau lật tới sẽ thử nạp lại.
          } finally {
            inflightRef.current.delete(i);
          }
        }),
      );
      setCacheVersion((v) => v + 1);
    },
    [loadPage, total],
  );

  // Lật tới đâu nạp tới đó: spread hiện tại + spread đích.
  useEffect(() => {
    const pages = [cur, cur + 1];
    if (nextSpread !== null) pages.push(nextSpread, nextSpread + 1);
    void ensure(pages);
  }, [cur, nextSpread, ensure]);

  // Vẽ lại gạch chân + xóa đánh dấu tìm cũ mỗi khi đổi trang.
  useEffect(() => {
    const spreadEl = spreadRef.current;
    if (!spreadEl || !isTextBook) return;
    spreadEl.querySelectorAll(".epub-page").forEach((el) => {
      const pageIdx = Number((el as HTMLElement).dataset.page ?? NaN);
      if (Number.isNaN(pageIdx)) return;
      if (!pendingMark || pendingMark.page !== pageIdx) {
        clearSearchHit(el as HTMLElement);
      }
      applyHighlights(
        el as HTMLElement,
        highlights.filter((h) => h.page === pageIdx),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, isTextBook, highlights]);

  // Nhảy tới 1 trang bất kỳ (bookmark / highlight / lưới / tìm).
  const jumpTo = useCallback(
    (page: number) => {
      // Lật tay thì dừng TTS (trừ lúc TTS tự lật sang trang sau).
      if (!ttsAutoRef.current) stopTtsRef.current();
      const n = Math.max(0, Math.min(total - 1, page));
      void ensure([n, n + 1]);
      setSpread(spreadStartForPage(n, twoPage, rtl, total));
      onProgress(n, total);
      setPanel("none");
      setMenuOpen(false);
    },
    [total, twoPage, rtl, ensure, onProgress],
  );

  // App yêu cầu nhảy tới kết quả tìm PDF: nạp lại trang đó (đã có highlight
  // vàng do App bật qua loadPage) rồi nhảy tới.
  useEffect(() => {
    if (!jumpRequest) return;
    const page = jumpRequest.page;
    cacheRef.current.delete(page);
    void ensure([page, page + 1]).then(() => {
      jumpTo(page);
      if (jumpRequest.query) setPendingMark({ page, query: jumpRequest.query });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpRequest]);

  // Đánh dấu lần xuất hiện đầu tiên của từ tìm trong trang vừa nhảy tới.
  useEffect(() => {
    if (!pendingMark) return;
    const t = requestAnimationFrame(() => {
      const el = spreadRef.current?.querySelector(
        `.epub-page[data-page="${pendingMark.page}"]`,
      ) as HTMLElement | null;
      if (el) {
        const mark = markSearchHit(el, pendingMark.query);
        mark?.scrollIntoView({ block: "center" });
      }
      setPendingMark(null);
    });
    return () => cancelAnimationFrame(t);
  }, [pendingMark, cur]);

  const decodeImages = useCallback(async (pages: (ReaderPage | undefined)[]) => {
    await Promise.all(
      pages.map(async (p) => {
        if (!p?.isImage) return;
        try {
          const img = new Image();
          img.src = p.content;
          await img.decode();
        } catch {
          // Giải mã lỗi thì cứ lật tiếp, ảnh sẽ hiện khi trình duyệt nạp xong.
        }
      }),
    );
  }, []);

  // ---- P2: đọc thành tiếng (TTS) ----
  const getTts = useCallback(() => {
    if (!ttsRef.current) ttsRef.current = new TtsEngine();
    return ttsRef.current;
  }, []);

  // Nạp danh sách giọng hệ thống (WebView trả rỗng lúc đầu, có sau sự
  // kiện voiceschanged). Chưa chọn giọng thì ưu tiên giọng Việt, rồi Anh.
  useEffect(() => {
    const eng = getTts();
    if (!eng.supported) return;
    const load = () => {
      const vs = eng.getVoices();
      setTtsVoices(vs);
      if (!ttsVoiceURI && vs.length > 0) {
        const vi = vs.find((v) => v.lang.toLowerCase().startsWith("vi"));
        const en = vs.find((v) => v.lang.toLowerCase().startsWith("en"));
        const pick = vi ?? en;
        if (pick) {
          setTtsVoiceURI(pick.voiceURI);
          try {
            localStorage.setItem("mio-tts-voice", pick.voiceURI);
          } catch {
            // Bỏ qua lỗi lưu.
          }
        }
      }
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getTts]);

  // Đóng trình đọc thì dừng đọc ngay (kẻo sách đóng rồi vẫn đọc).
  useEffect(() => () => getTts().stop(), [getTts]);

  const clearTtsMarks = useCallback(() => {
    spreadRef.current?.querySelectorAll(".epub-page").forEach((el) => {
      clearTtsMark(el as HTMLElement);
    });
    ttsEndRef.current = 0;
  }, []);

  const stopTts = useCallback(() => {
    getTts().stop();
    clearTtsMarks();
    setTtsState("idle");
    setTtsMsg("");
  }, [getTts, clearTtsMarks]);

  useEffect(() => {
    stopTtsRef.current = stopTts;
  });

  const getTtsText = useCallback(
    async (page: number): Promise<string | null> => {
      if (format === "pdf") {
        const t = await ttsTextForPage?.(page);
        return t && t.trim() ? t : null;
      }
      const p = cacheRef.current.get(page);
      if (!p || p.isImage) return null;
      const t = stripHtml(p.content);
      return t.trim() ? t : null;
    },
    [format, ttsTextForPage],
  );

  const highlightTtsSentence = useCallback(
    (page: number, sentence: string) => {
      if (!isTextBook) return; // PDF: chỉ đọc tiếng, không tô câu.
      const el = spreadRef.current?.querySelector(
        `.epub-page[data-page="${page}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      const end = markTtsSentence(el, sentence, ttsEndRef.current);
      if (end !== null) ttsEndRef.current = end;
    },
    [isTextBook],
  );

  const startTts = useCallback(
    async (page?: number) => {
      const eng = getTts();
      if (!eng.supported) {
        setTtsMsg("Máy này không có giọng đọc (speechSynthesis) — WebView không hỗ trợ.");
        return;
      }
      const p = page ?? cur;
      await ensure([p, p + 1]);
      const text = await getTtsText(p);
      if (!text) {
        setTtsMsg("Trang này không có chữ để đọc (truyện ảnh hoặc trang trắng) — dừng tại đây.");
        setTtsState("idle");
        return;
      }
      const sentences = splitSentences(text);
      if (sentences.length === 0) {
        setTtsMsg("Trang này không có chữ để đọc.");
        setTtsState("idle");
        return;
      }
      ttsPageRef.current = p;
      ttsEndRef.current = 0;
      eng.voiceURI = ttsVoiceURI;
      eng.rate = ttsRate;
      setTtsState("playing");
      setTtsMsg(`Đang đọc trang ${p + 1}/${total}…`);
      eng.speak(sentences, {
        onSentence: (_i, s) => highlightTtsSentence(p, s),
        onDone: () => {
          // Hết trang: đọc tiếp trang sau theo thứ tự đọc (kể cả trang còn
          // lại trong cùng spread), tới cuối sách thì dừng.
          clearTtsMarks();
          const next = p + 1;
          if (next < total) {
            ttsAutoRef.current = true;
            setSpread(spreadStartForPage(next, twoPage, rtl, total));
            onProgress(next, total);
            setTimeout(() => {
              ttsAutoRef.current = false;
              void startTtsRef.current(next);
            }, 350);
          } else {
            setTtsState("idle");
            setTtsMsg("Đã đọc hết sách.");
          }
        },
        onError: (m) => {
          setTtsMsg(m);
          setTtsState("idle");
        },
      });
    },
    [cur, twoPage, rtl, total, ensure, getTtsText, ttsVoiceURI, ttsRate, highlightTtsSentence, onProgress, getTts, clearTtsMarks],
  );

  useEffect(() => {
    startTtsRef.current = startTts;
  });

  const toggleTtsPause = useCallback(() => {
    const eng = getTts();
    if (ttsState === "playing") {
      eng.pause();
      setTtsState("paused");
    } else if (ttsState === "paused") {
      eng.resume();
      setTtsState("playing");
    }
  }, [ttsState, getTts]);

  /** Ghi tư thế lá lật thẳng vào DOM (không render lại React).
   * `spineLeft` = gáy lá nằm bên trái: lá xoay quanh mép trái, góc âm.
   * Ngược lại xoay quanh mép phải, góc dương. */
  const applyPose = useCallback((progress: number, spineLeft: boolean, tiltDeg: number) => {
    const leaf = leafRef.current;
    const shadow = shadowRef.current;
    const crease = creaseRef.current;
    const shade = Math.sin(progress * Math.PI);
    if (leaf) {
      const sign = spineLeft ? -1 : 1;
      leaf.style.opacity = progress <= 0 ? "0" : "1";
      leaf.style.transform = `rotateY(${sign * progress * 180}deg) rotateX(${tiltDeg}deg)`;
      leaf.style.transformOrigin = spineLeft ? "left center" : "right center";
    }
    if (shadow) shadow.style.opacity = String(shade * 0.5);
    if (crease) crease.style.opacity = String(shade * 0.85);
  }, []);

  const resetPose = useCallback(() => {
    const leaf = leafRef.current;
    if (leaf) {
      leaf.style.transform = "";
      leaf.style.opacity = "0";
    }
    if (shadowRef.current) shadowRef.current.style.opacity = "0";
    if (creaseRef.current) creaseRef.current.style.opacity = "0";
  }, []);

  /** Chạy animation lật từ tiến độ `from` tới `to` (0 = chưa lật, 1 = lật xong). */
  const animateCurl = useCallback(
    (spineLeft: boolean, from: number, to: number, done: () => void) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / FLIP_MS);
        const progress = from + (to - from) * easeOutQuart(t);
        applyPose(progress, spineLeft, 0);
        if (t < 1) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    },
    [applyPose],
  );

  const commit = useCallback(
    async (dir: 1 | -1, fromProgress = 0) => {
      if (busyRef.current) return;
      // Lá nào lật, hiện trang nào — tính 1 lần từ mô hình spread
      // (đúng cho cả 1/2 trang × LTR/RTL; xem src/lib/spread.ts).
      const leaf = leafForFlip(cur, dir, twoPage, rtl, total);
      if (!leaf) return;
      // Lật tay thì dừng TTS (trừ lúc TTS tự lật sang trang sau).
      if (!ttsAutoRef.current) stopTtsRef.current();
      busyRef.current = true;
      try {
        // Nạp + giải mã spread đích trước khi lật để không giật giữa chừng.
        const dest = spreadSides(leaf.next, twoPage, rtl, total);
        const destPages = [dest.left, dest.right].filter(
          (p): p is number => p !== null,
        );
        await ensure(destPages);
        await decodeImages(destPages.map((p) => cacheRef.current.get(p)));
        // Zoom vượt vừa trang thì không lật cong nữa, nhảy thẳng trang.
        if (!flipOn || fromProgress >= 1 || zoomedBeyondFit) {
          setSpread(leaf.next);
          onProgress(leaf.next, total);
          return;
        }
        curlRef.current = { dir, spineLeft: leaf.spineLeft, next: leaf.next, front: leaf.front, back: leaf.back };
        setCurlTarget(leaf.next);
        // Đợi 1 khung hình để nền spread đích vẽ xong rồi mới lật.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise<void>((resolve) => {
          animateCurl(leaf.spineLeft, fromProgress, 1, resolve);
        });
        setSpread(leaf.next);
        onProgress(leaf.next, total);
      } finally {
        curlRef.current = null;
        setCurlTarget(null);
        resetPose();
        busyRef.current = false;
      }
    },
    [cur, twoPage, rtl, total, flipOn, zoomedBeyondFit, ensure, decodeImages, animateCurl, onProgress, resetPose],
  );

  // ---- Bookmarks ----
  const toggleBookmark = useCallback(async () => {
    const existing = bookmarks.find((b) => b.page === cur);
    try {
      if (existing) {
        await api.bookmarkDelete(existing.id);
      } else {
        const label = cacheRef.current.get(cur)?.label ?? `Trang ${cur + 1}`;
        await api.bookmarkAdd({
          book_id: bookId,
          page: cur,
          chapter: label,
          note: null,
          created_at: Date.now(),
        });
      }
      await refreshBookmarks();
    } catch {
      // Lưu bookmark lỗi thì kệ, không chặn việc đọc.
    }
  }, [bookmarks, cur, bookId, refreshBookmarks]);

  const addBookmarkWithLabel = useCallback(
    async (label: string) => {
      const pageLabel = cacheRef.current.get(cur)?.label ?? `Trang ${cur + 1}`;
      try {
        await api.bookmarkAdd({
          book_id: bookId,
          page: cur,
          chapter: pageLabel,
          note: label,
          created_at: Date.now(),
        });
        await refreshBookmarks();
      } catch {
        // Bỏ qua lỗi lưu.
      }
    },
    [cur, bookId, refreshBookmarks],
  );

  // ---- Tìm trong sách ----
  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || !searchApi.search) return;
    searchAbortRef.current?.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setSearching(true);
    setSearchResults([]);
    setSearchDone(0);
    setSearchTotal(total);
    try {
      const res = await searchApi.search(
        q,
        (done, tot) => {
          setSearchDone(done);
          setSearchTotal(tot);
        },
        ctrl.signal,
      );
      if (!ctrl.signal.aborted) setSearchResults(res);
    } finally {
      if (searchAbortRef.current === ctrl) setSearching(false);
    }
  }, [searchQuery, searchApi, total]);

  const jumpToSearchResult = useCallback(
    (r: SearchResult) => {
      // PDF: App vẽ highlight vàng lên trang rồi báo nhảy qua jumpRequest.
      if (r.rects && r.rects.length > 0 && searchApi.onJump) {
        searchApi.onJump(r);
        setPanel("none");
        return;
      }
      jumpTo(r.page);
      if (searchQuery.trim()) setPendingMark({ page: r.page, query: searchQuery.trim() });
    },
    [searchApi, jumpTo, searchQuery],
  );

  // ---- Gạch chân: lưu đoạn chữ vừa bôi đen ----
  const saveHighlight = useCallback(async () => {
    if (!pendingSelection) return;
    const label = cacheRef.current.get(pendingSelection.page)?.label ?? `Trang ${pendingSelection.page + 1}`;
    try {
      await api.highlightAdd({
        book_id: bookId,
        page: pendingSelection.page,
        chapter: label,
        color: hlColor,
        text: pendingSelection.text,
        note: hlNote.trim() || null,
        start_off: pendingSelection.start,
        end_off: pendingSelection.end,
        created_at: Date.now(),
      });
      await refreshHighlights();
    } catch {
      // Bỏ qua lỗi lưu.
    }
    setPendingSelection(null);
    setHlNote("");
    window.getSelection()?.removeAllRanges();
    setPanel("highlights");
  }, [pendingSelection, hlColor, hlNote, bookId, refreshHighlights]);

  // ---- Cắt lề: tự phát hiện lề trắng trên trang ảnh đang đọc ----
  const autoDetectCrop = useCallback(async () => {
    const page = left?.isImage ? left : right?.isImage ? right : undefined;
    if (!page) {
      setCropMsg("Trang này là chữ, không có ảnh để phát hiện lề.");
      return;
    }
    setCropBusy(true);
    setCropMsg("Đang quét lề trắng…");
    try {
      const found = await detectMarginsFromImage(page.content);
      setCrop(clampCrop(found));
      setCropMsg(
        `Đã cắt: trên ${found.top}% • phải ${found.right}% • dưới ${found.bottom}% • trái ${found.left}%. Kéo thanh trượt để chỉnh tay.`,
      );
    } catch {
      setCropMsg("Không phát hiện được lề (ảnh tối hoặc không có lề trắng) — chỉnh tay bằng thanh trượt.");
    } finally {
      setCropBusy(false);
    }
  }, [left, right]);

  // Mở 1 tab bảng bên (đánh dấu/tìm/lưới/gạch chân). Đang đọc chìm thì
  // thoát chìm trước — bảng bên cần không gian, không chen vào trang đọc.
  const openPanel = useCallback(
    (tab: PanelTab) => {
      setMenuOpen(false);
      if (immersive) void exitImmersive();
      setPanel(tab);
    },
    [immersive, exitImmersive],
  );

  // ---- Phím tắt ----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.repeat) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        openPanel("search");
        return;
      }
      if (e.key === "ArrowRight") void commit(rtl ? -1 : 1);
      else if (e.key === "ArrowLeft") void commit(rtl ? 1 : -1);
      else if (e.key === "f" || e.key === "F") {
        if (immersive) void exitImmersive();
        else void enterImmersive();
      }
      else if (e.key === "t" || e.key === "T") {
        if (ttsState === "playing" || ttsState === "paused") stopTts();
        else void startTts();
      }
      else if (e.key === "Escape") {
        if (menuOpen) setMenuOpen(false);
        else if (panel !== "none") setPanel("none");
        else if (immersive) void exitImmersive();
        else if (showCrop) setShowCrop(false);
        else if (pendingSelection) setPendingSelection(null);
        else onClose();
      } else if (e.key === "b" || e.key === "B") void toggleBookmark();
      else if (e.key === "g" || e.key === "G") {
        if (panel === "grid") setPanel("none");
        else openPanel("grid");
      }
      else if (e.key === "+" || e.key === "=") setZoom((z) => clampZoom(z * 1.2));
      else if (e.key === "-") setZoom((z) => clampZoom(z / 1.2));
      else if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, rtl, panel, menuOpen, immersive, showCrop, pendingSelection, toggleBookmark, ttsState, startTts, stopTts, openPanel]);

  const toggleImmersive = () => {
    if (immersive) void exitImmersive();
    else void enterImmersive();
  };

  const toggleTwoPage = () => {
    const next = !twoPage;
    setTwoPage(next);
    setSpread(spreadStartForPage(cur, next, rtl, total));
  };

  const toggleRtl = () => {
    // Đổi chiều đọc của cuốn này (nhớ theo từng cuốn, lưu vào settings).
    setRtl((v) => !v);
    setSpread((s) => spreadStartForPage(s, twoPage, !rtl, total));
  };

  // ---- Kéo chuột: zoom vượt vừa trang thì rê trang, không thì lật ----
  const onPointerDown = (e: React.PointerEvent, dir: 1 | -1, slot: "left" | "right") => {
    if (busyRef.current || !flipOn) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (zoomedBeyondFit) {
      const vp = viewportRef.current;
      if (!vp) return;
      panRef.current = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
      el.setPointerCapture(e.pointerId);
      return;
    }
    // Sách chữ: kéo chuột để bôi đen chữ, không kéo lật (lật bằng nút/phím).
    const slotPage = slot === "left" ? left : right;
    if (slotPage && !slotPage.isImage) return;
    const leaf = leafForFlip(cur, dir, twoPage, rtl, total);
    if (!leaf) return;
    dragRef.current = { grabX: e.clientX, grabY: e.clientY, dir, spineLeft: leaf.spineLeft, next: leaf.next, rect };
    busyRef.current = true;
    curlRef.current = { dir, spineLeft: leaf.spineLeft, next: leaf.next, front: leaf.front, back: leaf.back };
    setCurlTarget(leaf.next);
    const dest = spreadSides(leaf.next, twoPage, rtl, total);
    void ensure(
      [dest.left, dest.right].filter((p): p is number => p !== null),
    );
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const pan = panRef.current;
    if (pan) {
      const vp = viewportRef.current;
      if (vp) {
        vp.scrollLeft = pan.sl - (e.clientX - pan.x);
        vp.scrollTop = pan.st - (e.clientY - pan.y);
      }
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const g = foldGeometry(
      { x: d.grabX, y: d.grabY },
      { x: e.clientX, y: e.clientY },
      d.rect.width,
    );
    const tilt = Math.max(-12, Math.min(12, g.creaseAngle * 17));
    applyPose(g.progress, d.spineLeft, tilt);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const g = foldGeometry(
      { x: d.grabX, y: d.grabY },
      { x: e.clientX, y: e.clientY },
      d.rect.width,
    );
    if (g.progress > 0.33) {
      // Lật hẳn từ đúng tư thế đang kéo.
      void (async () => {
        try {
          const dest = spreadSides(d.next, twoPage, rtl, total);
          await ensure(
            [dest.left, dest.right].filter((p): p is number => p !== null),
          );
          await new Promise<void>((resolve) => {
            animateCurl(d.spineLeft, g.progress, 1, resolve);
          });
          const next = d.next;
          setSpread(next);
          onProgress(next, total);
        } finally {
          curlRef.current = null;
          setCurlTarget(null);
          resetPose();
          busyRef.current = false;
        }
      })();
    } else {
      // Chưa đủ đà: lá nảy về chỗ cũ.
      animateCurl(d.spineLeft, g.progress, 0, () => {
        curlRef.current = null;
        setCurlTarget(null);
        resetPose();
        busyRef.current = false;
      });
    }
  };

  // Bôi đen chữ trong chương (chỉ sách chữ): thả chuột xong thì hiện thanh lưu gạch chân.
  const onSpreadMouseUp = () => {
    if (!isTextBook) return;
    for (const p of [cur, cur + 1]) {
      const el = spreadRef.current?.querySelector(
        `.epub-page[data-page="${p}"]`,
      ) as HTMLElement | null;
      if (!el) continue;
      const sel = selectionOffsets(el);
      if (sel && sel.text.trim().length > 0) {
        setPendingSelection({ ...sel, page: p });
        return;
      }
    }
  };

  const loadThumb = useCallback(
    (i: number): Promise<string | null> => {
      if (!thumbApi.thumb) return Promise.resolve(null);
      const produce = thumbApi.thumb;
      return thumbCacheRef.current.load(i, () => produce(i));
    },
    [thumbApi],
  );

  const renderFace = (p: ReaderPage | undefined, mirrored: boolean, pageIndex: number) => {
    if (!p) {
      return <div className="page-face page-loading">Đang tải trang…</div>;
    }
    const cropActive = p.isImage && hasCrop(crop);
    return (
      <div className="page-face" style={mirrored ? { transform: "scaleX(-1)" } : undefined}>
        {p.isImage ? (
          <img
            src={p.content}
            alt={p.label}
            draggable={false}
            style={cropActive ? cropImgStyle(crop) : undefined}
          />
        ) : (
          <div
            className="epub-page"
            data-page={pageIndex}
            dangerouslySetInnerHTML={{ __html: p.content }}
          />
        )}
      </div>
    );
  };

  // Lá đang lật (mặt trước = trang hiện tại, mặt sau = trang đích).
  // Khi không lật, lá ẩn (opacity 0) nên giá trị mặc định không quan trọng.
  const activeCurl = curlRef.current;
  const leafInfo =
    activeCurl ??
    leafForFlip(cur, 1, twoPage, rtl, total) ?? {
      front: cur,
      back: cur,
      spineLeft: !rtl,
      next: cur,
    };
  const leafSpineLeft = leafInfo.spineLeft;
  const leafFront = cacheRef.current.get(leafInfo.front);
  const leafBack = cacheRef.current.get(leafInfo.back);
  const leafFrontIndex = leafInfo.front;
  const leafBackIndex = leafInfo.back;
  // Đánh dấu ở 1 trong 2 trang của spread đang mở thì hiện ★.
  const bookmarkedHere = bookmarks.some(
    (b) => b.page === cur || (twoPage && b.page === cur + 1),
  );

  return (
    <div
      className={`reader${immersive ? " is-immersive" : ""}${immersive && !controlsVisible ? " controls-hidden" : ""}`}
    >
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
      <header className="reader-bar reader-top">
        <button onClick={onClose} title="Về thư viện (Esc)">
          ← Thư viện
        </button>
        <strong className="reader-title">{title}</strong>
        <span className="page-label">
          {cur + 1}
          {twoPage && shownSides.left !== null && shownSides.right !== null
            ? `–${cur + 2}`
            : ""}{" "}
          / {total}
          {bookmarkedHere ? " ★" : ""}
        </span>
        <button
          onClick={() => {
            setMenuOpen((v) => !v);
            pokeControls();
          }}
          title="Menu — mọi tính năng ở đây"
          aria-expanded={menuOpen}
        >
          ⋯ Menu
        </button>
        <button onClick={toggleImmersive} title="Đọc toàn màn hình (phím F)">
          {immersive ? "⛶ Thoát toàn màn hình" : "⛶ Toàn màn hình (F)"}
        </button>
        {menuOpen && (
          <div className="reader-menu" role="menu">
              <div className="menu-section">Chế độ đọc</div>
              <button onClick={toggleTwoPage}>
                {twoPage ? "▦ 2 trang ✓" : "▤ 1 trang"}
              </button>
              <button onClick={toggleRtl}>
                Manga phải → trái{rtl ? " ✓" : ""}
              </button>
              <button onClick={() => setFlipOn((v) => !v)}>
                Hiệu ứng lật trang: {flipOn ? "Bật" : "Tắt"}
              </button>
              <button onClick={toggleImmersive}>
                ⛶ Toàn màn hình (F){immersive ? " ✓" : ""}
              </button>
              <div className="menu-section">Công cụ</div>
              <button onClick={() => void toggleBookmark()}>
                ★ Đánh dấu trang này (B){bookmarkedHere ? " ✓" : ""}
              </button>
              <button onClick={() => openPanel("bookmarks")}>★ Danh sách đánh dấu</button>
              <button onClick={() => openPanel("search")}>🔍 Tìm trong sách (Ctrl+F)</button>
              <button onClick={() => openPanel("grid")}>🗂 Lưới trang (G)</button>
              <button onClick={() => openPanel("highlights")}>✏️ Gạch chân</button>
              <button
                onClick={() => {
                  setTtsOpen((v) => !v);
                  setMenuOpen(false);
                }}
              >
                🔊 Đọc thành tiếng (T){ttsState !== "idle" ? " ▶" : ""}
              </button>
              <button
                onClick={() => {
                  setDictOpen((v) => !v);
                  setMenuOpen(false);
                }}
              >
                📖 Từ điển
              </button>
              <button
                onClick={() => {
                  setShowCrop((v) => !v);
                  setMenuOpen(false);
                }}
              >
                ✂️ Cắt lề{hasCrop(crop) ? " ✓" : ""}
              </button>
              <div className="menu-section">Zoom &amp; vừa trang</div>
              <div className="menu-zoom">
                <button onClick={() => setZoom((z) => clampZoom(z / 1.2))} title="Thu nhỏ (-)">
                  −
                </button>
                <span>{Math.round(scale * 100)}%</span>
                <button onClick={() => setZoom((z) => clampZoom(z * 1.2))} title="Phóng to (+)">
                  +
                </button>
                <button onClick={() => setZoom(1)} title="Về 100% (phím 0)">
                  100%
                </button>
                <select
                  value={fit}
                  onChange={(e) => setFit(e.target.value as "page" | "width" | "height")}
                  title="Vừa trang"
                >
                  <option value="page">Vừa trang</option>
                  <option value="width">Vừa rộng</option>
                  <option value="height">Vừa cao</option>
                </select>
              </div>
              {zoomedBeyondFit && (
                <div className="menu-note">
                  Đang zoom: kéo chuột để rê trang, lật bằng nút ← →.
                </div>
              )}
              <div className="menu-section">Phím tắt</div>
              <div className="menu-note">
                ← → lật trang • F toàn màn hình • B đánh dấu • Ctrl+F tìm • G
                lưới trang • +/− zoom • 0 về 100% • T đọc thành tiếng • Esc
                thoát
                {isTextBook
                  ? " • Sách chữ: kéo chuột bôi đen để gạch chân / tra từ"
                  : ""}
              </div>
            </div>
        )}
      </header>

      {ttsOpen && (
        <div className="tts-bar">
          {!ttsAvailable ? (
            <span>
              Đọc thành tiếng chỉ dùng cho sách chữ (EPUB/MOBI) và PDF có lớp
              chữ — truyện ảnh không có chữ để đọc.
            </span>
          ) : (
            <>
              <button onClick={() => void startTts()} disabled={ttsState === "playing"}>
                ▶ Đọc từ trang này
              </button>
              <button onClick={toggleTtsPause} disabled={ttsState === "idle"}>
                {ttsState === "paused" ? "▶ Tiếp tục" : "⏸ Tạm dừng"}
              </button>
              <button onClick={stopTts} disabled={ttsState === "idle"}>
                ⏹ Dừng
              </button>
              <label>
                Tốc độ:{" "}
                <select value={ttsRate} onChange={(e) => setTtsRate(Number(e.target.value))}>
                  <option value={0.75}>0.75×</option>
                  <option value={1}>1×</option>
                  <option value={1.25}>1.25×</option>
                  <option value={1.5}>1.5×</option>
                  <option value={2}>2×</option>
                </select>
              </label>
              <label>
                Giọng:{" "}
                <select
                  value={ttsVoiceURI ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setTtsVoiceURI(v);
                    try {
                      if (v) localStorage.setItem("mio-tts-voice", v);
                      else localStorage.removeItem("mio-tts-voice");
                    } catch {
                      // Bỏ qua lỗi lưu.
                    }
                  }}
                >
                  <option value="">Mặc định hệ thống</option>
                  {ttsVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {ttsMsg && <span className="muted">{ttsMsg}</span>}
          <span className="muted">
            Giọng đọc lấy từ Windows — máy chưa cài giọng Việt thì chỉ có
            giọng Anh. Đọc hết trang thì tự lật sang trang sau. Sách chữ tô
            cam câu đang đọc; PDF chỉ đọc tiếng, không tô câu.
          </span>
        </div>
      )}

      {dictOpen && <DictionaryBox word={dictWord} onWordChange={setDictWord} />}

      {showCrop && (
        <div className="crop-bar">
          <button onClick={() => void autoDetectCrop()} disabled={cropBusy}>
            {cropBusy ? "Đang quét…" : "Tự phát hiện lề trắng"}
          </button>
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <label key={side}>
              {side === "top" ? "Trên" : side === "right" ? "Phải" : side === "bottom" ? "Dưới" : "Trái"}{" "}
              {crop[side]}%
              <input
                type="range"
                min={0}
                max={40}
                value={crop[side]}
                onChange={(e) => setCrop((c) => clampCrop({ ...c, [side]: Number(e.target.value) }))}
              />
            </label>
          ))}
          <button
            onClick={() => {
              setCrop(NO_CROP);
              setCropMsg("");
            }}
          >
            Xóa cắt lề
          </button>
          <span className="muted">Chỉ cắt lúc hiển thị trang ảnh, không sửa file gốc.</span>
          {cropMsg && <span className="muted">{cropMsg}</span>}
        </div>
      )}

      {pendingSelection && (
        <div className="hl-bar">
          <span>
            Đã chọn “{pendingSelection.text.length > 60 ? pendingSelection.text.slice(0, 60) + "…" : pendingSelection.text}”
          </span>
          {HL_COLORS.map((c) => (
            <button
              key={c.id}
              className={`color-swatch${hlColor === c.id ? " sel" : ""}`}
              style={{
                backgroundColor:
                  c.id === "yellow" ? "#ffe066" : c.id === "pink" ? "#ffb3c7" : c.id === "green" ? "#b7f0b1" : "#a8d8ff",
              }}
              title={c.label}
              onClick={() => setHlColor(c.id)}
            >
              {hlColor === c.id ? "✓" : ""}
            </button>
          ))}
          <input
            value={hlNote}
            onChange={(e) => setHlNote(e.target.value)}
            placeholder="Ghi chú (tùy chọn)"
          />
          <button onClick={() => void saveHighlight()}>Lưu gạch chân</button>
          <button
            onClick={() => {
              const words = pendingSelection.text.trim().split(/\s+/);
              const w = words.length <= 2 ? pendingSelection.text.trim() : words[0];
              setDictWord(w);
              setDictOpen(true);
            }}
          >
            📖 Tra từ
          </button>
          <button
            onClick={() => {
              setPendingSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            Hủy
          </button>
        </div>
      )}

      <div className="reader-body">
        <div className="spread-viewport" ref={viewportRef}>
          <div
            className="spread-scaler"
            style={{ width: baseW * scale, height: Math.max(1, baseH * scale) }}
          >
            <div
              className="spread"
              ref={spreadRef}
              style={{
                perspective: "1600px",
                width: baseW,
                transform: `scale(${scale})`,
                transformOrigin: "top center",
              }}
              onMouseUp={onSpreadMouseUp}
            >
              {/* Trang nền bên trái */}
              <div
                className="page-slot"
                onPointerDown={(e) => onPointerDown(e, rtl ? 1 : -1, "left")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {renderFace(left, false, leftIndex ?? shownSpread)}
              </div>
              {twoPage && (
                <div
                  className="page-slot"
                  onPointerDown={(e) => onPointerDown(e, rtl ? -1 : 1, "right")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  {renderFace(right, false, rightIndex ?? shownSpread + 1)}
                </div>
              )}
              {/* Bóng đổ lên trang đích, đậm dần giữa chừng lật. */}
              <div ref={shadowRef} className={`curl-shadow${leafSpineLeft ? "" : " flip"}`} style={{ left: leafSpineLeft ? "0" : "50%" }} />
              {/* Lá đang lật: chỉ ôm 1 trang, xoay quanh gáy. Mặt trước = trang
                  hiện tại, mặt sau = trang đích. CHÚ Ý (v0.2.0): mặt sau KHÔNG
                  soi gương sẵn nữa — `.leaf-back { rotateY(180deg) }` trong
                  CSS đã tự triệt tiêu phép soi gương khi lá xoay đủ 180°;
                  soi thêm scaleX(-1) như bản 0.1.5 làm trang đích hiện
                  ngược trong suốt nửa sau của cú lật. */}
              <div
                ref={leafRef}
                className="curl-leaf"
                style={{
                  left: twoPage ? (leafSpineLeft ? "50%" : "0") : "0",
                  width: twoPage ? "50%" : "100%",
                  opacity: 0,
                }}
              >
                <div className="leaf-front">{renderFace(leafFront, false, leafFrontIndex)}</div>
                <div className="leaf-back">{renderFace(leafBack, false, leafBackIndex)}</div>
                <div ref={creaseRef} className={`leaf-crease${leafSpineLeft ? "" : " flip"}`} style={{ right: leafSpineLeft ? "auto" : 0, left: leafSpineLeft ? 0 : "auto" }} />
              </div>
            </div>
          </div>
        </div>

        {panel !== "none" && (
          <ReaderPanels
            tab={panel}
            onTab={setPanel}
            onClose={() => setPanel("none")}
            total={total}
            cur={cur}
            isTextBook={isTextBook}
            bookmarks={bookmarks}
            onAddBookmark={(label) => void addBookmarkWithLabel(label)}
            onJumpTo={jumpTo}
            onDeleteBookmark={(id) => {
              void api.bookmarkDelete(id).then(() => refreshBookmarks());
            }}
            searchSupported={searchApi.search !== null}
            searchQuery={searchQuery}
            onSearchQuery={setSearchQuery}
            onSearch={() => void runSearch()}
            searching={searching}
            searchDone={searchDone}
            searchTotal={searchTotal}
            searchResults={searchResults}
            onJumpSearch={jumpToSearchResult}
            onCancelSearch={() => searchAbortRef.current?.abort()}
            highlights={highlights}
            onDeleteHighlight={(id) => {
              void api.highlightDelete(id).then(() => refreshHighlights());
            }}
            onJumpHighlight={(h) => jumpTo(h.page)}
            thumbFor={thumbApi.thumb ? loadThumb : null}
            chapterTitles={thumbApi.chapterTitles}
            rtl={rtl}
          />
        )}
      </div>

      <footer className="reader-bar reader-bottom">
        <button onClick={() => void commit(-1)} disabled={cur <= 0} title="Trang trước (←)">
          ←
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={cur}
          style={{ direction: rtl ? "rtl" : "ltr" }}
          title={`Trang ${cur + 1} / ${total}`}
          onChange={(e) => {
            const n = Number(e.target.value);
            stopTtsRef.current();
            void ensure([n, n + 1]);
            setSpread(spreadStartForPage(n, twoPage, rtl, total));
            onProgress(n, total);
          }}
        />
        <button onClick={() => void commit(1)} disabled={nextSpread === null} title="Trang sau (→)">
          →
        </button>
        <span className="page-label">
          {cur + 1} / {total}
        </span>
      </footer>
    </div>
  );
}

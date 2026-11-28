import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { easeOutCubic, easeOutQuint, easeInOutCubic, FLIP_MS, FLIP_MOUNT_K, FLIP_MOUNT_T, lerpPt, clampDragPoint, clampPullAngle, dragFrac, dragSettleMs, tweenPoint, quadBezier, type Pt } from "../lib/curl";
import { computeSpreadLayout, curlAnchors, curlArcControl } from "../lib/layout";
import { CurlLeaf, type CurlLeafHandle } from "./CurlLeaf";
import {
  flipBaseSides,
  leafForFlip,
  lookaheadPages,
  nextSpreadStart,
  spreadSides,
  spreadStartForPage,
  type LeafFlip,
} from "../lib/spread";
import { PendingMap } from "../lib/pending";
import { WarmImageCache } from "../lib/warmImages";
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
import {
  BookmarksSheet,
  GridSheet,
  HighlightsSheet,
  MenuSheet,
  SearchSheet,
  TypoSheet,
  type SheetKind,
} from "./ReaderSheets";
import { isComicFormat } from "../lib/spread";

export interface ReaderPage {
  /** Ảnh (URL protocol `mio-page://` hoặc data URL) hoặc HTML chương EPUB. */
  content: string;
  isImage: boolean;
  label: string;
  /** v0.3.9: fallback khi ảnh protocol lỗi (vd file đã đổi/xóa sau khi
   *  mở) — trả về data URL base64 qua lệnh `cbz_page`. Reader dùng nó
   *  trong `onError` của <img>, chỉ thử 1 lần rồi thôi. */
  fallback?: () => Promise<string>;
}

/** Trạng thái một cú lật cong đang diễn ra (đủ để mount CurlLeaf).
 *  Mặt trước = trang đang đọc, mặt sau = trang đích. Cell + điểm nắm
 *  theo tọa độ spread (layout px, chưa scale). */
interface CurlState {
  front: number;
  back: number;
  cellX: number;
  cellW: number;
  grab: Pt;
  mirror: Pt;
  next: number;
  dir: 1 | -1;
  /** v0.3.9: điểm giữ lúc mount lá — PHẢI chếch vào trong cú lật
   *  (path(FLIP_MOUNT_K) với lật phím/nút, điểm tay hiện tại với
   *  lật kéo). Trước đây JSX truyền point=grab nên foldGeometry trả
   *  null, CurlLeaf trả null, lá tàng hình suốt cả cú lật (v0.3.7–
   *  v0.3.8). Xem lib/curl.ts ensureFoldPoint. */
  point: Pt;
  /** Nền từng bên trong lúc lật (tính sẵn cho đúng cú lật này, dọn cùng
   *  lúc với lá — mô hình bản web, thay cho curlTarget toàn cục). */
  base: { left: number | null; right: number | null };
}

/** Trạng thái một cú kéo lật đang diễn ra (đã mount lá). */
interface DragState {
  grab: Pt;
  from: Pt;
  to: Pt;
  dir: 1 | -1;
  next: number;
  vel: number;
  lastT: number;
  lastPoint: Pt;
  grabClientX: number;
  grabClientY: number;
}

/** Chuột/chạm vừa bấm xuống, chưa đủ 9px để thành cú kéo (bản web:
 *  pendingDragRef) — chỉ ghi nhận, chưa mount lá, chưa khóa lật. */
interface PendingDrag {
  pointerId: number;
  startX: number;
  startY: number;
  dir: 1 | -1;
  /** v0.3.9: mặt bấm xuống có phải ảnh không. Sách chữ: kéo là bôi đen
   *  chữ (không kéo lật), nhưng chạm nhẹ (<8px) vẫn lật trang — trước
   *  đây chạm vào trang chữ không làm gì cả. */
  isImage: boolean;
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
  /** Thông tin sách cho menu ⋯, vd "EPUB · 2,4 MB" (App tính sẵn). */
  bookInfo: string;
  /** Menu ⋯ > Thống kê đọc: đóng sách rồi mở màn Thống kê (App xử lý). */
  onOpenStats: () => void;
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
  bookInfo,
  onOpenStats,
}: Props) {
  const isTextBook = format === "epub" || format === "mobi";
  const isComic = isComicFormat(format);
  const ttsAvailable = isTextBook || format === "pdf";
  // Chế độ đọc của cuốn này: cài đặt đã lưu thắng, chưa lưu thì lấy mặc
  // định chung của App (checkbox Manga ở thư viện). Đổi trong menu (⋯)
  // thì nhớ theo từng cuốn.
  const initTwoPage = initialSettings?.twoPage ?? true;
  // Chiều đọc: App đã giải quyết xong (cài đặt riêng > auto-RTL truyện
  // tranh > mặc định chung) qua resolveInitialRtl — Reader dùng thẳng
  // giá trị này, không tự tính lại.
  const initRtl = rtlDefault;
  const [spread, setSpread] = useState(() =>
    spreadStartForPage(startPage, initTwoPage, initRtl, total),
  );
  const [twoPage, setTwoPage] = useState(initTwoPage);
  const [rtl, setRtl] = useState(initRtl);
  // Hiệu ứng lật trang luôn bật (v0.3.0: menu thiết kế không có công tắc
  // này nữa; giữ biến để logic commit/drag không đổi).
  const flipOn = true;
  // ---- v0.2.0: chế độ đọc toàn màn hình "chìm" (immersive) ----
  // Chỉ còn trang sách + thanh tiến độ mỏng + cụm nút nổi (tự ẩn sau
  // ~2.5s không cử động chuột). Trạng thái này KHÔNG phụ thuộc vào
  // Fullscreen API: nếu WebView chặn requestFullscreen thì CSS vẫn ẩn
  // hết chrome như thường (fallback đã kiểm bằng code, xem README).
  const [immersive, setImmersive] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<number | null>(null);
  // ---- v0.3.0: sheet trượt phải thay cho menu thả xuống + panel bên ----
  // 1 sheet mở tại 1 thời điểm: menu ⋯ / chữ & nền / tìm / lưới / đánh dấu / gạch chân.
  const [sheet, setSheet] = useState<SheetKind>(null);
  // Thanh trượt trang dưới (v0.3.4): giá trị đang kéo, chỉ nhảy trang khi
  // thả ra — xem commitSlider ở cuối component.
  const [sliderVal, setSliderVal] = useState<number | null>(null);
  // Toast nổi dưới màn hình (xác nhận thao tác trong menu, lỗi TTS...).
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  // v0.3.9: giữ lại giá trị cacheVersion — effect thử lại trang lỗi
  // cần chạy lại mỗi khi cache đổi (trang vừa nạp xong thì không thử
  // lại nữa). Trước đây giá trị bị bỏ (chỉ dùng setter).
  const [cacheVersion, setCacheVersion] = useState(0);

  // ---- v0.3.4: tỉ lệ thật của từng trang ảnh (rộng/cao) ----
  // Trước đây spread rộng cố định 1200px, mỗi slot chia đôi đúng 600px,
  // ảnh truyện cao (tỉ lệ ~0.7) thì `object-fit: contain` để lại 2 dải
  // đen to 2 bên mỗi trang — gộp lại thành khe đen lớn ở gáy (ảnh Thiện
  // gửi) và spread 1200px * scale còn tràn ngang cửa sổ. Giờ mỗi slot ôm
  // đúng tỉ lệ ảnh: rộng = tỉ lệ * chiều cao spread, 2 trang khít nhau
  // ở gáy, không còn dải đen thừa.
  const aspectRef = useRef(new Map<number, number>());
  const [, setAspectVersion] = useState(0);
  const noteAspect = useCallback((index: number, w: number, h: number) => {
    if (!w || !h) return;
    const a = w / h;
    if (aspectRef.current.get(index) !== a) {
      aspectRef.current.set(index, a);
      setAspectVersion((v) => v + 1);
    }
  }, []);

  // ---- v0.3.0: sheet trượt phải (menu ⋯ + các bảng) ----
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // ---- P1: zoom / fit ----
  const [zoom, setZoom] = useState(initialSettings?.zoom ?? 1);
  const [fit, setFit] = useState<"page" | "width" | "height">(initialSettings?.fit ?? "page");
  const [vpSize, setVpSize] = useState({ w: 1200, h: 700 });
  const [baseH, setBaseH] = useState(600);

  // ---- v0.3.0: chữ & nền trang (sách chữ) — nhớ theo từng cuốn ----
  const [fontSize, setFontSize] = useState(initialSettings?.fontSize ?? 15.5);
  const [lineHeight, setLineHeight] = useState(initialSettings?.lineHeight ?? 1.78);
  const [fontSans, setFontSans] = useState(initialSettings?.fontSans ?? false);
  const [pageTheme, setPageTheme] = useState<"light" | "paper" | "night">(
    initialSettings?.pageTheme ?? "light",
  );

  // ---- P1: cắt lề (chỉ trang ảnh) ----
  const [crop, setCrop] = useState<CropMargins>(initialSettings?.crop ?? NO_CROP);
  const [cropAuto, setCropAuto] = useState(() => hasCrop(initialSettings?.crop ?? NO_CROP));
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
  // v0.3.10: trang nào đã giải mã xong (xem decodeImages) — lookahead
  // giải mã trước spread kề trong lúc rảnh, lúc bấm lật thì decodeImages
  // bỏ qua hết (không tạo lại Image, không giải mã lại) nên tween không
  // còn việc nặng giữa chừng. Trang chỉ vào tập này sau khi decode
  // thành công; nội dung trang ổn định trong 1 lần mở sách nên không
  // cần dọn (mở sách khác thì component mount lại, ref reset).
  const decodedRef = useRef(new Set<number>());
  // v0.3.12: ảnh đã giải mã được GIỮ SỐNG (xem lib/warmImages.ts) —
  // lookahead decode xong mà thả Image thì GC thu hồi bitmap, lần
  // mount <img> sau lại phải fetch qua protocol + decode lại nên slot
  // trang đích đen ~200ms lúc lật bắt đầu (video 28/11). Giữ tối đa
  // 8 ảnh (LRU): đủ spread hiện tại + lookahead 2 hướng + mặt lá.
  const warmImagesRef = useRef(new WarmImageCache(8));
  // v0.3.8: dedup các lần nạp đang chờ theo trang (bản web: pendingRef) —
  // trang đang inflight thì caller chờ đúng promise đó thay vì tiến hành
  // với trang trống (xem PendingMap, src/lib/pending.ts).
  const pendingRef = useRef(new PendingMap());
  const busyRef = useRef(false);
  const spreadRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // ---- v0.3.7: lá lật cong thật (port từ bản web) ----
  // `curl` (state) mount lá + mặt trước/sau; `curlRef` là bản sao cho
  // các driver (kéo/tween) đọc không cần re-render; `leafRef` là tay
  // cầm imperative của CurlLeaf (viết style thẳng vào DOM từng frame).
  const [curl, setCurlState] = useState<CurlState | null>(null);
  const curlRef = useRef<CurlState | null>(null);
  const leafRef = useRef<CurlLeafHandle | null>(null);
  // v0.3.10: 2 mặt lá ĐÓNG BĂNG lúc mount (xem startFlip/beginDragFlip)
  // — mặt sau không được bật từ placeholder "Đang tải trang…" thành
  // ảnh thật giữa chừng (1 cú giật khung hình ở v0.3.9). Dọn cùng lúc
  // với lá ở finishFlip/cancelFlip.
  const leafFacesRef = useRef<{ front: ReactNode; back: ReactNode } | null>(null);
  const cancelTweenRef = useRef<(() => void) | null>(null);
  const pointRafRef = useRef(0);
  const pendingPointRef = useRef<Pt | null>(null);
  // Kéo chuột: điểm nắm + điểm đáp (tọa độ spread), vận tốc đã làm mượt
  // dọc trục lật (để flick-to-turn khi thả), điểm bấm lúc đầu (client
  // px) để nhận biết chạm nhẹ.
  const dragRef = useRef<DragState | null>(null);
  // v0.3.8: bấm xuống chưa đủ 9px thì chỉ ghi nhận (chưa mount lá —
  // bản web: pendingDragRef); vị trí chuột mới nhất để tính điểm giữ
  // lúc mount; cờ mount đang chờ decode (thả tay giữa chừng thì hủy).
  const pendingDragRef = useRef<PendingDrag | null>(null);
  const latestClientRef = useRef({ x: 0, y: 0 });
  const dragMountingRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const thumbCacheRef = useRef(new ThumbCache(60));
  const settingsSavedRef = useRef(false);

  // ---- v0.2.0: toàn màn hình "chìm" ----
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
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
    setSheet(null);
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
  // Trang ở mỗi bên của spread hiện tại (RTL: trang đọc trước nằm bên
  // PHẢI, trang sau bên TRÁI).
  const curSides = spreadSides(cur, twoPage, rtl, total);
  // v0.3.8: nền hiển thị trong lúc lật tính sẵn cho đúng cú lật đó
  // (curl.base — mô hình bản web) và dọn cùng lúc với lá; không lật
  // thì nền bằng spread hiện tại. Trước đây dùng curlTarget toàn cục
  // (spread đích) nên nền không gắn với cú lật cụ thể.
  const shownSides = curl ? curl.base : curSides;
  const left = shownSides.left !== null ? cacheRef.current.get(shownSides.left) : undefined;
  const right = shownSides.right !== null ? cacheRef.current.get(shownSides.right) : undefined;
  const leftIndex = shownSides.left;
  const rightIndex = shownSides.right;
  // Spread tiếp theo theo chiều đọc (để nạp trước khi lật tới).
  const nextSpread = nextSpreadStart(cur, 1, twoPage, rtl, total);

  // ---- Đo kích thước để tính zoom/fit ----
  // Trang ảnh thì mỗi slot ôm đúng tỉ lệ ảnh (v0.3.4, xem noteAspect):
  // rộng = tỉ lệ * chiều cao spread; chưa biết tỉ lệ thì tạm 0.72 (tỉ lệ
  // truyện tranh thường gặp), ảnh nạp xong sẽ chỉnh lại đúng tỉ lệ thật.
  // Sách chữ giữ chia đôi như cũ (chữ tự chảy đầy slot).
  // v0.3.7: toán sizing nằm ở lib/layout (computeSpreadLayout) để test
  // số được — công thức giữ nguyên v0.3.4.
  // v0.3.8: kích thước slot theo spread HIỆN TẠI (curSides), không theo
  // nền đang lật — nền có thể hiện trang đích (tỉ lệ khác) nhưng slot
  // không được đổi rộng giữa chừng, lá sẽ rách khỏi cell.
  const curLeft = curSides.left !== null ? cacheRef.current.get(curSides.left) : undefined;
  const curRight = curSides.right !== null ? cacheRef.current.get(curSides.right) : undefined;
  const useAspectSlots = Boolean(curLeft?.isImage || curRight?.isImage || isComic);
  const leftAspect =
    curSides.left !== null ? (aspectRef.current.get(curSides.left) ?? 0.72) : null;
  const rightAspect =
    curSides.right !== null ? (aspectRef.current.get(curSides.right) ?? 0.72) : null;
  const layout = computeSpreadLayout({
    vpW: vpSize.w,
    vpH: vpSize.h,
    baseH,
    leftAspect,
    rightAspect,
    twoPage,
    useAspectSlots,
    fit,
    zoom,
  });
  const { naturalW, fitScale, scale, leftSlotW, rightSlotW } = layout;
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

  // v0.3.6: chặn bôi đen / kéo-thả native ngay tại sự kiện (truyện tranh)
  // — lớp chặn thứ 2 sau CSS user-select:none. React không có prop
  // onSelectStart cho div nên gắn trực tiếp. Sách chữ không chặn để vẫn
  // bôi đen làm gạch chân / tra từ được.
  useEffect(() => {
    const el = spreadRef.current;
    if (!el || !useAspectSlots) return;
    const block = (e: Event) => e.preventDefault();
    el.addEventListener("selectstart", block);
    el.addEventListener("dragstart", block);
    return () => {
      el.removeEventListener("selectstart", block);
      el.removeEventListener("dragstart", block);
    };
  }, [useAspectSlots]);

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

  // ---- Lưu cài đặt riêng cuốn này (zoom/fit/crop/2-trang/manga/chữ/nền), debounce 500ms ----
  useEffect(() => {
    if (!settingsSavedRef.current) {
      settingsSavedRef.current = true;
      return;
    }
    const t = setTimeout(() => {
      void api
        .historySettingsSave(
          bookId,
          JSON.stringify({ zoom, fit, crop, twoPage, rtl, fontSize, lineHeight, fontSans, pageTheme }),
        )
        .catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [zoom, fit, crop, twoPage, rtl, fontSize, lineHeight, fontSans, pageTheme, bookId]);

  // v0.3.8: nạp trang, dedup bằng PendingMap (bản web: pendingRef) —
  // trang đang inflight thì caller chờ đúng promise đó thay vì tiến
  // hành với trang trống. Trước đây ensure bỏ qua trang inflight rồi
  // trả về ngay, nên flip commit trong khi trang đích chưa có trong
  // cache, nhãn đổi trước còn ảnh cũ giải mã xong sau thì hiện sai.
  const ensure = useCallback(
    async (indices: number[]): Promise<void> => {
      let started = false;
      const jobs: Promise<void>[] = [];
      for (const i of indices) {
        if (i < 0 || i >= total) continue;
        if (cacheRef.current.has(i)) continue;
        const pending = pendingRef.current.get(i);
        if (pending) {
          jobs.push(pending);
          continue;
        }
        started = true;
        jobs.push(
          pendingRef.current.start(i, async () => {
            try {
              const p = await loadPage(i);
              cacheRef.current.set(i, p);
            } catch {
              // Để trống, lần sau lật tới sẽ thử nạp lại.
            }
          }),
        );
      }
      if (jobs.length === 0) return;
      await Promise.all(jobs);
      if (started) setCacheVersion((v) => v + 1);
    },
    [loadPage, total],
  );

  // Lật tới đâu nạp tới đó: spread hiện tại + spread đích.
  useEffect(() => {
    const pages = [cur, cur + 1];
    if (nextSpread !== null) pages.push(nextSpread, nextSpread + 1);
    void ensure(pages);
  }, [cur, nextSpread, ensure]);

  // v0.3.9: trang hiện tại nạp lỗi thì thử lại sau 1.5s (tối đa 2 lần
  // mỗi spread). Trước đây trang lỗi thì kẹt ở "Đang tải trang…" cho
  // tới khi đổi spread — vì effect nạp chỉ chạy khi cur đổi, và ensure
  // nuốt lỗi nạp không thử lại. Đây là cơ chế gây "trang đen 7 giây"
  // ở video 2: img chưa decode thì slot đen, không có gì kích hoạt
  // nạp lại. Giới hạn 2 lần để trang hỏng hẳn không thử lại vô hạn.
  const retryStateRef = useRef({ cur: -1, count: 0 });
  useEffect(() => {
    if (retryStateRef.current.cur !== cur) {
      retryStateRef.current = { cur, count: 0 };
    }
    const t = setTimeout(() => {
      const pages = [cur, cur + 1];
      if (nextSpread !== null) pages.push(nextSpread, nextSpread + 1);
      const missing = pages.filter(
        (p) => p >= 0 && p < total && !cacheRef.current.has(p) && !pendingRef.current.has(p),
      );
      if (missing.length > 0 && retryStateRef.current.count < 2) {
        retryStateRef.current.count++;
        void ensure(missing);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [cur, nextSpread, total, cacheVersion, ensure]);

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

  // decodeImages phải khai báo trước jumpTo (jumpTo dùng nó).
  const decodeImages = useCallback(async (indices: number[], pages: (ReaderPage | undefined)[]) => {
    await Promise.all(
      pages.map(async (p, k) => {
        if (!p?.isImage) return;
        const idx = indices[k]!;
        // v0.3.10: trang đã giải mã rồi thì bỏ qua — lật không phải
        // trả giá giải mã lại, và tween không còn việc nặng giữa chừng
        // (lookahead đã giải mã trước spread đích trong lúc rảnh).
        // v0.3.12: chỉ bỏ qua khi ảnh còn được GIỮ SỐNG trong warm
        // cache — trang đã decode mà bị đẩy khỏi warm cache (LRU) thì
        // decode lại để hâm nóng (cache-hit nên nhanh, chạy nền).
        if (decodedRef.current.has(idx) && warmImagesRef.current.has(p.content)) return;
        try {
          const img = new Image();
          img.src = p.content;
          await img.decode();
          decodedRef.current.add(idx);
          warmImagesRef.current.add(p.content, img);
          noteAspect(idx, img.naturalWidth, img.naturalHeight);
        } catch {
          // Giải mã lỗi thì cứ lật tiếp, ảnh sẽ hiện khi trình duyệt nạp xong.
        }
      }),
    );
  }, [noteAspect]);

  // v0.3.10: LOOKAHEAD — nạp + giải mã TRƯỚC spread kề (tới + lui)
  // trong lúc đang đọc, khi máy rảnh (300ms sau khi spread yên).
  // (Effect này phải đặt SAU decodeImages — deps của useEffect tính
  // ngay lúc render nên dùng biến khai báo sau sẽ lỗi TDZ.)
  // v0.3.9 lật ngay nhưng decode chạy nền TRONG lúc tween: ensure
  // xong tăng cacheVersion -> re-render cả Reader giữa chừng, mặt sau
  // lá bật từ placeholder thành ảnh thật giữa chừng — mỗi cái là 1 cú
  // giật khung hình. Lookahead dời hết việc nặng ra khỏi tween: lúc
  // bấm lật, trang đích đã nằm sẵn trong cache + đã giải mã, lá chỉ
  // việc chạy. Nếu người dùng lật trước khi lookahead chạy xong thì
  // cú lật vẫn chạy ngay như v0.3.9 (placeholder thay vì đứng hình).
  // Lật nhanh liên tục thì timeout bị hủy theo mỗi lần đổi spread nên
  // không tranh việc với tween.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (busyRef.current) return; // đang lật thì thôi, lật xong effect chạy lại
      const pages = lookaheadPages(cur, twoPage, rtl, total);
      if (pages.length === 0) return;
      void (async () => {
        try {
          await ensure(pages);
          await decodeImages(
            pages,
            pages.map((p) => cacheRef.current.get(p)),
          );
        } catch {
          // Kệ — lật vẫn chạy, mặt lá hiện placeholder rồi tự nét.
        }
      })();
    }, 300);
    return () => window.clearTimeout(t);
  }, [cur, nextSpread, total, twoPage, rtl, ensure, decodeImages]);

  // v0.3.9: chờ 1 promise nhưng tối đa `ms` — quá hạn thì tiếp tục với
  // trang placeholder thay vì treo mãi (vd Rust invoke treo, img.decode
  // treo). Lần nạp gốc vẫn chạy nền và điền cache khi xong; effect thử
  // lại sẽ hiện trang khi nạp được.
  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);

  // Nhảy tới 1 trang bất kỳ (bookmark / highlight / lưới / tìm).
  // v0.3.8: chờ nạp + giải mã xong mới đổi spread — trước đây nhảy
  // ngay (void ensure) nên nhãn đổi trước, ảnh về sau (lệch nhãn/ảnh).
  // decodeImages phải khai báo trước jumpTo (jumpTo dùng nó).
  // v0.3.9: hủy lá đang lật trước (trước đây nhảy giữa lúc lật để lại
  // curl.base cũ hiển thị trong khi cur đã đổi — nhãn 1 mà ảnh là
  // spread cuối), và chờ tối đa 8s rồi nhảy tiếp với placeholder.
  const jumpTo = useCallback(
    async (page: number) => {
      // Lật tay thì dừng TTS (trừ lúc TTS tự lật sang trang sau).
      if (!ttsAutoRef.current) stopTtsRef.current();
      cancelFlip();
      const n = Math.max(0, Math.min(total - 1, page));
      const pages = [n, n + 1];
      await withTimeout(
        (async () => {
          await ensure(pages);
          await decodeImages(
            pages,
            pages.map((p) => cacheRef.current.get(p)),
          );
        })(),
        8000,
      );
      setSpread(spreadStartForPage(n, twoPage, rtl, total));
      onProgress(n, total);
      setSheet(null);
    },
    // cancelFlip không nằm trong deps vì khai báo sau jumpTo (TDZ) —
    // nhưng nó ổn định (deps của nó đều ổn định: stopTween,
    // cancelPendingPoint, setCurl) nên closure không bị cũ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total, twoPage, rtl, ensure, decodeImages, onProgress],
  );

  // App yêu cầu nhảy tới kết quả tìm PDF: nạp lại trang đó (đã có highlight
  // vàng do App bật qua loadPage) rồi nhảy tới.
  useEffect(() => {
    if (!jumpRequest) return;
    const page = jumpRequest.page;
    cacheRef.current.delete(page);
    // Buộc nạp lại trang đó (bỏ cả lần nạp đang chờ — lần nạp cũ
    // không có highlight vàng của kết quả tìm).
    pendingRef.current.delete(page);
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

  /** Bật/tắt đọc thành tiếng: nút 🔊 trên thanh pill, phím T, menu ⋯. */
  const toggleTts = useCallback(() => {
    if (!ttsAvailable) {
      showToast(
        "Đọc thành tiếng chỉ dùng cho sách chữ (EPUB/MOBI) và PDF có lớp chữ — truyện ảnh không có chữ để đọc.",
      );
      return;
    }
    if (ttsState === "playing" || ttsState === "paused") stopTts();
    else void startTts();
  }, [ttsAvailable, ttsState, stopTts, startTts, showToast]);
  const toggleTtsRef = useRef<() => void>(() => {});
  useEffect(() => {
    toggleTtsRef.current = toggleTts;
  });

  // Lỗi TTS (trang không có chữ...) thì báo bằng toast thay vì thanh riêng.
  useEffect(() => {
    if (ttsMsg && ttsState === "idle") showToast(ttsMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsMsg]);

  // ================================================================
  // v0.3.7 — LÁ LẬT CONG THẬT (port từ bản web phan-mem-doc-sach).
  //
  // Lá cũ là một tấm phẳng rotateY quanh gáy + một dải bóng/nếp giả
  // chỉ đổi opacity — nhìn cứng, không cong như giấy thật, và người
  // dùng kêu "hiệu ứng cực kém, lật bị lỗi". Lá mới (CurlLeaf) dùng
  // đúng fold geometry của bản web: nếp gấp = đường trung trực của
  // đoạn (điểm nắm → điểm nắm phản chiếu qua gáy), mặt sau phản chiếu
  // qua nếp gấp, bóng đổ + nếp gấp + vệt sáng bám đúng theo góc lật.
  // Lá chỉ mount khi đang lật; điểm giữ được ghi thẳng vào DOM của lá
  // (imperative handle), không render lại React giữa lúc lật.
  // ================================================================

  /** Đưa viewport về đầu (v0.3.7): scroll cũ còn sót sau khi vào/ra
   *  full màn sẽ làm spread lệch hẳn sang một bên với khoảng đen lớn
   *  bên kia — video 27/11. */
  const resetViewportScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (vp) {
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    }
  }, []);

  /** Mount/gỡ lá lật: `curl` (state) cho React render, `curlRef` cho
   *  các driver (kéo/tween) đọc không cần re-render. */
  const setCurl = useCallback((c: CurlState | null) => {
    curlRef.current = c;
    setCurlState(c);
  }, []);

  const stopTween = useCallback(() => {
    cancelTweenRef.current?.();
    cancelTweenRef.current = null;
  }, []);

  /** Vẽ điểm giữ lên lá ngay: ghi sổ + viết thẳng vào DOM của lá. */
  const applyPoint = useCallback((p: Pt) => {
    leafRef.current?.update(p);
  }, []);

  /** Gom các điểm kéo về 1 lần vẽ mỗi khung hình (khỏi vẽ dồn). */
  const pushPoint = useCallback((p: Pt) => {
    pendingPointRef.current = p;
    if (!pointRafRef.current) {
      pointRafRef.current = requestAnimationFrame(() => {
        pointRafRef.current = 0;
        const pt = pendingPointRef.current;
        pendingPointRef.current = null;
        if (pt) leafRef.current?.update(pt);
      });
    }
  }, []);

  const cancelPendingPoint = useCallback(() => {
    if (pointRafRef.current) cancelAnimationFrame(pointRafRef.current);
    pointRafRef.current = 0;
    pendingPointRef.current = null;
  }, []);

  /** Kết thúc một cú lật: đáp đúng spread đích, dọn lá + khóa lật. */
  const finishFlip = useCallback(
    (next: number) => {
      busyRef.current = false;
      cancelPendingPoint();
      setSpread(next);
      onProgress(next, total);
      setCurl(null);
      // v0.3.10: dọn cả 2 mặt lá đã đóng băng — không còn dải mỏng/mảnh
      // trang nào sót lại trên spread đã yên.
      leafFacesRef.current = null;
      // KHÔNG reset scroll ở đây: người đang zoom to + rê trang thì lật
      // xong phải giữ nguyên vị trí rê; scroll cũ chỉ cần reset khi
      // vào/ra full màn (xem effect ở dưới).
      // v0.3.5: kéo lật có thể để trình duyệt bôi đen trang ảnh (trang
      // bị nhuộm xanh, video Thiện gửi) — xóa bôi đen sau mỗi lần lật.
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* bỏ qua */
      }
    },
    [cancelPendingPoint, onProgress],
  );

  /** Hủy cú lật đang chạy: đổi bố cục giữa chừng thì lá rách vì cell/
   *  gáy đã cũ (bản web cũng hủy lật khi đổi fit/dual/direction).
   *  v0.3.9: không còn dùng số thế hệ (flipSeqRef) — mọi đường lật đã
   *  mount đồng bộ, không còn khoảng chờ async cần vô hiệu hóa. */
  const cancelFlip = useCallback(() => {
    busyRef.current = false;
    stopTween();
    cancelPendingPoint();
    dragRef.current = null;
    pendingDragRef.current = null;
    setCurl(null);
    // v0.3.10: dọn cả 2 mặt lá đã đóng băng (như finishFlip).
    leafFacesRef.current = null;
  }, [stopTween, cancelPendingPoint, setCurl]);

  /** Cell + điểm nắm/đáp của lá cho một cú lật (theo mô hình spread).
   *  `spineLeft` của leaf = gáy nằm ở mép trái của cell (trang phải
   *  của spread); false = gáy ở mép phải (trang trái).
   *  v0.3.8: cell theo spread HIỆN TẠI (curSides) — nền đang lật có
   *  thể là spread đích, cell không được đổi giữa chừng. */
  const flipGeom = useCallback(
    (leaf: LeafFlip, grabY?: number) => {
      const frontIsLeft = curSides.left === leaf.front;
      const cellX = !twoPage ? 0 : frontIsLeft ? 0 : leftSlotW;
      const cellW = !twoPage
        ? leftSlotW
        : frontIsLeft
          ? leftSlotW
          : rightSlotW;
      const { grab, mirror } = curlAnchors(
        cellX,
        cellW,
        leaf.spineLeft,
        baseH,
        // v0.3.12: lật phím/chạm/nút thì nắm GIỮA mép ngoài (grabY =
        // baseH/2) để trục uốn quét dọc song song gáy; kéo tay thì
        // không dùng điểm nắm này (beginDragFlip lấy đúng chỗ tay bấm)
        // nên mặc định vẫn là góc dưới (baseH) như trước.
        grabY ?? baseH,
      );
      return { cellX, cellW, grab, mirror };
    },
    [curSides.left, twoPage, leftSlotW, rightSlotW, baseH],
  );

  /** Lật có hiệu ứng (phím/nút/chạm/mép): lá cong quét theo cung
   *  ~900ms, easing hình chữ S (easeInOutCubic — v0.3.10).
   *
   *  v0.3.9 — LẬT PHẢN HỒI NGAY (mô hình trình xem video, thay cho
   *  "chờ decode xong mới lật" của v0.3.8):
   *  - Lá mount + tween chạy NGAY LẬP TỨC, không await gì trước đó.
   *    Trước đây startFlip await ensure (4 trang qua invoke) +
   *    decodeImages (4 lần giải mã base64 vài MB) rồi mới mount lá —
   *    mỗi lần bấm phím/chạm đều đứng hình ~0.2–1s rồi trang nhảy
   *    tức thì (lá lại tàng hình vì point=grab), cảm giác "đơ lắm".
   *  - ensure + decodeImages chạy NỀN (fire-and-forget): effect nạp
   *    trước thường đã có sẵn trang đích trong cache; nếu chưa có, mặt
   *    sau của lá hiện placeholder "Đang tải trang…" rồi tự đổi thành
   *    trang thật khi nạp xong (ensure tăng cacheVersion -> render lại),
   *    không bao giờ hiện sai trang, không bao giờ đứng hình.
   *  - Nhãn chỉ đổi ở finishFlip (cuối tween) như cũ — không lệch
   *    nhãn/ảnh.
   *  Không chờ tween: khóa busyRef giữ tới khi finishFlip dọn.
   *
   *  v0.3.10 — MƯỢT + ĐÚNG VẬT LÝ GIẤY (video Thiện gửi 28/11: lá đã
   *  hiện nhưng "nhảy khung hình", nếp gấp chéo như bị xoắn):
   *  - Easing chữ S thay cho easeOutQuart: easeOutQuart có vận tốc lớn
   *    nhất ngay lúc bắt đầu (34% đường trong 100ms đầu) rồi bò chậm
   *    dần — trên video là cú "bật" rồi đứng hình; giấy thật thì nhấc
   *    chậm, quét nhanh giữa, đáp nhẹ (xem lib/curl.ts easeInOutCubic).
   *  - Cung lật dẹt hơn (curlArcControl y=0.8h thay cho 0.22h của bản
   *    web): nếp gấp chỉ nghiêng tối đa ~15° thay cho ~47°, quét ngang
   *    trang như lật giấy thật (đo bằng Node, xem test v0310).
   *  - 2 mặt lá ĐÓNG BĂNG lúc mount (leafFacesRef): mặt sau không bật
   *    từ placeholder thành ảnh thật giữa chừng nữa; trang đích chưa
   *    sẵn thì giữ placeholder suốt cú lật. Lookahead (effect trên)
   *    nạp + giải mã trước spread kề trong lúc đang đọc nên trường
   *    hợp này hiếm, và việc nặng không còn chạy trong lúc tween.
   *
   *  v0.3.12 — QUÉT DỌC + KHÔNG NỀN ĐEN (video Thiện gửi 28/11:
   *  dải cong vẫn quét chéo từ góc dưới, và slot trang đích đen
   *  ~200ms lúc lật bắt đầu):
   *  - Điểm nắm lật phím/chạm/nút chuyển về GIỮA mép ngoài
   *    (flipGeom(leaf, baseH/2)) và cung chỉ nhấc nhẹ 0.05·cellW
   *    (curlArcControl(..., 0.05 * cellW)): trục uốn (vuông góc hướng
   *    kéo) nghiêng tối đa ~6° so với phương thẳng đứng suốt cú lật
   *    (đo bằng Node, xem test v0312) — trang quét dọc song song gáy
   *    như lật giấy thật, không còn bóc chéo từ góc. Độ cong 3D vẫn
   *    do trụ cuộn (R) tạo ra nên trang không thành tấm trượt phẳng.
   *  - Trang đích được GIỮ SỐNG sau khi lookahead decode
   *    (warmImagesRef — xem decodeImages): <img> của slot nền mount
   *    sau vẽ ngay từ bitmap có sẵn, không fetch/decode lại. Và
   *    `.page-img` không còn nền đen #111 nữa (xem styles.css) — dù
   *    ảnh có chậm thì slot cũng hiện trang trắng, không bao giờ đen.
   *    Lật vẫn phản hồi ngay, không await decode lúc bấm (không quay
   *    lại kiểu đứng hình của v0.3.8). */
  const startFlip = useCallback(
    (dir: 1 | -1) => {
      if (busyRef.current) return;
      // Lá nào lật, hiện trang nào — tính 1 lần từ mô hình spread
      // (đúng cho cả 1/2 trang × LTR/RTL; xem src/lib/spread.ts).
      const leaf = leafForFlip(cur, dir, twoPage, rtl, total);
      if (!leaf) return;
      // Lật tay thì dừng TTS (trừ lúc TTS tự lật sang trang sau).
      if (!ttsAutoRef.current) stopTtsRef.current();
      // Zoom vượt vừa trang thì không lật cong nữa, nhảy thẳng trang.
      if (
        !flipOn ||
        zoomedBeyondFit ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        finishFlip(leaf.next);
        return;
      }
      // Nền của đúng cú lật này (bên lật = trang đích, bên còn lại
      // = trang hiện tại) + mặt trước/sau của lá — nạp + giải mã NỀN,
      // không chặn lá (xem ghi chú ở trên).
      const base = flipBaseSides(leaf, cur, twoPage, rtl, total);
      const flipPages = [leaf.front, leaf.back, base.left, base.right].filter(
        (p): p is number => p !== null,
      );
      void (async () => {
        try {
          await ensure(flipPages);
          await decodeImages(
            flipPages,
            flipPages.map((p) => cacheRef.current.get(p)),
          );
        } catch {
          // Nạp nền lỗi thì kệ — mặt lá hiện placeholder, effect thử
          // lại sẽ điền trang khi nạp được.
        }
      })();
      busyRef.current = true;
      // v0.3.12: nắm GIỮA mép ngoài (baseH/2), cung chỉ nhấc nhẹ
      // 0.05·cellW — trục uốn quét dọc song song gáy (xem ghi chú ở
      // trên và test v0312). Kéo tay không dùng đường này.
      const g = flipGeom(leaf, baseH / 2);
      const p0 = g.grab;
      const p1 = g.mirror;
      const ctrl = curlArcControl(p0, p1, baseH, 0.05 * g.cellW);
      const path = (k: number) => quadBezier(p0, ctrl, p1, k);
      // v0.3.10: ĐÓNG BĂNG 2 mặt lá lúc mount — renderFace đọc cache
      // ngay lúc này, JSX dùng đúng 2 node này suốt cú lật (không tạo
      // lại mỗi lần re-render) nên mặt sau không bật từ placeholder
      // thành ảnh thật giữa chừng. Trang đích chưa sẵn thì mặt sau giữ
      // placeholder suốt cú lật; lookahead làm trường hợp này hiếm.
      leafFacesRef.current = {
        front: renderFace(cacheRef.current.get(leaf.front), false, leaf.front),
        back: renderFace(cacheRef.current.get(leaf.back), false, leaf.back),
      };
      // Mount lá hơi chếch vào trong cú lật để 2 mặt đều là trang thật
      // đã vẽ xong, rồi để 2 khung hình trôi qua mới cho lá chạy
      // (tweenPoint preFrames): mount và chuyển động giành nhau cùng
      // khung hình sẽ làm lật giật ngay lúc bắt đầu. Điểm mount PHẢI
      // là path(FLIP_MOUNT_K) — mount ở đúng điểm nắm (point=grab) làm
      // foldGeometry trả null, lá tàng hình (v0.3.7–v0.3.8); và với
      // easing chữ S thì path(ease(0.03)) gần như trùng điểm nắm nên
      // không dùng được (xem lib/curl.ts FLIP_MOUNT_K/T).
      setCurl({
        front: leaf.front,
        back: leaf.back,
        cellX: g.cellX,
        cellW: g.cellW,
        grab: g.grab,
        mirror: g.mirror,
        point: path(FLIP_MOUNT_K),
        next: leaf.next,
        dir,
        base,
      });
      cancelTweenRef.current = tweenPoint(
        FLIP_MS,
        easeInOutCubic,
        path,
        applyPoint,
        () => {
          cancelTweenRef.current = null;
          finishFlip(leaf.next);
        },
        2,
        FLIP_MOUNT_T,
      );
    },
    [
      cur,
      twoPage,
      rtl,
      total,
      flipOn,
      zoomedBeyondFit,
      ensure,
      decodeImages,
      flipGeom,
      baseH,
      applyPoint,
      finishFlip,
    ],
  );

  // v0.3.7: vào/ra full màn thì đưa viewport về đầu (scroll cũ còn sót
  // sẽ làm spread lệch hẳn sang một bên — video 27/11). Đổi bố cục
  // (1/2 trang, RTL, fit, zoom) giữa chừng thì hủy cú lật đang chạy
  // (lá sẽ rách vì cell/gáy đã cũ).
  useEffect(() => {
    resetViewportScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immersive]);
  useEffect(() => {
    cancelFlip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twoPage, rtl, fit, zoom]);

  // ---- Bookmarks ----
  const toggleBookmark = useCallback(async () => {
    const existing = bookmarks.find((b) => b.page === cur);
    try {
      if (existing) {
        await api.bookmarkDelete(existing.id);
        showToast("Đã bỏ đánh dấu trang này.");
      } else {
        const label = cacheRef.current.get(cur)?.label ?? `Trang ${cur + 1}`;
        await api.bookmarkAdd({
          book_id: bookId,
          page: cur,
          chapter: label,
          note: null,
          created_at: Date.now(),
        });
        showToast(`Đã đánh dấu trang ${cur + 1}.`);
      }
      await refreshBookmarks();
    } catch {
      // Lưu bookmark lỗi thì kệ, không chặn việc đọc.
    }
  }, [bookmarks, cur, bookId, refreshBookmarks, showToast]);

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
        setSheet(null);
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
    setSheet("highlights");
  }, [pendingSelection, hlColor, hlNote, bookId, refreshHighlights]);

  // ---- Cắt lề: tự phát hiện lề trắng trên trang ảnh đang đọc ----
  // v0.3.8: lấy trang của spread HIỆN TẠI (curLeft/curRight), không lấy
  // nền đang lật (left/right) — nền có thể hiện trang đích.
  const autoDetectCrop = useCallback(async () => {
    const page = curLeft?.isImage ? curLeft : curRight?.isImage ? curRight : undefined;
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
  }, [curLeft, curRight]);

  // Mở 1 sheet trượt phải (menu ⋯ / tìm / lưới / ...). Đang đọc chìm thì
  // thoát chìm trước — sheet cần không gian, không chen vào trang đọc.
  const openSheet = useCallback(
    (kind: Exclude<SheetKind, null>) => {
      if (immersive) void exitImmersive();
      setSheet(kind);
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
        openSheet("search");
        return;
      }
      if (e.key === "ArrowRight") startFlip(rtl ? -1 : 1);
      else if (e.key === "ArrowLeft") startFlip(rtl ? 1 : -1);
      else if (e.key === "f" || e.key === "F") {
        if (immersive) void exitImmersive();
        else void enterImmersive();
      }
      else if (e.key === "t" || e.key === "T") toggleTtsRef.current();
      else if (e.key === "Escape") {
        if (sheet !== null) setSheet(null);
        else if (immersive) void exitImmersive();
        else if (pendingSelection) setPendingSelection(null);
        else onClose();
      } else if (e.key === "b" || e.key === "B") void toggleBookmark();
      else if (e.key === "g" || e.key === "G") {
        if (sheet === "grid") setSheet(null);
        else openSheet("grid");
      }
      else if (e.key === "+" || e.key === "=") setZoom((z) => clampZoom(z * 1.2));
      else if (e.key === "-") setZoom((z) => clampZoom(z / 1.2));
      else if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startFlip, rtl, sheet, immersive, pendingSelection, toggleBookmark, openSheet]);

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
  /** Chuột (client px) → tọa độ spread (layout px, chưa scale) — để
   *  điểm nắm của lá là đúng chỗ tay bấm. Dùng rect visual của spread
   *  (đã scale) chia cho scale. */
  const toSpreadPoint = useCallback(
    (clientX: number, clientY: number): Pt | null => {
      const el = spreadRef.current;
      if (!el || scale === 0) return null;
      const r = el.getBoundingClientRect();
      return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
    },
    [scale],
  );

  // v0.3.8: bấm xuống CHỈ ghi nhận (bản web: pendingDragRef) — chưa
  // mount lá, chưa khóa lật. Lá chỉ mount sau khi tay di chuyển >9px
  // (xem onPointerMove → beginDragFlip).
  // v0.3.9: sách chữ cũng ghi nhận — chạm nhẹ (<8px) thì lật trang
  // (Thiện lật bằng chạm nhẹ vào trang; trước đây chạm vào trang chữ
  // không làm gì cả). Kéo chuột trên trang chữ vẫn là bôi đen chữ,
  // không kéo lật (xem onPointerMove), và không capture con trỏ để
  // thao tác bôi đen gốc của trình duyệt vẫn chạy.
  const onPointerDown = (e: React.PointerEvent, dir: 1 | -1, slot: "left" | "right") => {
    if (busyRef.current || dragMountingRef.current || !flipOn) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    if (zoomedBeyondFit) {
      const vp = viewportRef.current;
      if (!vp) return;
      panRef.current = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
      try { el.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
      return;
    }
    // v0.3.8: lấy trang của spread HIỆN TẠI (curLeft/curRight), không lấy
    // nền đang lật — nền có thể hiện trang đích.
    const slotPage = slot === "left" ? curLeft : curRight;
    const isImage = slotPage ? slotPage.isImage : false;
    const leaf = leafForFlip(cur, dir, twoPage, rtl, total);
    if (!leaf) return;
    pendingDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dir,
      isImage,
    };
    latestClientRef.current = { x: e.clientX, y: e.clientY };
    // Chỉ capture con trỏ với mặt ảnh (kéo lật). Mặt chữ không capture
    // để bôi đen chữ vẫn chọn được bình thường.
    if (isImage) {
      try { el.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
    }
  };

  /** Bắt đầu cú kéo lật sau khi tay đã di chuyển >9px: mount lá NGAY
   *  với điểm tay hiện tại, nạp + giải mã trang đích NỀN (v0.3.9 —
   *  trước đây chờ decode xong mới mount nên kéo >9px mà lá không
   *  theo tay, cảm giác đơ). Thả tay giữa chừng thì settleDrag xử lý. */
  const beginDragFlip = useCallback((pending: PendingDrag) => {
    if (busyRef.current || dragMountingRef.current) return;
    if (!pendingDragRef.current || pendingDragRef.current.pointerId !== pending.pointerId) {
      return; // thả tay rồi — không mount nữa
    }
    busyRef.current = true;
    dragMountingRef.current = true;
    try {
      const leaf = leafForFlip(cur, pending.dir, twoPage, rtl, total);
      if (!leaf) return;
      const base = flipBaseSides(leaf, cur, twoPage, rtl, total);
      const flipPages = [leaf.front, leaf.back, base.left, base.right].filter(
        (p): p is number => p !== null,
      );
      // Nạp + giải mã nền, không chặn lá (như startFlip).
      void (async () => {
        try {
          await ensure(flipPages);
          await decodeImages(
            flipPages,
            flipPages.map((p) => cacheRef.current.get(p)),
          );
        } catch {
          // Kệ — mặt lá hiện placeholder, thử lại sau.
        }
      })();
      // Điểm nắm = đúng chỗ tay bấm, kẹp trong cell đang lật (bản web
      // cũng kẹp tay nắm cách gáy một đoạn ngắn để nếp gấp không bị lật
      // ngược khi tay bấm sát gáy).
      const g = flipGeom(leaf);
      const pt0 = toSpreadPoint(pending.startX, pending.startY) ?? g.grab;
      const cellX = g.cellX;
      const cellW = g.cellW;
      const spineX = leaf.spineLeft ? cellX : cellX + cellW;
      const grab: Pt = {
        x: leaf.spineLeft
          ? Math.min(Math.max(pt0.x, cellX + cellW * 0.12), cellX + cellW)
          : Math.min(Math.max(pt0.x, cellX), cellX + cellW * 0.88),
        y: Math.min(Math.max(pt0.y, 2), baseH - 2),
      };
      // Điểm đáp = điểm nắm phản chiếu qua gáy (cùng y — kéo theo chiều
      // ngang; điểm nắm y lệch cũng được, nếp gấp tự theo tay).
      const to: Pt = { x: 2 * spineX - grab.x, y: grab.y };
      // v0.3.6: xóa bôi đen cũ ngay khi bắt đầu kéo — bôi đen cũ còn sót
      // sẽ nhuộm trang xanh (lỗi Thiện báo ở v0.3.5 vẫn còn y như v0.3.4).
      try { window.getSelection()?.removeAllRanges(); } catch { /* bỏ qua */ }
      const ptNow =
        toSpreadPoint(latestClientRef.current.x, latestClientRef.current.y) ?? grab;
      // v0.3.12: kẹp góc kéo ≤40° khỏi phương ngang (xem
      // clampPullAngle) — trục uốn không nghiêng chéo quá mức khi tay
      // kéo góc lên xiên; kéo ngang bình thường thì không đổi gì.
      const point = clampPullAngle(grab, clampDragPoint(grab, to, ptNow.x, ptNow.y, baseH));
      // v0.3.10: đóng băng 2 mặt lá lúc mount (như startFlip) — kéo
      // giữa chừng mà mặt sau bật từ placeholder thành ảnh thật cũng
      // là 1 cú giật khung hình.
      leafFacesRef.current = {
        front: renderFace(cacheRef.current.get(leaf.front), false, leaf.front),
        back: renderFace(cacheRef.current.get(leaf.back), false, leaf.back),
      };
      // point = điểm tay HIỆN TẠI (đã kẹp theo cung lật) — lá mount
      // với điểm này nên foldGeometry có nghiệm, lá hiện ngay theo tay
      // (trước đây mount ở grab nên lá tàng hình).
      setCurl({
        front: leaf.front,
        back: leaf.back,
        cellX,
        cellW,
        grab,
        mirror: to,
        point,
        next: leaf.next,
        dir: pending.dir,
        base,
      });
      dragRef.current = {
        grab,
        from: grab,
        to,
        dir: pending.dir,
        next: leaf.next,
        vel: 0,
        lastT: performance.now(),
        lastPoint: point,
        grabClientX: pending.startX,
        grabClientY: pending.startY,
      };
      pushPoint(point);
    } finally {
      dragMountingRef.current = false;
      // Mount bị hủy giữa chừng (thả tay / đổi bố cục) thì mở khóa;
      // mount xong thì busyRef giữ tới khi finishFlip/spring-back dọn.
      if (!dragRef.current) busyRef.current = false;
    }
  }, [cur, twoPage, rtl, total, ensure, decodeImages, flipGeom, toSpreadPoint, baseH, pushPoint]);

  /** Chạy nốt cú kéo đang diễn ra: commit=true thì lật hẳn, false thì
   *  lá nảy về trang cũ. Dùng chung cho thả tay và pointer bị hủy.
   *
   *  v0.3.9: tween chạy NGAY khi thả tay — không chờ decode nữa
   *  (trước đây chờ ensure+decode 2 trang đích rồi mới chạy nốt nên
   *  thả tay xong vẫn đứng hình một nhịp rồi mới lật). Trang đích nạp
   *  + giải mã nền; mặt sau lá hiện placeholder nếu chưa xong, tự
   *  đổi thành trang thật khi nạp xong. */
  const settleDrag = useCallback((d: DragState, commit: boolean) => {
    cancelPendingPoint();
    const point = d.lastPoint;
    leafRef.current?.update(point); // vẽ đúng tư thế cuối đang cầm
    const target = commit ? d.to : d.from;
    const ms = dragSettleMs(d.from, d.to, point);
    if (commit) {
      // Nạp nền trang đích để mặt sau kịp nét khi lá đáp — không chặn
      // tween (xem ghi chú ở trên).
      const dest = spreadSides(d.next, twoPage, rtl, total);
      const destPages = [dest.left, dest.right].filter(
        (p): p is number => p !== null,
      );
      void (async () => {
        try {
          await ensure(destPages);
          await decodeImages(
            destPages,
            destPages.map((p) => cacheRef.current.get(p)),
          );
        } catch {
          // Kệ — effect thử lại sẽ điền trang khi nạp được.
        }
      })();
    }
    cancelTweenRef.current = tweenPoint(
      ms,
      commit ? easeOutCubic : easeOutQuint,
      (k) => lerpPt(point, target, k),
      applyPoint,
      () => {
        cancelTweenRef.current = null;
        if (commit) finishFlip(d.next);
        else {
          // Nảy về: dọn lá, mở khóa, ở nguyên trang cũ.
          busyRef.current = false;
          cancelPendingPoint();
          setCurl(null);
          try { window.getSelection()?.removeAllRanges(); } catch { /* bỏ qua */ }
        }
      },
    );
  }, [twoPage, rtl, total, ensure, decodeImages, applyPoint, finishFlip, cancelPendingPoint]);
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
    if (d) {
      // Cell có key theo trang (v0.3.8) nên slot remount khi lá mount,
      // node đã capture bị thay — khẳng định lại capture trên node
      // hiện tại mỗi lần di chuyển để thả tay ngoài cửa sổ vẫn nhận.
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
      const pt = toSpreadPoint(e.clientX, e.clientY);
      if (!pt) return;
      // Điểm giữ kẹp trên lá (không đi quá điểm đáp, không lùi quá điểm
      // nắm) — quá điểm nắm nếp gấp sẽ lộn ngược, lá rách.
      // v0.3.12: kẹp thêm góc kéo ≤40° khỏi phương ngang (xem
      // clampPullAngle) để trục uốn không nghiêng chéo quá mức.
      const point = clampPullAngle(d.grab, clampDragPoint(d.grab, d.to, pt.x, pt.y, baseH));
      // Vận tốc đã làm mượt dọc trục lật — để flick-to-turn khi thả.
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT);
      const axisLen = Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y) || 1;
      const v =
        (((point.x - d.lastPoint.x) * (d.to.x - d.from.x)) / axisLen +
          ((point.y - d.lastPoint.y) * (d.to.y - d.from.y)) / axisLen) /
        dt;
      d.vel = d.vel * 0.65 + v * 0.35;
      d.lastT = now;
      d.lastPoint = point;
      pushPoint(point);
      return;
    }
    // Chưa đủ 9px thì chỉ ghi nhận vị trí (bản web: pendingDragRef) —
    // chưa mount lá. Vượt 9px thì bắt đầu kéo (mount lá ngay).
    const p = pendingDragRef.current;
    if (!p || e.pointerId !== p.pointerId) return;
    latestClientRef.current = { x: e.clientX, y: e.clientY };
    const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    // Sách chữ: kéo là bôi đen chữ, không kéo lật — kéo quá 8px thì
    // hủy chờ chạm để lần chạm sau không bị tính nhầm thành chạm nhẹ.
    if (!p.isImage) {
      if (moved >= 8) pendingDragRef.current = null;
      return;
    }
    if (moved < 9) return;
    beginDragFlip(p);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (panRef.current) {
      panRef.current = null;
      // Kéo rê khi zoom cũng có thể để lại bôi đen — xóa luôn.
      try { window.getSelection()?.removeAllRanges(); } catch { /* bỏ qua */ }
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    const p = pendingDragRef.current;
    pendingDragRef.current = null;
    if (d) {
      // Thả ra: quá ~1/3 quãng — hoặc flick nhanh theo chiều lật — thì
      // lật hẳn với đà còn lại; không thì lá nảy về chỗ cũ. Thời gian
      // theo quãng còn lại (170–560ms), không phải lúc nào cũng 900ms.
      const frac = dragFrac(d.from, d.to, d.lastPoint);
      const commitFlip = frac > 0.35 || (d.vel > 0.55 && frac > 0.08);
      settleDrag(d, commitFlip);
      return;
    }
    if (!p) return;
    const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    if (moved < 8) {
      // v0.3.5: chạm nhẹ (không kéo) = lật trang luôn — trước đây chạm
      // vào trang không làm gì (lá nảy về), phải kéo đủ dài hoặc bấm
      // nút hẹp ở mép mới lật được. v0.3.9: áp dụng cả cho trang chữ
      // (chạm nhẹ vào trang chữ cũng lật; kéo chữ vẫn bôi đen).
      try { window.getSelection()?.removeAllRanges(); } catch { /* bỏ qua */ }
      startFlip(p.dir);
      return;
    }
    // Kéo 8–9px: chưa đủ ngưỡng kéo lật, cũng không còn là chạm nhẹ
    // — không lật, không làm gì.
  };

  // Pointer bị hủy giữa chừng (vd cửa sổ mất focus, hệ thống ngắt cử
  // chỉ): nảy lá về trang cũ như khi thả tay chưa đủ xa — không commit,
  // không để busyRef kẹt.
  const onPointerCancel = () => {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    pendingDragRef.current = null;
    if (!d) return;
    settleDrag(d, false);
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

  // v0.3.8: mỗi mặt có key theo chỉ số trang — React mount node DOM
  // mới cho mỗi trang thay vì tái dùng node cũ rồi chỉ đổi src (data
  // URL base64 vài MB giải mã bất đồng bộ, lật nhanh thì các lần giải
  // mã hoàn thành không theo thứ tự → ảnh hiện sai spread). Trang chưa
  // nạp xong hiện "Đang tải trang…" thay vì ảnh sai.
  // v0.3.9: ảnh protocol (mio-page://) lỗi thì thử 1 lần fallback
  // base64 qua ReaderPage.fallback (vd file đã đổi/xóa sau khi mở) —
  // trang vẫn hiện, chỉ chậm hơn. Không thử lại vô hạn.
  const renderFace = (p: ReaderPage | undefined, mirrored: boolean, pageIndex: number) => {
    if (!p) {
      return <div key={pageIndex} className="page-face page-loading">Đang tải trang…</div>;
    }
    const cropActive = p.isImage && hasCrop(crop);
    const onImgError = p.isImage && p.fallback
      ? (e: React.SyntheticEvent<HTMLImageElement>) => {
          const img = e.currentTarget;
          if (img.dataset.fallbackTried) return;
          img.dataset.fallbackTried = "1";
          void p
            .fallback?.()
            .then((dataUrl) => {
              if (dataUrl) img.src = dataUrl;
            })
            .catch(() => {
              // Fallback cũng lỗi thì để nguyên — slot hiện nền đen của
              // .page-img, effect thử lại sẽ nạp lại trang sau 1.5s.
            });
        }
      : undefined;
    return (
      <div key={pageIndex} className="page-face" style={mirrored ? { transform: "scaleX(-1)" } : undefined}>
        {p.isImage ? (
          <img
            key={pageIndex}
            className="page-img"
            src={p.content}
            alt={p.label}
            draggable={false}
            onLoad={(e) => noteAspect(pageIndex, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            onError={onImgError}
            style={cropActive ? cropImgStyle(crop) : undefined}
          />
        ) : (
          <>
            <div
              className="epub-page"
              data-page={pageIndex}
              dangerouslySetInnerHTML={{ __html: p.content }}
            />
            <div className="page-num">Trang {pageIndex + 1}</div>
          </>
        )}
      </div>
    );
  };

  // Đánh dấu ở 1 trong 2 trang của spread đang mở thì hiện ★.
  const bookmarkedHere = bookmarks.some(
    (b) => b.page === cur || (twoPage && b.page === cur + 1),
  );

  // Thanh trượt dưới (v0.3.4): kéo chỉ đổi vị trí hiển thị, thả ra mới
  // nhảy trang. Trước đây mỗi tick kéo đều nạp trang + ghi lịch sử SQLite
  // + nạp lại toàn bộ lịch sử nên kéo trượt giật, cứng.
  // v0.3.8: thả ra thì chờ nạp + giải mã xong mới đổi spread — như
  // jumpTo, nhãn không đổi trước ảnh.
  // v0.3.9: hủy lá đang lật trước (như jumpTo), chờ tối đa 8s rồi nhảy
  // tiếp với placeholder — không treo ở slider nữa.
  const commitSlider = useCallback(async () => {
    if (sliderVal === null) return;
    const n = sliderVal;
    setSliderVal(null);
    if (n === cur) return;
    stopTtsRef.current();
    cancelFlip();
    const pages = [n, n + 1];
    await withTimeout(
      (async () => {
        await ensure(pages);
        await decodeImages(
          pages,
          pages.map((p) => cacheRef.current.get(p)),
        );
      })(),
      8000,
    );
    setSpread(spreadStartForPage(n, twoPage, rtl, total));
    onProgress(n, total);
  }, [sliderVal, cur, twoPage, rtl, total, ensure, decodeImages, onProgress, cancelFlip]);

  return (
    <div
      className={`reader${immersive ? " immersive" : ""}${immersive && !controlsVisible ? " hideui" : ""}`}
    >
      {/* Thanh trên theo thiết kế: nút quay lại + pill chứa tiêu đề & 5 nút
          tác vụ hàng ngày (đánh dấu, tìm, Aa, đọc thành tiếng, toàn màn
          hình) + nút ⋯ mở menu duy nhất chứa mọi tính năng phụ. */}
      <header className="rbar">
        <button className="back-btn" onClick={onClose} title="Về thư viện (Esc)">
          ←
        </button>
        <div className="rbar-pill">
          <div className="rbar-title">
            <div className="t">{title}</div>
            <div className="s">
              Trang {cur + 1}
              {twoPage && shownSides.left !== null && shownSides.right !== null
                ? `–${cur + 2}`
                : ""}{" "}
              / {total}
              {bookmarkedHere ? " · ★" : ""}
              {isComic && rtl ? " · RTL" : ""}
            </div>
          </div>
          <button
            className={`rbtn${bookmarkedHere ? " on" : ""}`}
            onClick={() => void toggleBookmark()}
            title="Đánh dấu trang (B)"
          >
            🔖
          </button>
          <button className="rbtn" onClick={() => openSheet("search")} title="Tìm trong sách (Ctrl+F)">
            ⌕
          </button>
          <button className="rbtn" onClick={() => openSheet("typo")} title="Chữ & nền trang">
            Aa
          </button>
          <button
            className={`rbtn${ttsState !== "idle" ? " on" : ""}`}
            onClick={toggleTts}
            title="Đọc thành tiếng (T)"
          >
            🔊
          </button>
          <button className="rbtn" onClick={toggleImmersive} title="Đọc toàn màn hình (F)">
            ⛶
          </button>
          <button className="rbtn" onClick={() => openSheet("menu")} title="Menu — mọi tính năng ở đây">
            ⋯
          </button>
        </div>
      </header>

      {/* Thanh đọc thành tiếng nổi (thiết kế v0.3.0): nút tạm dừng, vạch
          sóng, trạng thái, nút dừng. Giọng & tốc độ nằm trong menu ⋯. */}
      {ttsState !== "idle" && (
        <div className="ttsbar">
          <button onClick={toggleTtsPause} title={ttsState === "paused" ? "Tiếp tục đọc" : "Tạm dừng"}>
            {ttsState === "paused" ? "▶" : "⏸"}
          </button>
          <span className={`eq${ttsState === "paused" ? " paused" : ""}`}>
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="tts-txt">{ttsMsg || "Đang đọc…"}</span>
          <button onClick={stopTts} title="Dừng đọc">
            ⏹
          </button>
        </div>
      )}

      {dictOpen && (
        <div className="dict-float">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong>Tra từ điển</strong>
            <button onClick={() => setDictOpen(false)} aria-label="Đóng từ điển">
              ✕
            </button>
          </div>
          <DictionaryBox word={dictWord} onWordChange={setDictWord} />
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
        {/* Vùng bấm lật ở 2 mép (thiết kế): dải hẹp ngoài spread, không che
            vùng kéo lật giữa trang. Trái = lùi, phải = tới (RTL đảo lại). */}
        <button
          className="nav-zone left"
          onClick={() => startFlip(rtl ? 1 : -1)}
          disabled={cur <= 0}
          aria-label="Trang trước"
        >
          ‹
        </button>
        <button
          className="nav-zone right"
          onClick={() => startFlip(rtl ? -1 : 1)}
          disabled={nextSpread === null}
          aria-label="Trang sau"
        >
          ›
        </button>
        {/* Tag truyện tranh theo thiết kế: "Trang 98 / 214 · RTL". */}
        {isComic && (
          <div className="mtag">
            Trang {cur + 1} / {total}
            {rtl ? " · RTL" : ""}
          </div>
        )}
        <div className="spread-viewport" ref={viewportRef}>
          <div
            className="spread-scaler"
            style={{ width: naturalW * scale, height: Math.max(1, baseH * scale) }}
          >
            <div
              className={`spread theme-${pageTheme}${fontSans ? " font-sans" : ""}${useAspectSlots ? " img-book" : ""}`}
              ref={spreadRef}
              style={{
                width: naturalW,
                transform: `scale(${scale})`,
                // v0.3.7: origin "top left" — visual khớp đúng khung
                // scaler. "top center" (cũ) lệch visual khỏi scaler
                // một đoạn naturalW*(1-scale)/2: full màn lệch trái
                // ~375px, trang trái cụt + bên phải đen lớn (video
                // 27/11, xem lib/layout spreadVisualRect).
                transformOrigin: "top left",
                "--rfs": `${fontSize}px`,
                "--rlh": String(lineHeight),
              } as React.CSSProperties}
              onMouseUp={onSpreadMouseUp}
            >
              {/* Trang nền bên trái (null = bên trống, vd bìa manga RTL).
                  v0.3.8: slot có key theo chỉ số trang — đổi trang thì
                  mount node mới, không tái dùng node cũ (xem renderFace). */}
              {leftIndex === null ? (
                <div
                  key="empty-left"
                  className="page-slot left empty"
                  style={useAspectSlots ? { flex: "none", width: leftSlotW } : undefined}
                />
              ) : (
                <div
                  key={leftIndex}
                  className={`page-slot ${twoPage ? "left" : "single"}${left?.isImage ? " img" : ""}${bookmarks.some((b) => b.page === leftIndex) ? " bookmarked" : ""}`}
                  style={useAspectSlots ? { flex: "none", width: leftSlotW } : undefined}
                  onPointerDown={(e) => onPointerDown(e, rtl ? 1 : -1, "left")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                >
                  {renderFace(left, false, leftIndex)}
                </div>
              )}
              {twoPage &&
                (rightIndex === null ? (
                  <div
                    key="empty-right"
                    className="page-slot right empty"
                    style={useAspectSlots ? { flex: "none", width: rightSlotW } : undefined}
                  />
                ) : (
                  <div
                    key={rightIndex}
                    className={`page-slot right${right?.isImage ? " img" : ""}${bookmarks.some((b) => b.page === rightIndex) ? " bookmarked" : ""}`}
                    style={useAspectSlots ? { flex: "none", width: rightSlotW } : undefined}
                    onPointerDown={(e) => onPointerDown(e, rtl ? -1 : 1, "right")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                  >
                    {renderFace(right, false, rightIndex)}
                  </div>
                ))}
              {/* Lá lật cuộn trụ thật (v0.3.11, thay mô hình gấp thẳng
                  v0.3.7–v0.3.10): chỉ mount khi đang lật; tọa độ
                  spread (layout px), cha .spread scale lên theo.
                  Mặt trước = trang đang đọc, mặt sau = trang đích
                  (đặt đúng vị trí vật chất qua contentBackMatrix
                  trong CurlLeaf, không pre-mirror scaleX nữa). */}
              {curl && (
                <CurlLeaf
                  ref={leafRef}
                  width={naturalW}
                  height={baseH}
                  cellX={curl.cellX}
                  cellW={curl.cellW}
                  grab={curl.grab}
                  point={curl.point}
                  mirror={curl.mirror}
                  frontBg={pageTheme === "paper" ? "#f1e5c8" : pageTheme === "night" ? "#1c1a17" : "#fdfcf8"}
                  backBg={pageTheme === "paper" ? "#f1e5c8" : pageTheme === "night" ? "#1c1a17" : "#fdfcf8"}
                  dark={isComic}
                  // v0.3.10: dùng 2 mặt đã ĐÓNG BĂNG lúc mount
                  // (leafFacesRef) — re-render giữa chừng (ensure xong
                  // tăng cacheVersion) không tạo lại mặt lá, mặt sau
                  // không bật từ placeholder thành ảnh thật giữa chừng.
                  // Fallback renderFace chỉ phòng đường mount nào quên
                  // đóng băng.
                  front={leafFacesRef.current?.front ?? renderFace(cacheRef.current.get(curl.front), false, curl.front)}
                  back={leafFacesRef.current?.back ?? renderFace(cacheRef.current.get(curl.back), false, curl.back)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Sheet trượt phải (thiết kế v0.3.0): 1 sheet mở tại 1 thời điểm. */}
        {sheet === "menu" && (
          <MenuSheet
            title="Tùy chọn đọc"
            onClose={() => setSheet(null)}
            onOpenSheet={(s) => setSheet(s)}
            bookInfo={bookInfo}
            isComic={isComic}
            isTextBook={isTextBook}
            immersive={immersive}
            onToggleImmersive={toggleImmersive}
            twoPage={twoPage}
            onSetTwoPage={(v) => {
              if (v !== twoPage) toggleTwoPage();
            }}
            rtl={rtl}
            onSetRtl={(v) => {
              if (v !== rtl) toggleRtl();
            }}
            cropAuto={cropAuto}
            onSetCropAuto={(v) => {
              setCropAuto(v);
              if (v) void autoDetectCrop();
              else {
                setCrop(NO_CROP);
                setCropMsg("");
              }
            }}
            crop={crop}
            onCropChange={(c) => setCrop(clampCrop(c))}
            onCropAutoDetect={() => void autoDetectCrop()}
            onCropClear={() => {
              setCrop(NO_CROP);
              setCropMsg("");
            }}
            cropBusy={cropBusy}
            cropMsg={cropMsg}
            zoomLabel={`${fit === "page" ? "Vừa trang" : fit === "width" ? "Vừa rộng" : "Vừa cao"} · ${Math.round(scale * 100)}%`}
            fit={fit}
            onSetFit={setFit}
            zoomPct={Math.round(scale * 100)}
            onZoomIn={() => setZoom((z) => clampZoom(z * 1.2))}
            onZoomOut={() => setZoom((z) => clampZoom(z / 1.2))}
            onZoomReset={() => setZoom(1)}
            bookmarked={bookmarkedHere}
            onToggleBookmark={() => void toggleBookmark()}
            fontLabel={`${fontSans ? "Be Vietnam Pro" : "Noto Serif"} · ${pageTheme === "light" ? "Sáng" : pageTheme === "paper" ? "Giấy" : "Đêm"}`}
            ttsPlaying={ttsState !== "idle"}
            ttsSupported={getTts().supported}
            onToggleTts={toggleTts}
            voices={ttsVoices}
            voiceUri={ttsVoiceURI ?? ""}
            onVoice={(uri) => {
              const v = uri || null;
              setTtsVoiceURI(v);
              try {
                if (v) localStorage.setItem("mio-tts-voice", v);
                else localStorage.removeItem("mio-tts-voice");
              } catch {
                // Bỏ qua lỗi lưu.
              }
            }}
            rate={ttsRate}
            onRate={setTtsRate}
            onDictHint={() => {
              setSheet(null);
              showToast(
                isTextBook
                  ? "Bôi đen 1 đoạn chữ trong sách rồi bấm “Tra từ” để tra từ điển."
                  : "Truyện tranh không tra được từ — chữ nằm trong ảnh.",
              );
            }}
            onOpenStats={onOpenStats}
            onShowInfo={() => showToast(`${title} — ${bookInfo}`)}
          />
        )}
        {sheet === "typo" && (
          <TypoSheet
            title="Chữ & nền trang"
            onClose={() => setSheet(null)}
            onOpenSheet={(s) => setSheet(s)}
            fontSize={fontSize}
            onFontSize={setFontSize}
            lineHeight={lineHeight}
            onLineHeight={setLineHeight}
            fontSans={fontSans}
            onFontSans={setFontSans}
            pageTheme={pageTheme}
            onPageTheme={setPageTheme}
          />
        )}
        {sheet === "search" && (
          <SearchSheet
            title="Tìm trong sách"
            onClose={() => setSheet(null)}
            onOpenSheet={(s) => setSheet(s)}
            query={searchQuery}
            onQuery={setSearchQuery}
            onSearch={() => void runSearch()}
            searching={searching}
            progress={`${searchDone}/${searchTotal}`}
            onCancel={() => searchAbortRef.current?.abort()}
            results={searchResults}
            onJump={jumpToSearchResult}
            searchable={searchApi.search !== null}
          />
        )}
        {sheet === "grid" && (
          <GridSheet
            title="Lưới trang"
            onClose={() => setSheet(null)}
            onOpenSheet={(s) => setSheet(s)}
            total={total}
            currentPage={cur}
            isTextBook={isTextBook}
            chapters={(thumbApi.chapterTitles ?? []).map((t) => ({ title: t, href: "" }))}
            loadThumb={loadThumb}
            onJump={jumpTo}
          />
        )}
        {sheet === "bookmarks" && (
          <BookmarksSheet
            title="Đánh dấu"
            onClose={() => setSheet(null)}
            onOpenSheet={(s) => setSheet(s)}
            bookmarks={bookmarks}
            currentPage={cur}
            onJump={jumpTo}
            onDelete={(id) => {
              void api.bookmarkDelete(id).then(() => refreshBookmarks());
            }}
          />
        )}
        {sheet === "highlights" && (
          <HighlightsSheet
            title="Gạch chân đã lưu"
            onClose={() => setSheet(null)}
            onOpenSheet={(s) => setSheet(s)}
            highlights={highlights}
            onJump={(h) => jumpTo(h.page)}
            onDelete={(id) => {
              void api.highlightDelete(id).then(() => refreshHighlights());
            }}
          />
        )}
      </div>

      {/* Thanh dưới: nút lùi / thanh trượt vị trí / nút tới / số trang. */}
      <footer className="botbar">
        <button className="botnav" onClick={() => startFlip(-1)} disabled={cur <= 0} title="Trang trước (←)">
          ←
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={sliderVal ?? cur}
          style={{ direction: rtl ? "rtl" : "ltr" }}
          title={`Trang ${(sliderVal ?? cur) + 1} / ${total}`}
          onChange={(e) => setSliderVal(Number(e.target.value))}
          onPointerUp={() => commitSlider()}
          onKeyUp={() => commitSlider()}
          onBlur={() => commitSlider()}
        />
        <button className="botnav" onClick={() => startFlip(1)} disabled={nextSpread === null} title="Trang sau (→)">
          →
        </button>
        <span className="botlabel">
          {(sliderVal ?? cur) + 1} / {total}
        </span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

import {
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  PasswordException,
} from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ReaderPage } from "../components/Reader";
import { api } from "./api";
import { b64ToBytes } from "./files";

let workerReady = false;

/**
 * pdf.js 6 dùng các hàm ES2025 của Uint8Array (toHex/toBase64/fromBase64)
 * và Map/WeakMap (getOrInsert/getOrInsertComputed) mà WebView2 cũ và Node
 * thử nghiệm chưa có — thiếu là mọi PDF đều lỗi ngay lúc mở (hàm
 * fingerprints gọi toHex, render gọi getOrInsertComputed). Polyfill khi
 * chưa có sẵn, có sẵn rồi thì không đụng vào.
 */
(function polyfillUint8ArrayExtras() {
  const proto = Uint8Array.prototype as unknown as Record<string, unknown>;
  if (typeof proto.toHex !== "function") {
    proto.toHex = function (this: Uint8Array): string {
      let s = "";
      for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, "0");
      return s;
    };
  }
  if (typeof proto.toBase64 !== "function") {
    proto.toBase64 = function (this: Uint8Array): string {
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < this.length; i += CHUNK) {
        bin += String.fromCharCode.apply(
          null,
          this.subarray(i, i + CHUNK) as unknown as number[],
        );
      }
      return btoa(bin);
    };
  }
  const ctor = Uint8Array as unknown as Record<string, unknown>;
  if (typeof ctor.fromBase64 !== "function") {
    ctor.fromBase64 = (b64: string): Uint8Array => {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
  }
  if (typeof ctor.fromHex !== "function") {
    ctor.fromHex = (hex: string): Uint8Array => {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    };
  }
  // Math.sumPrecise (ES2025) — pdf.js dùng để tính kích thước font/bảng;
  // thiếu thì nó chỉ cảnh báo rồi dùng đường vòng, nhưng cứ thêm cho chắc.
  const math = Math as unknown as Record<string, unknown>;
  if (typeof math.sumPrecise !== "function") {
    math.sumPrecise = function (values: Iterable<number>): number {
      let sum = 0;
      let comp = 0;
      for (const v of values) {
        const t = sum + v;
        if (Math.abs(sum) >= Math.abs(v)) comp += sum - t + v;
        else comp += v - t + sum;
        sum = t;
      }
      return sum + comp;
    };
  }
  // Map/WeakMap "upsert" (ES2025) — pdf.js gọi getOrInsertComputed ở khắp nơi.
  for (const Ctor of [Map, WeakMap] as const) {
    const p = Ctor.prototype as unknown as Record<string, unknown>;
    if (typeof p.getOrInsert !== "function") {
      p.getOrInsert = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      };
    }
    if (typeof p.getOrInsertComputed !== "function") {
      p.getOrInsertComputed = function (
        this: Map<unknown, unknown>,
        key: unknown,
        callback: (k: unknown) => unknown,
      ) {
        if (this.has(key)) return this.get(key);
        const value = callback(key);
        this.set(key, value);
        return value;
      };
    }
  }
})();

/** Gọi 1 lần lúc app chạy: chỉ worker pdf.js vào file đã bundle. */
export function setupPdfWorker(): void {
  if (workerReady) return;
  GlobalWorkerOptions.workerSrc = workerUrl;
  workerReady = true;
}

/**
 * Transport đọc PDF theo đoạn byte qua lệnh Rust read_range: pdf.js xin
 * đoạn nào thì đọc đoạn đó, không bao giờ nạp cả file PDF vào RAM.
 * (pdf.js mặc định xin theo đoạn 64 KB; đoạn đầu 64 KB nạp trước làm
 * initialData để nó đọc được mục lục/xref ngay.)
 */
class TauriRangeTransport extends PDFDataRangeTransport {
  private inflight = new Set<string>();

  constructor(
    private fetchRange: (begin: number, end: number) => Promise<Uint8Array>,
    length: number,
    initialData: Uint8Array,
  ) {
    super(length, initialData, length <= initialData.length);
  }

  override requestDataRange(begin: number, end: number): void {
    const key = `${begin}-${end}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    void this.fetchRange(begin, end)
      .then((chunk) => {
        this.inflight.delete(key);
        this.onDataRange(begin, chunk);
      })
      .catch(() => {
        this.inflight.delete(key);
        // chunk null = báo cho pdf.js biết đoạn này lỗi, nó sẽ dừng gọn.
        this.onDataRange(begin, null);
      });
  }
}

export interface PdfBook {
  numPages: number;
  renderPage: (i: number) => Promise<ReaderPage>;
  close: () => void;
}

/** Canvas dùng để render 1 trang PDF (mặc định: canvas của trình duyệt).
 * pdf.js v6 tự lấy context từ canvas, nên factory chỉ cần tạo canvas. */
export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;

function domCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * Mở PDF: trả về số trang + hàm render từng trang khi lật tới.
 * `fetchRange` mặc định đọc qua lệnh Rust read_range (app thật); test
 * truyền hàm đọc từ fs. Ném lỗi có message "PDF_MAT_KHAU" nếu file có
 * mật khẩu.
 */
export async function openPdf(
  path: string,
  size: number,
  fetchRange: (begin: number, end: number) => Promise<Uint8Array> = (begin, end) =>
    api.readRange(path, begin, end - begin).then(b64ToBytes),
  makeCanvas: CanvasFactory = domCanvas,
  standardFontDataUrl = "standard_fonts/",
): Promise<PdfBook> {
  const firstLen = Math.min(size, 65536);
  const initial = await fetchRange(0, firstLen);
  const transport = new TauriRangeTransport(
    (begin, end) => fetchRange(begin, end),
    size,
    initial,
  );
  let doc: PDFDocumentProxy;
  try {
    // standardFontDataUrl: font chuẩn (Helvetica/Times/...) để render
    // đúng chữ thay vì font hệ thống — file .pfb trong public/standard_fonts/.
    doc = await getDocument({ range: transport, standardFontDataUrl }).promise;
  } catch (e) {
    if (e instanceof PasswordException) throw new Error("PDF_MAT_KHAU");
    throw e;
  }

  // Cache trang đã render gần đây (tối đa 12 trang) để lật lại không
  // render lại; quá thì xóa trang cũ nhất, RAM luôn có trần.
  const cache = new Map<number, ReaderPage>();
  const renderPage = async (i: number): Promise<ReaderPage> => {
    const hit = cache.get(i);
    if (hit) return hit;
    const page = await doc.getPage(i + 1);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1600 / Math.max(1, v1.width));
    const viewport = page.getViewport({ scale });
    const canvas = makeCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    await page.render({ canvas, viewport }).promise;
    page.cleanup();
    const rp: ReaderPage = {
      content: canvas.toDataURL("image/jpeg", 0.85),
      isImage: true,
      label: `Trang ${i + 1}`,
    };
    cache.set(i, rp);
    if (cache.size > 12) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return rp;
  };

  return {
    numPages: doc.numPages,
    renderPage,
    close: () => {
      cache.clear();
      doc.cleanup();
      void doc.loadingTask.destroy();
    },
  };
}

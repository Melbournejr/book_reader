import type { PdfRect, SearchResult } from "../types";

/**
 * Tìm chữ trong sách text (EPUB/MOBI) — hàm thuần, không cần DOM nên
 * test được bằng Node. PDF tìm riêng trong pdf.ts (cần pdf.js).
 *
 * LƯU Ý offset: findAll so khớp trên chuỗi đã lowercase (không đổi độ
 * dài, trừ vài ký tự Unicode hiếm) nên vị trí trả về dùng được thẳng
 * trên text gốc để cắt snippet.
 */

/** Tất cả vị trí xuất hiện của needle trong haystack (không phân biệt hoa/thường). */
export function findAll(haystack: string, needle: string): number[] {
  const out: number[] = [];
  const q = needle.trim();
  if (!q) return out;
  const h = haystack.toLowerCase();
  const n = q.toLowerCase();
  let from = 0;
  for (;;) {
    const i = h.indexOf(n, from);
    if (i < 0) return out;
    out.push(i);
    from = i + Math.max(1, n.length);
  }
}

/** Đoạn trích quanh 1 vị trí khớp, cắt ở ranh giới từ, thêm "…" nếu bị cắt. */
export function makeSnippet(text: string, at: number, len: number, radius = 60): string {
  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + len + radius);
  // Bỏ từ dở ở hai đầu (chỉ khi vẫn còn đủ chỗ chứa từ khớp).
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp >= 0 && sp < at) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > at + len) end = sp;
  }
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}

/** Bóc thẻ HTML thành text thuần (cho chương EPUB/MOBI). */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tìm trong các trang text: mỗi trang trả tối đa 3 kết quả đầu.
 * `onProgress` báo tiến độ từng trang (để UI hiện thanh tiến độ).
 */
export function searchTextPages(
  pages: { label: string; text: string }[],
  query: string,
  onProgress?: (done: number, total: number) => void,
): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const out: SearchResult[] = [];
  for (let i = 0; i < pages.length; i++) {
    const hits = findAll(pages[i].text, q);
    for (const h of hits.slice(0, 3)) {
      out.push({
        page: i,
        label: pages[i].label,
        snippet: makeSnippet(pages[i].text, h, q.length),
      });
    }
    onProgress?.(i + 1, pages.length);
  }
  return out;
}

// ---------------------------------------------------------------- PDF rects

/** 1 đoạn text trong trang PDF (từ pdf.js getTextContent) + vị trí của nó. */
export interface TextSegment {
  start: number; // vị trí bắt đầu trong text đã nối của trang
  end: number; // vị trí kết thúc
  x: number; // góc trái-trên trong hệ viewport scale 1
  y: number;
  w: number;
  h: number;
  str: string;
}

/**
 * Với mỗi lần xuất hiện của query trong text, trả về các hộp chữ phủ lên
 * các segment bị khớp (mỗi segment góp 1 hộp, x/độ rộng tính theo tỉ lệ
 * số ký tự). Dùng cho PDF search: hộp vẽ nền vàng lên trang khi nhảy tới.
 * Hàm thuần — test được bằng Node với segment giả.
 */
export function matchRects(
  text: string,
  segs: TextSegment[],
  query: string,
  maxResults = 3,
): { at: number; rects: PdfRect[] }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { at: number; rects: PdfRect[] }[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(q, from);
    if (at < 0 || out.length >= maxResults) return out;
    const end = at + q.length;
    const rects: PdfRect[] = [];
    for (const s of segs) {
      if (s.end <= at || s.start >= end) continue;
      const c0 = Math.max(at, s.start) - s.start;
      const c1 = Math.min(end, s.end) - s.start;
      const n = Math.max(1, s.str.length);
      rects.push({
        x: s.x + (c0 / n) * s.w,
        y: s.y,
        w: Math.max(1, ((c1 - c0) / n) * s.w),
        h: s.h,
      });
    }
    out.push({ at, rects });
    from = end;
  }
}

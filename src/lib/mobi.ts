import type { ReaderPage } from "../components/Reader";
import { sniffImageMime } from "./files";

/**
 * Đọc MOBI/AZW3 (không DRM) bằng parser PalmDB/MOBI viết tay, chạy thuần
 * trong WebView, không cần Node hay Rust:
 * - PalmDB header -> danh sách record
 * - Record 0: PalmDOC header (compression, encryption) + MOBI header
 *   (encoding, tên sách, first image index, EXTH)
 * - Text records 1..N: giải nén PalmDOC LZ77 (hoặc không nén), nối lại
 *   thành HTML, tách thành từng "trang" như chương EPUB.
 * - Ảnh nhúng: <img recindex="N"> -> data URL từ record N.
 *
 * Lỗi ném ra dùng mã để App.tsx dịch thành câu báo rõ cho người đọc:
 * MOBI_DRM (có DRM), MOBI_HUFF (nén Huff/CDIC chưa hỗ trợ),
 * MOBI_KF8 (AZW3 chỉ có phần KF8, không có phần Mobi7),
 * MOBI_KHONG_HOP_LE (không phải file MOBI/AZW3).
 */

// ---------------------------------------------------------------- PalmDOC
/**
 * Giải nén PalmDOC LZ77 (compression type 2), theo spec đã kiểm chứng
 * (fileformats.org/MobileRead Wiki, có ví dụ mẫu):
 * - 0x00: literal 0
 * - 0x01-0x08: literal run — copy n byte tiếp theo nguyên văn
 * - 0x09-0x7F: literal
 * - 0x80-0xBF + 1 byte: back-reference, 16 bit big-endian:
 *   distance = (v >> 3) & 0x7FF (1-2047), length = (v & 7) + 3 (3-10),
 *   copy từng byte (cho phép chồng lấn)
 * - 0xC0-0xFF: space + (byte XOR 0x80)
 */
export function palmdocDecompress(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i++];
    if (b === 0x00) {
      out.push(0);
    } else if (b >= 0x01 && b <= 0x08) {
      for (let k = 0; k < b && i < data.length; k++) out.push(data[i++]);
    } else if (b <= 0x7f) {
      out.push(b);
    } else if (b <= 0xbf) {
      if (i >= data.length) break;
      const v = (b << 8) | data[i++];
      const dist = (v >> 3) & 0x7ff;
      const len = (v & 0x7) + 3;
      const start = out.length - dist;
      for (let k = 0; k < len; k++) out.push(out[start + k] ?? 0);
    } else {
      out.push(0x20, b ^ 0x80);
    }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- helpers
function ascii(data: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = off; i < off + len && i < data.length; i++) s += String.fromCharCode(data[i]);
  return s;
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  try {
    return new TextDecoder(encoding === 1252 ? "windows-1252" : "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Tách 1 đoạn HTML dài thành các trang ~6000 ký tự, cắt ở ranh giới </p>. */
function splitPages(html: string, maxChars = 6000): string[] {
  const parts = html.split("\u0001");
  const pages: string[] = [];
  for (const part of parts) {
    if (part.trim() === "") continue;
    if (part.length <= maxChars) {
      pages.push(part);
      continue;
    }
    let cur = "";
    const chunks = part.split(/(?<=<\/p>)/i);
    for (const c of chunks) {
      if (cur.length + c.length > maxChars && cur.trim() !== "") {
        pages.push(cur);
        cur = c;
      } else {
        cur += c;
      }
      while (cur.length > maxChars) {
        pages.push(cur.slice(0, maxChars));
        cur = cur.slice(maxChars);
      }
    }
    if (cur.trim() !== "") pages.push(cur);
  }
  return pages;
}

// ---------------------------------------------------------------- parser
export interface MobiBook {
  title: string;
  pages: ReaderPage[];
}

export function parseMobi(data: Uint8Array, fallbackTitle: string): MobiBook {
  if (data.length < 78) throw new Error("MOBI_KHONG_HOP_LE");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (o: number) => dv.getUint16(o, false);
  const u32 = (o: number) => dv.getUint32(o, false);

  if (ascii(data, 60, 4) !== "BOOK" || ascii(data, 64, 4) !== "MOBI") {
    throw new Error("MOBI_KHONG_HOP_LE");
  }
  const nRec = u16(76);
  if (nRec < 1) throw new Error("MOBI_KHONG_HOP_LE");
  const offsets: number[] = [];
  for (let r = 0; r < nRec; r++) offsets.push(u32(78 + r * 8));
  offsets.push(data.length);
  const rec = (i: number): Uint8Array => {
    if (i < 0 || i >= nRec) return new Uint8Array(0);
    return data.subarray(offsets[i], offsets[i + 1]);
  };

  const r0 = rec(0);
  if (r0.length < 16) throw new Error("MOBI_KHONG_HOP_LE");
  const r0v = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
  const r0u16 = (o: number) => r0v.getUint16(o, false);
  const r0u32 = (o: number) => r0v.getUint32(o, false);

  const compression = r0u16(0);
  const textLength = r0u32(6);
  const textRecCount = r0u16(10);
  const encryption = r0u16(14);
  if (encryption !== 0) throw new Error("MOBI_DRM");
  if (compression !== 1 && compression !== 2) throw new Error("MOBI_HUFF");
  if (ascii(r0, 16, 4) !== "MOBI") throw new Error("MOBI_KHONG_HOP_LE");

  const headerLen = r0u32(20);
  const encoding = r0u32(28);
  const fullNameOff = r0u32(84);
  const fullNameLen = r0u32(88);
  const exthFlags = r0u32(128);

  let title = fallbackTitle;
  if (fullNameLen > 0 && 16 + fullNameOff + fullNameLen <= r0.length) {
    const t = decodeText(r0.subarray(16 + fullNameOff, 16 + fullNameOff + fullNameLen), encoding);
    if (t.trim()) title = t.trim();
  }
  // EXTH (nếu có): record type 503 = tiêu đề đầy đủ, ưu tiên hơn full name.
  if (exthFlags & 0x40) {
    try {
      const exthStart = 16 + headerLen;
      if (ascii(r0, exthStart, 4) === "EXTH") {
        const exthLen = r0u32(exthStart + 4);
        const count = r0u32(exthStart + 8);
        let p = exthStart + 12;
        const end = Math.min(r0.length, exthStart + exthLen);
        for (let k = 0; k < count && p + 8 <= end; k++) {
          const type = r0u32(p);
          const len = r0u32(p + 4);
          if (len < 8 || p + len > end) break;
          if (type === 503) {
            const t = decodeText(r0.subarray(p + 8, p + len), encoding);
            if (t.trim()) title = t.trim();
          }
          p += len;
        }
      }
    } catch {
      // EXTH lỗi thì kệ, vẫn dùng tiêu đề đã có.
    }
  }

  // Nối text records 1..textRecCount (giới hạn theo số record thật có).
  const nText = Math.min(textRecCount, nRec - 1);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 1; i <= nText; i++) {
    const raw = rec(i);
    const dec = compression === 2 ? palmdocDecompress(raw) : raw;
    chunks.push(dec);
    total += dec.length;
  }
  const all = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    all.set(c, pos);
    pos += c.length;
  }
  const textBytes = all.subarray(0, Math.min(textLength || total, total));
  let html = decodeText(textBytes, encoding);
  if (!html.trim()) throw new Error("MOBI_KF8");

  // Ảnh nhúng: <img recindex="N"> -> data URL từ record N.
  const imageUrl = (idx: number): string | null => {
    const bytes = rec(idx);
    if (bytes.length === 0) return null;
    let b64 = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      b64 += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK) as unknown as number[],
      );
    }
    return `data:${sniffImageMime(bytes)};base64,${btoa(b64)}`;
  };

  // Lấy phần body (nếu có), bỏ script/style/head/guide, đổi pagebreak
  // thành ranh giới trang (ký tự ).
  let body = html;
  const lower = html.toLowerCase();
  const bodyStart = lower.indexOf("<body");
  if (bodyStart >= 0) {
    const gt = html.indexOf(">", bodyStart);
    const bodyEnd = lower.lastIndexOf("</body>");
    if (gt >= 0) body = html.slice(gt + 1, bodyEnd > gt ? bodyEnd : undefined);
  }
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<guide[\s\S]*?<\/guide>/gi, "")
    .replace(/<mbp:pagebreak\b[^>]*>(?:<\/mbp:pagebreak>)?/gi, "\u0001")
    .replace(/<\/mbp:pagebreak>/gi, "");
  body = body.replace(/<img\b[^>]*recindex=["']?(\d+)["']?[^>]*>/gi, (_m, n) => {
    const url = imageUrl(parseInt(n, 10));
    return url ? `<img src="${url}" />` : "";
  });

  // File không có thẻ HTML: coi là văn bản thuần, chia đoạn.
  if (!/<[a-z][\s\S]*>/i.test(body)) {
    body = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
      .join("");
  }

  const pageHtmls = splitPages(body);
  if (pageHtmls.length === 0) throw new Error("MOBI_KF8");
  return {
    title,
    pages: pageHtmls.map((content, i) => ({
      content,
      isImage: false,
      label: `Trang ${i + 1}`,
    })),
  };
}

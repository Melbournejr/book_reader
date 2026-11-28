import type { SearchResult } from "../types";
import type { ReaderPage } from "../components/Reader";
import { api } from "./api";
import { b64ToBytes, bytesToB64, sniffImageMime } from "./files";
import {
  decodeText,
  mobiBodyHtml,
  palmdocDecompress,
  parseMobiHeader,
  readRecordOffsets,
  splitPages,
} from "./mobi";
import { searchTextPages, stripHtml } from "./search";

/**
 * Mở MOBI/AZW3 LƯỜI (v0.3.9) — theo mô hình trình xem video: chỉ đọc
 * index rồi seek tới đúng offset cần đọc, không parse cả file.
 *
 * Bản cũ (tới v0.3.8): App.tsx đọc CẢ file 412MB bằng readFileBytes +
 * parseMobi giải nén TẤT CẢ text record + build TẤT CẢ trang + chuyển
 * MỌI ảnh nhúng sang base64 TRƯỚC khi mở reader — app đơ hàng chục
 * giây tới hàng phút, kẹt ở toast "Đang mở...". Bản mới chỉ làm 3 việc
 * lúc mở:
 *   1. đọc 78 byte đầu -> số record, rồi đọc bảng offsets (78+8*nRec
 *      byte, với 100k record cũng chỉ ~800KB);
 *   2. đọc record 0 -> header (tiêu đề, nén, encoding, số text record);
 *   3. đọc VÙNG text records (liên tục, vài MB) -> giải nén (bản
 *      palmdocDecompress đã tối ưu) -> tách trang. Ảnh nhúng KHÔNG
 *      đụng tới lúc mở.
 * Ảnh chỉ đọc khi trang đó được render (loadPage): đúng 1-2 record
 * ảnh qua read_range, cache LRU nhỏ (16 ảnh). Mở MOBI 400MB hiện
 * reader trong <2s (đo bằng test với fixture tổng hợp).
 *
 * Giới hạn (ghi rõ): số trang có thể đổi nhẹ so với bản cũ vì ảnh
 * không còn ăn hết ngân sách 6000 ký tự của trang (placeholder
 * `<img data-mobi-rec>` chỉ ~20 ký tự, còn base64 cũ chiếm hàng MB)
 * — trang chứa được nhiều chữ hơn, tổng số trang ít hơn, vị trí đã
 * lưu có thể lệch vài trang khi mở lại sách cũ. Tìm kiếm vẫn quét
 * toàn bộ text (text đã có sẵn trong RAM, vài MB) nên không chậm hơn.
 */

export type MobiRangeReader = (
  path: string,
  offset: number,
  length: number,
) => Promise<string>;

export interface MobiLazyBook {
  title: string;
  total: number;
  /** Nhãn trang cho lưới trang (sách chữ hiện danh sách thay vì ảnh). */
  chapterTitles: string[];
  loadPage: (i: number) => Promise<ReaderPage>;
  search: (
    query: string,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<SearchResult[]>;
  /** Số byte đã đọc từ đĩa lúc mở (để test đo: phải nhỏ hơn nhiều so
   *  với kích thước file). */
  bytesReadAtOpen: number;
}

/** Đọc 1 vùng byte (có thể lớn) theo từng đoạn 4MB qua read_range. */
async function readRegion(
  path: string,
  offset: number,
  length: number,
  read: MobiRangeReader,
): Promise<Uint8Array> {
  const CHUNK = 4 * 1024 * 1024;
  const out = new Uint8Array(length);
  let done = 0;
  while (done < length) {
    const len = Math.min(CHUNK, length - done);
    const part = b64ToBytes(await read(path, offset + done, len));
    out.set(part.subarray(0, Math.min(len, part.length)), done);
    done += len;
  }
  return out;
}

export async function openMobiLazy(
  path: string,
  size: number,
  fallbackTitle: string,
  read: MobiRangeReader = api.readRange,
): Promise<MobiLazyBook> {
  let bytesRead = 0;
  const readBytes = async (offset: number, length: number): Promise<Uint8Array> => {
    const b64 = await read(path, offset, length);
    bytesRead += length;
    return b64ToBytes(b64);
  };

  // 1. Đọc 78 byte đầu -> số record, rồi đọc bảng offsets.
  const head78 = await readBytes(0, 78);
  const nRec = new DataView(head78.buffer, head78.byteOffset, head78.byteLength).getUint16(76, false);
  if (nRec < 1) throw new Error("MOBI_KHONG_HOP_LE");
  const head = await readBytes(0, 78 + nRec * 8);
  const offsets = readRecordOffsets(head, size);

  // 2. Đọc record 0 -> header MOBI.
  const r0 = await readBytes(offsets[0]!, offsets[1]! - offsets[0]!);
  const { title, compression, encoding, textLength, textRecCount } =
    parseMobiHeader(r0, fallbackTitle);

  // 3. Đọc vùng text records (liên tục trong file) rồi giải nén từng
  //    record. Ảnh (record còn lại, chiếm phần lớn file) không đụng tới.
  const nText = Math.min(textRecCount, nRec - 1);
  const textStart = offsets[1]!;
  const textEnd = offsets[nText + 1] ?? size;
  const textRegion = await readRegion(path, textStart, textEnd - textStart, read);
  bytesRead += textEnd - textStart;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 1; i <= nText; i++) {
    const raw = textRegion.subarray(offsets[i]! - textStart, offsets[i + 1]! - textStart);
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
  const html = decodeText(textBytes, encoding);
  if (!html.trim()) throw new Error("MOBI_KF8");

  // Tách trang trên body với ảnh là placeholder (~20 ký tự), KHÔNG
  // base64 lúc mở — trang chứa được nhiều chữ hơn bản cũ.
  const body = mobiBodyHtml(html).replace(
    /<img\b[^>]*recindex=["']?(\d+)["']?[^>]*>/gi,
    (_m, n) => `<img data-mobi-rec="${n}" />`,
  );
  const pageHtmls = splitPages(body);
  if (pageHtmls.length === 0) throw new Error("MOBI_KF8");
  const pageImages: number[][] = pageHtmls.map((p) => {
    const recs: number[] = [];
    const re = /data-mobi-rec="(\d+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p)) !== null) recs.push(parseInt(m[1], 10));
    return recs;
  });

  // Cache ảnh nhỏ (LRU, tối đa 16 ảnh): chỉ giữ ảnh các trang gần đây,
  // không giữ cả sách — đúng mô hình buffer nhỏ của trình xem video.
  const imgCache = new Map<number, string>();
  const imageUrl = async (idx: number): Promise<string | null> => {
    const hit = imgCache.get(idx);
    if (hit !== undefined) return hit;
    if (idx < 0 || idx >= nRec) return null;
    const bytes = await readBytes(offsets[idx]!, offsets[idx + 1]! - offsets[idx]!);
    if (bytes.length === 0) return null;
    const url = `data:${sniffImageMime(bytes)};base64,${bytesToB64(bytes)}`;
    imgCache.set(idx, url);
    if (imgCache.size > 16) {
      const first = imgCache.keys().next().value;
      if (first !== undefined) imgCache.delete(first);
    }
    return url;
  };

  const loadPage = async (i: number): Promise<ReaderPage> => {
    const pageHtml = pageHtmls[i];
    if (pageHtml === undefined) throw new Error("Trang không tồn tại");
    const recs = pageImages[i] ?? [];
    let content = pageHtml;
    if (recs.length > 0) {
      const urls = await Promise.all(recs.map((r) => imageUrl(r)));
      let k = 0;
      content = pageHtml.replace(/<img data-mobi-rec="\d+" \/>/g, () => {
        const url = urls[k++];
        return url ? `<img src="${url}" />` : "";
      });
    }
    return { content, isImage: false, label: `Trang ${i + 1}` };
  };

  const search = async (
    query: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SearchResult[]> => {
    const texts = pageHtmls.map((p, i) => ({
      label: `Trang ${i + 1}`,
      text: stripHtml(p),
    }));
    return searchTextPages(texts, query, onProgress);
  };

  return {
    title,
    total: pageHtmls.length,
    chapterTitles: pageHtmls.map((_, i) => `Trang ${i + 1}`),
    loadPage,
    search,
    bytesReadAtOpen: bytesRead,
  };
}

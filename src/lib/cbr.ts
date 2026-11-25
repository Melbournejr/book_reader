import { createExtractorFromData } from "node-unrar-js";
import wasmUrl from "node-unrar-js/esm/js/unrar.wasm?url";
import type { ReaderPage } from "../components/Reader";
import { bytesToB64, imageMime } from "./files";

/**
 * Mở CBR (RAR/RAR5) bằng node-unrar-js (WASM biên dịch từ lib unrar
 * chính thức của RARLab): đọc lười từng trang như CBZ — mở file chỉ đọc
 * danh sách file, lật tới trang nào mới giải nén trang đó.
 *
 * GIỚI HẠN (nói thẳng):
 * - Toàn bộ file RAR phải nạp vào RAM (ArrayBuffer) trước khi mở, vì
 *   WASM unrar làm việc trên bộ nhớ. File RAR 200MB+ sẽ nặng máy; với
 *   truyện lớn nên dùng CBZ.
 * - Không mở được file RAR chia nhiều tập (multi-volume) và RAR mã hóa
 *   header (cần mật khẩu — app P0 chưa có chỗ nhập mật khẩu).
 * - File RAR solid: giải nén 1 trang phải giải nén cả phần trước nó
 *   (lib tự làm), nên lật trang ở cuối file solid sẽ chậm hơn.
 * - Không cần cài thêm gì trên máy Windows: WASM đi kèm trong app.
 */

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

let wasmPromise: Promise<ArrayBuffer> | null = null;

/** Nạp file .wasm của unrar 1 lần duy nhất rồi cache lại. */
function loadWasm(): Promise<ArrayBuffer> {
  if (!wasmPromise) {
    wasmPromise = fetch(wasmUrl).then((r) => {
      if (!r.ok) throw new Error("CBR_WASM");
      return r.arrayBuffer();
    });
  }
  return wasmPromise;
}

/** So sánh tên file tự nhiên (page2 < page10), giống phía Rust làm cho CBZ. */
function naturalCmp(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (x !== "" && y !== "" && !Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

export interface CbrBook {
  names: string[];
  page: (i: number) => Promise<ReaderPage>;
}

/**
 * Mở 1 file RAR đã nạp sẵn thành bytes.
 * Ném lỗi có message CBR_MA_KHAU / CBR_TAP / CBR_KHONG_CO_ANH để App
 * dịch thành câu báo rõ.
 */
export async function openCbr(data: Uint8Array): Promise<CbrBook> {
  const wasmBinary = await loadWasm();
  let extractor;
  try {
    extractor = await createExtractorFromData({
      data: data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer,
      wasmBinary,
    });
  } catch {
    throw new Error("CBR_KHONG_MO_DUOC");
  }
  const list = (() => {
    try {
      return extractor.getFileList();
    } catch {
      throw new Error("CBR_KHONG_MO_DUOC");
    }
  })();
  if (list.arcHeader.flags.headerEncrypted) throw new Error("CBR_MA_KHAU");
  if (list.arcHeader.flags.volume) throw new Error("CBR_TAP");
  const names: string[] = [];
  for (const h of list.fileHeaders) {
    if (h.flags.encrypted) throw new Error("CBR_MA_KHAU");
    if (!h.flags.directory && IMAGE_RE.test(h.name)) names.push(h.name);
  }
  names.sort(naturalCmp);
  if (names.length === 0) throw new Error("CBR_KHONG_CO_ANH");

  // LƯU Ý: phải đọc hết generator extract() thì closeArc() trong
  // node-unrar-js mới chạy (đóng archive, đưa con trỏ file về 0). Nếu
  // return giữa chừng từ trong vòng for, generator bị bỏ dở, archive
  // không đóng, lần extract() sau sẽ lỗi ERAR_EREAD. Vì vậy: gom bytes
  // trong vòng lặp, chuyển thành data URL SAU khi vòng lặp chạy hết.
  const page = async (i: number): Promise<ReaderPage> => {
    const files = extractor.extract({ files: [names[i]] });
    let bytes: Uint8Array | null = null;
    for (const f of files.files) {
      if (f.extraction && !bytes) bytes = f.extraction as Uint8Array;
    }
    if (!bytes) throw new Error("CBR_KHONG_DOC_DUOC_TRANG");
    return {
      content: `data:${imageMime(names[i])};base64,${bytesToB64(bytes)}`,
      isImage: true,
      label: names[i],
    };
  };
  return { names, page };
}

import { api } from "./api";

/** Giải base64 (trả về từ lệnh Rust read_range) thành bytes. */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Mã hóa bytes thành base64, chia đoạn để không tràn stack với trang lớn. */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return btoa(bin);
}

/** Đoán MIME ảnh theo đuôi file (dùng cho data URL). */
export function imageMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}

/** Đoán MIME ảnh theo magic bytes (dùng cho ảnh nhúng trong MOBI). */
export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return "image/gif";
  return "image/jpeg";
}

/**
 * Đọc cả file local thành bytes, theo từng đoạn 4 MB qua lệnh Rust
 * read_range — không copy file, chỉ đọc từ file gốc.
 * Chỉ dùng cho file vừa (MOBI, CBR): PDF dùng range transport riêng,
 * không nạp cả file.
 */
export async function readFileBytes(path: string, size: number): Promise<Uint8Array> {
  const CHUNK = 4 * 1024 * 1024;
  const out = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const len = Math.min(CHUNK, size - offset);
    const part = b64ToBytes(await api.readRange(path, offset, len));
    out.set(part, offset);
    offset += len;
  }
  return out;
}

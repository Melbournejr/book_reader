/**
 * URL trang ảnh qua custom protocol `mio-page://` (v0.3.9).
 *
 * Vấn đề nó giải quyết: đường nạp trang cũ (Rust `cbz_page` trả base64
 * qua invoke -> `<img src="data:...">` vài MB) bắt chuỗi base64 khổng
 * lồ đi qua JSON invoke, rồi trình duyệt giải mã lại trên luồng chính
 * — mỗi lần lật trả giá vài trăm ms, cảm giác "đơ". Bản web (mà Thiện
 * khen mượt) dùng File API + blob URL: ảnh nạp như URL thật, bất đồng
 * bộ, cache được, giải mã ngoài luồng chính.
 *
 * `mio-page://cbz/<đường dẫn đã encode>/<số trang>` được Rust phục vụ
 * trực tiếp từ file ZIP (xem main.rs `page_response`): không base64,
 * không JSON, ảnh load như ảnh web bình thường (async, cache theo URL,
 * giải mã ngoài luồng chính). Nếu protocol lỗi (vd bản cũ chưa có
 * protocol, hoặc file đã đổi), `<img onError>` trong Reader dùng
 * `fallback` (base64 qua `cbz_page`) — trang vẫn hiện, chỉ chậm hơn.
 *
 * Định dạng URL ổn định theo (sách, số trang) để WebView cache được
 * ảnh đã giải mã: lật tới-lui cùng trang không giải mã lại.
 */

/** URL protocol cho 1 trang CBZ (dạng `mio-page://cbz/<path>/<index>`). */
export function pageUrl(kind: "cbz", path: string, index: number): string {
  return `mio-page://cbz/${encodeURIComponent(path)}/${index}`;
}

/** Tách URL trang ảnh thành {kind, path, index} — dùng cho test và để
 *  đối chiếu với phía Rust (main.rs `page_response` parse cùng dạng). */
export function parsePageUrl(
  url: string,
): { kind: string; path: string; index: number } | null {
  const m = /^mio-page:\/\/([^/]+)\/(.+)\/(\d+)$/.exec(url);
  if (!m) return null;
  try {
    return {
      kind: m[1]!,
      path: decodeURIComponent(m[2]!),
      index: parseInt(m[3]!, 10),
    };
  } catch {
    return null;
  }
}

/** Có phải URL trang ảnh qua custom protocol không. */
export function isPageUrl(content: string): boolean {
  return content.startsWith("mio-page://");
}

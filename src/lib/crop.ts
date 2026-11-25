import type { CropMargins } from "../types";

/**
 * Cắt lề trang ảnh/truyện (CBZ/CBR/PDF) lúc hiển thị — KHÔNG sửa file gốc.
 *
 * Cách cắt (CSS thuần, không canvas lúc đọc): ảnh phóng to rồi dịch,
 * phần lề thừa tràn ra ngoài khung (overflow hidden) — vùng còn lại
 * lấp đầy đúng khung trang. Tính toán trong cropImgStyle đã kiểm chứng
 * bằng test Node (xem /tmp/p1-test).
 */

export const NO_CROP: CropMargins = { top: 0, right: 0, bottom: 0, left: 0 };

/** Kẹp từng phía 0–40%, và không cắt quá 90% theo 1 chiều. */
export function clampCrop(c: CropMargins): CropMargins {
  const out: CropMargins = { top: c.top, right: c.right, bottom: c.bottom, left: c.left };
  // Kiểm tra tổng trước khi kẹp từng phía (kẹp trước thì tổng tối đa
  // chỉ còn 80%, kiểm tra 90% sẽ không bao giờ chạy).
  if (out.left + out.right >= 90) {
    out.left = 0;
    out.right = 0;
  }
  if (out.top + out.bottom >= 90) {
    out.top = 0;
    out.bottom = 0;
  }
  const cl = (v: number) => Math.max(0, Math.min(40, Math.round(v)));
  out.top = cl(out.top);
  out.right = cl(out.right);
  out.bottom = cl(out.bottom);
  out.left = cl(out.left);
  return out;
}

export function hasCrop(c: CropMargins): boolean {
  return c.top > 0 || c.right > 0 || c.bottom > 0 || c.left > 0;
}

/**
 * Style cho <img> trong khung cắt (khung có overflow:hidden).
 * Ví dụ cắt trái 10%, phải 10%: ảnh rộng 125% khung, dịch trái 10%
 * bề rộng ảnh -> đúng 10% bề rộng ảnh gốc bị đẩy ra ngoài.
 */
export function cropImgStyle(c: CropMargins): {
  width: string;
  height: string;
  transform: string;
  objectFit: "fill";
} {
  const cc = clampCrop(c);
  const lr = (cc.left + cc.right) / 100;
  const tb = (cc.top + cc.bottom) / 100;
  return {
    width: `${100 / (1 - lr)}%`,
    height: `${100 / (1 - tb)}%`,
    transform: `translate(-${cc.left}%, -${cc.top}%)`,
    objectFit: "fill",
  };
}

/**
 * Tự phát hiện lề trắng trên dữ liệu pixel thô (RGBA).
 * Quét từ 4 phía: hàng/cột nào có >=98% pixel gần trắng (>= threshold)
 * thì tính là lề, tối đa maxCropPct% mỗi phía. Lấy mẫu cách 2 pixel
 * để quét nhanh; 1-2 đốm đen lẻ không chặn được việc cắt.
 */
export function detectMargins(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 242,
  maxCropPct = 25,
): CropMargins {
  const isWhite = (x: number, y: number): boolean => {
    const o = (y * width + x) * 4;
    return data[o] >= threshold && data[o + 1] >= threshold && data[o + 2] >= threshold;
  };
  const rowWhite = (y: number): boolean => {
    let white = 0;
    let total = 0;
    for (let x = 0; x < width; x += 2) {
      total++;
      if (isWhite(x, y)) white++;
    }
    return total > 0 && white / total >= 0.98;
  };
  const colWhite = (x: number): boolean => {
    let white = 0;
    let total = 0;
    for (let y = 0; y < height; y += 2) {
      total++;
      if (isWhite(x, y)) white++;
    }
    return total > 0 && white / total >= 0.98;
  };
  const maxTop = Math.floor((height * maxCropPct) / 100);
  const maxLeft = Math.floor((width * maxCropPct) / 100);
  let top = 0;
  while (top < maxTop && rowWhite(top)) top++;
  let bottom = 0;
  while (bottom < maxTop && rowWhite(height - 1 - bottom)) bottom++;
  let left = 0;
  while (left < maxLeft && colWhite(left)) left++;
  let right = 0;
  while (right < maxLeft && colWhite(width - 1 - right)) right++;
  return {
    top: Math.round((top / height) * 100),
    bottom: Math.round((bottom / height) * 100),
    left: Math.round((left / width) * 100),
    right: Math.round((right / width) * 100),
  };
}

/** Phát hiện lề từ data URL ảnh (chạy trong WebView, dùng canvas). */
export function detectMarginsFromImage(dataUrl: string, maxDim = 320): Promise<CropMargins> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("no-2d"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        resolve(detectMargins(px, w, h));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("crop-load"));
    img.src = dataUrl;
  });
}

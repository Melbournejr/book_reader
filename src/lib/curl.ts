/**
 * Hình học nếp gấp — mô hình đã chứng minh trong bản web phan-mem-doc-sach.
 *
 * Nếp gấp = đường trung trực của đoạn từ điểm nắm ban đầu (grab) tới vị
 * trí con trỏ hiện tại (pointer). Điểm nắm gấp đúng tới tay người đọc.
 *
 * LƯU Ý (v0.2.0): mặt sau của lá trang KHÔNG được soi gương sẵn
 * (scaleX(-1)) ở đây. Bản web v9 dùng pre-mirror vì mô hình giấy của nó
 * khác; bản desktop dùng mô hình thẻ 3D (rotateY quanh gáy) nên pre-mirror
 * sẽ soi gương 2 lần -> trang sau hiện ngược. Mô hình đúng nằm ở
 * lib/spread.ts (backFaceFactor / frontFaceFactor) và Reader.tsx render
 * mặt sau với mirrored=false. Đừng "sửa" lại theo kiểu web v9.
 */

export interface FoldPoint {
  x: number;
  y: number;
}

export interface FoldGeometry {
  /** Góc xoay của lá (radian), 0 = chưa lật, PI = lật xong. */
  angle: number;
  /** Điểm giữa đoạn grab->pointer (nếp gấp đi qua đây). */
  creaseMid: FoldPoint;
  /** Góc của nếp gấp so với trục dọc. */
  creaseAngle: number;
  /** 0..1: tiến độ lật. */
  progress: number;
}

/** Tính nếp gấp từ điểm nắm và vị trí con trỏ, theo chiều rộng trang. */
export function foldGeometry(
  grab: FoldPoint,
  pointer: FoldPoint,
  pageWidth: number,
): FoldGeometry {
  const dx = pointer.x - grab.x;
  // Kéo ngang là chính; kéo dọc làm nếp gấp nghiêng, giống giấy thật.
  const progress = Math.min(1, Math.max(0, Math.abs(dx) / pageWidth));
  const angle = progress * Math.PI;
  return {
    angle,
    creaseMid: { x: (grab.x + pointer.x) / 2, y: (grab.y + pointer.y) / 2 },
    creaseAngle: Math.atan2(pointer.y - grab.y, dx || 1),
    progress,
  };
}

/** Easing cho lật bằng nút/phím: nhanh lúc rời chồng giấy, chậm dần khi chạm xuống. */
export function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

export const FLIP_MS = 900;

/**
 * Hình học nếp gấp — mô hình đã chứng minh trong bản web phan-mem-doc-sach.
 *
 * Nếp gấp = đường trung trực của đoạn từ điểm nắm ban đầu (grab) tới vị
 * trí con trỏ hiện tại (pointer). Điểm nắm gấp đúng tới tay người đọc.
 * Mặt sau của lá trang được soi gương sẵn (scaleX(-1)) để triệt tiêu với
 * phép phản xạ của nếp gấp -> thành phép quay thuần, trang sau không bao
 * giờ hiện ngược. Xem bản web v9: lỗi ngược ảnh đã sửa 2026-11-21.
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

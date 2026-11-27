/**
 * Toán bố cục spread — trích đúng công thức trong Reader.tsx thành hàm
 * thuần để test được bằng Node (xem v037-spread-fit-test.ts).
 *
 * Mô hình (giữ nguyên từ v0.3.4):
 * - spread có chiều cao layout `baseH` (CSS: min(560px, 100dvh-150px),
 *   đo từ phần tử .spread); mỗi slot ảnh ôm đúng tỉ lệ trang
 *   (rộng = tỉ lệ * baseH, chưa biết tỉ lệ thì tạm 0.72); bên trống
 *   (vd bìa manga RTL chỉ có 1 trang bên phải) rộng bằng bên kia.
 * - `fitScale` vừa trang theo chiều hẹp hơn (rộng hoặc cao); `scale`
 *   = fitScale * zoom; khung scaler = naturalW*scale × baseH*scale.
 *
 * Căn giữa (v0.3.7 — sửa lỗi video 27/11): trước đây scaler được căn
 * bằng `.spread-viewport { justify-content: center }` kèm
 * `overflow: auto` — cái bẫy flexbox kinh điển: khi scaler RỘNG hơn
 * viewport thì phần tràn bên TRÁI bị cắt và KHÔNG cuộn tới được
 * (scrollLeft không âm được), spread trông như lệch/cụt bên trái;
 * và scrollLeft cũ không bao giờ được reset khi đổi chế độ nên spread
 * lệch hẳn sang trái với khoảng đen lớn bên phải ở full màn. Giờ
 * scaler dùng `margin: auto` (xem styles.css): hẹp hơn thì căn giữa
 * cả 2 chiều, rộng hơn thì dồn về mép trái/trên và cuộn được hết.
 * `offsetX/offsetY` dưới đây chính là vị trí margin-auto cho ra:
 * max(0, (viewport - scaler)/2) — 0 khi tràn (cuộn được), còn lại
 * là khoảng đen đều 2 bên.
 */
import type { Pt } from "./curl";

export type FitMode = "page" | "width" | "height";

export interface SpreadLayoutInput {
  /** Client size của .spread-viewport (px). */
  vpW: number;
  vpH: number;
  /** Chiều cao layout của spread (px). */
  baseH: number;
  /** Tỉ lệ rộng/cao của trang trái (null = bên trái trống). */
  leftAspect: number | null;
  /** Tỉ lệ rộng/cao của trang phải (null = bên phải trống / 1 trang). */
  rightAspect: number | null;
  twoPage: boolean;
  /** Trang ảnh (CBZ/CBR/PDF) thì slot ôm tỉ lệ; sách chữ chia đôi. */
  useAspectSlots: boolean;
  fit: FitMode;
  zoom: number;
}

export interface SpreadLayout {
  naturalW: number;
  fitScale: number;
  scale: number;
  scalerW: number;
  scalerH: number;
  leftSlotW: number;
  rightSlotW: number;
  /** Vị trí trái/trên của scaler trong viewport với margin-auto (>= 0). */
  offsetX: number;
  offsetY: number;
  fitsWidth: boolean;
  fitsHeight: boolean;
  /** Phần tràn có thể cuộn được khi scaler lớn hơn viewport (>= 0). */
  scrollX: number;
  scrollY: number;
}

export function computeSpreadLayout(input: SpreadLayoutInput): SpreadLayout {
  const { vpW, vpH, baseH, twoPage, useAspectSlots, fit, zoom } = input;
  const baseW = twoPage
    ? Math.min(1200, Math.max(320, vpW - 24))
    : Math.min(600, Math.max(320, vpW - 24));
  // Bên trống thì rộng bằng bên kia; chưa biết tỉ lệ thì tạm 0.72.
  const slotW = (a: number | null, other: number | null): number => {
    if (!useAspectSlots) return 0;
    const eff = a ?? other ?? 0.72;
    return Math.max(120, eff * baseH);
  };
  const leftSlotW = slotW(input.leftAspect, input.rightAspect);
  const rightSlotW = twoPage ? slotW(input.rightAspect, input.leftAspect) : 0;
  const naturalW = useAspectSlots
    ? twoPage
      ? leftSlotW + rightSlotW
      : leftSlotW
    : baseW;
  const effH = Math.min(baseH, vpH);
  const fitScale =
    fit === "width"
      ? vpW / naturalW
      : fit === "height"
        ? vpH / effH
        : Math.min(vpW / naturalW, vpH / effH);
  const scale = fitScale * zoom;
  const scalerW = naturalW * scale;
  const scalerH = Math.max(1, baseH * scale);
  return {
    naturalW,
    fitScale,
    scale,
    scalerW,
    scalerH,
    leftSlotW,
    rightSlotW,
    offsetX: Math.max(0, (vpW - scalerW) / 2),
    offsetY: Math.max(0, (vpH - scalerH) / 2),
    fitsWidth: scalerW <= vpW,
    fitsHeight: scalerH <= vpH,
    scrollX: Math.max(0, scalerW - vpW),
    scrollY: Math.max(0, scalerH - vpH),
  };
}

/** Vị trí visual của spread trong viewport khi đã scale.
 *
 * GỐC LỖI v0.3.6 (video 27/11): `.spread` có `transform: scale(...)`
 * với `transformOrigin: "top center"`. Khi đó visual của spread KHÔNG
 * khớp khung `.spread-scaler`: nó lệch một đoạn
 * `naturalW * (1 - scale) / 2` — scale > 1 thì lệch TRÁI (trang trái
 * cụt ở mép trái, bên phải đen lớn; ở full màn scale ≈ 1.9 → lệch
 * ~375px, đúng y frame f25/f42), scale < 1 thì lệch phải. Chỉ khi
 * scale == 1 mới đúng. Từ v0.3.7 dùng origin "top left" (visual khớp
 * đúng scaler, visualLeft == offsetX) nên lỗi này biến mất.
 */
export function spreadVisualRect(
  layout: SpreadLayout,
  origin: "top left" | "top center",
): { left: number; right: number; width: number } {
  const shift =
    origin === "top left" ? 0 : (layout.naturalW * (1 - layout.scale)) / 2;
  const left = layout.offsetX + shift;
  return { left, right: left + layout.scalerW, width: layout.scalerW };
}

/**
 * Neo hình học cho một cú lật cong (xem flipGeom bản web):
 * - `spineX`: mép gáy của cell đang lật (mép trái nếu spineLeft,
 *   mép phải nếu không);
 * - `grab`: góc ngoài-dưới của cell — điểm nắm khi lật có hiệu ứng;
 * - `mirror`: điểm nắm phản chiếu qua gáy — điểm đáp khi lật xong.
 * Đường lật có hiệu ứng đi theo cung quadBezier(grab → mirror) với
 * điểm điều khiển ở giữa, cao lên h*0.22 (góc giấy quét qua gáy).
 */
export function curlAnchors(
  cellX: number,
  cellW: number,
  spineLeft: boolean,
  height: number,
): { spineX: number; grab: Pt; mirror: Pt } {
  const spineX = spineLeft ? cellX : cellX + cellW;
  const grab: Pt = { x: spineLeft ? cellX + cellW : cellX, y: height };
  const mirror: Pt = { x: 2 * spineX - grab.x, y: height };
  return { spineX, grab, mirror };
}

/** Điểm điều khiển cho cung lật grab → mirror (quét qua gáy). */
export function curlArcControl(grab: Pt, mirror: Pt, height: number): Pt {
  return { x: (grab.x + mirror.x) / 2, y: height * 0.22 };
}

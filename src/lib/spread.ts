/**
 * Mô hình spread / lá lật — logic thuần, test được bằng Node.
 *
 * Một "spread" là 1 hoặc 2 trang đang mở cùng lúc. `spreadStart` là trang
 * đầu tiên theo THỨ TỰ ĐỌC của spread đó (không phải lúc nào cũng là
 * trang bên trái — với manga RTL thì trang đọc trước nằm bên PHẢI).
 *
 * - LTR: spread bắt đầu ở 0, 2, 4...; trái = start, phải = start+1.
 * - RTL (manga): spread đầu là trang 0 đứng một mình bên phải (bìa),
 *   rồi (1,2), (3,4), (5,6)...; phải = start, trái = start+1.
 *
 * Lá lật (leaf) là 1 tờ giấy 2 mặt (mô hình card 3D chuẩn):
 * - mặt trước: trang đang đọc, không soi gương;
 * - mặt sau: trang đích — CSS `.leaf-back { transform: rotateY(180deg) }`
 *   ĐÃ tự triệt tiêu phép soi gương khi lá xoay đủ 180°. Vì vậy nội dung
 *   mặt sau KHÔNG được scaleX(-1) thêm nữa (bản 0.1.5 làm cả hai nên
 *   trang lật tới hiện ngược — xem `backFaceFactor` bên dưới).
 */

/** Trang đầu tiên theo thứ tự đọc của spread chứa `page`. */
export function spreadStartForPage(
  page: number,
  twoPage: boolean,
  rtl: boolean,
  total: number,
): number {
  const p = Math.max(0, Math.min(total - 1, page));
  if (!twoPage) return p;
  if (!rtl) return Math.floor(p / 2) * 2;
  // RTL 2 trang: bìa (0) đứng một mình, các spread sau bắt đầu ở số lẻ.
  if (p === 0) return 0;
  return p % 2 === 1 ? p : p - 1;
}

/** Trang nằm ở mỗi bên của spread (null = bên đó trống). */
export function spreadSides(
  spreadStart: number,
  twoPage: boolean,
  rtl: boolean,
  total: number,
): { left: number | null; right: number | null } {
  const start = spreadStartForPage(spreadStart, twoPage, rtl, total);
  if (!twoPage) return { left: start, right: null };
  const next = start + 1 < total ? start + 1 : null;
  if (!rtl) return { left: start, right: next };
  // RTL: trang đọc trước (start) nằm bên phải, trang sau nằm bên trái.
  // Ngoại lệ: bìa (start = 0) đứng một mình bên phải, bên trái trống.
  return { left: start === 0 ? null : next, right: start };
}

/** Spread bắt đầu ở đâu nếu lật theo `dir` (1 = tới, -1 = lui); null = hết sách. */
export function nextSpreadStart(
  spreadStart: number,
  dir: 1 | -1,
  twoPage: boolean,
  rtl: boolean,
  total: number,
): number | null {
  const cur = spreadStartForPage(spreadStart, twoPage, rtl, total);
  if (dir === 1) {
    if (!twoPage) return cur + 1 < total ? cur + 1 : null;
    if (!rtl) {
      const n = cur + 2;
      return n < total ? n : null;
    }
    // RTL 2 trang: từ bìa (0) sang spread (1,2), rồi 3, 5, 7...
    const n = cur === 0 ? 1 : cur + 2;
    return n < total ? n : null;
  }
  // dir === -1
  if (!twoPage) return cur - 1 >= 0 ? cur - 1 : null;
  if (!rtl) {
    const n = cur - 2;
    return n >= 0 ? n : null;
  }
  // RTL 2 trang: ...5, 3, 1, 0 (bìa).
  const n = cur === 1 ? 0 : cur - 2;
  return n >= 0 ? n : null;
}

/** Trang đọc ĐẦU TIÊN của 1 spread (luôn có). */
function firstReadPage(
  sides: { left: number | null; right: number | null },
  rtl: boolean,
): number {
  if (!rtl) return sides.left ?? sides.right ?? 0;
  return sides.right ?? sides.left ?? 0;
}

/** Trang đọc CUỐI CÙNG của 1 spread (luôn có). */
function lastReadPage(
  sides: { left: number | null; right: number | null },
  rtl: boolean,
): number {
  if (!rtl) return sides.right ?? sides.left ?? 0;
  return sides.left ?? sides.right ?? 0;
}
export interface LeafFlip {
  /** Trang hiện tại đang lật (mặt trước của lá). */
  front: number;
  /** Trang đích sẽ hiện ra (mặt sau của lá). */
  back: number;
  /** true = lá xoay quanh gáy bên trái (trang phải lật sang trái). */
  spineLeft: boolean;
  /** Spread đích (đầu spread theo thứ tự đọc). */
  next: number;
}

/**
 * Lá nào lật khi đi theo `dir` từ spread hiện tại.
 * - LTR tới: lật trang phải (gáy trái), hiện trang trái của spread đích.
 * - LTR lui: lật trang trái (gáy phải), hiện trang phải của spread đích.
 * - RTL tới: lật trang trái — trang vừa đọc xong (gáy phải), hiện trang
 *   phải của spread đích (trang đọc tiếp theo).
 * - RTL lui: lật trang phải, hiện trang trái của spread đích.
 * - 1 trang: mặt trước = trang hiện tại, mặt sau = trang đích; gáy trái
 *   khi (tới và LTR) hoặc (lui và RTL).
 */
export function leafForFlip(
  spreadStart: number,
  dir: 1 | -1,
  twoPage: boolean,
  rtl: boolean,
  total: number,
): LeafFlip | null {
  const cur = spreadStartForPage(spreadStart, twoPage, rtl, total);
  const next = nextSpreadStart(cur, dir, twoPage, rtl, total);
  if (next === null) return null;
  const spineLeft = (dir === 1) !== rtl;
  if (!twoPage) {
    return { front: cur, back: next, spineLeft, next };
  }
  const curSides = spreadSides(cur, true, rtl, total);
  const nextSides = spreadSides(next, true, rtl, total);
  if (dir === 1) {
    // Tới: lật trang vừa đọc xong (trang cuối của spread hiện tại).
    // Hiện trang đọc tiếp theo của spread đích (trang đầu của nó).
    return { front: lastReadPage(curSides, rtl), back: firstReadPage(nextSides, rtl), spineLeft, next };
  }
  // Lui: lật trang đọc đầu tiên của spread hiện tại.
  // Hiện trang cuối cùng của spread đích.
  return { front: firstReadPage(curSides, rtl), back: lastReadPage(nextSides, rtl), spineLeft, next };
}

/**
 * Hệ số ngang của nội dung trên MẶT SAU của lá ở tiến độ lật `progress`
 * (0 = chưa lật, 1 = lật xong). Dương = chữ/tranh hiện đúng chiều,
 * âm = bị ngược (soi gương).
 *
 * Mô hình: nội dung -> (preMirrored ? scaleX(-1) : 1) -> rotateY(180°)
 * của `.leaf-back` -> rotateY(θ) của `.curl-leaf`, với θ = ±progress·180°
 * (dấu - khi gáy trái, + khi gáy phải). Hệ số ngang = cos(θ)·cos(180°)·
 * (preMirrored ? -1 : 1). Mặt sau chỉ nhìn thấy được khi progress > 0.5
 * (lá đã xoay quá nửa, mặt sau quay ra trước).
 *
 * Kết luận: với mô hình card chuẩn này, preMirrored=true (code 0.1.5:
 * renderFace(leafBack, mirrored=true)) cho hệ số ÂM trong suốt nửa sau
 * của cú lật — trang đích hiện ngược. Bỏ pre-mirror (mirrored=false)
 * thì hệ số DƯƠNG — hiện đúng chiều. Chứng minh bằng test, xem
 * /tmp/v02-test/test.ts (không đưa vào repo).
 */
export function backFaceFactor(
  progress: number,
  spineLeft: boolean,
  preMirrored: boolean,
): number {
  const theta = (spineLeft ? -1 : 1) * progress * Math.PI;
  return Math.cos(theta) * Math.cos(Math.PI) * (preMirrored ? -1 : 1);
}

/** Hệ số ngang của MẶT TRƯỚC của lá (không soi gương sẵn, không xoay 180°). */
export function frontFaceFactor(progress: number, spineLeft: boolean): number {
  const theta = (spineLeft ? -1 : 1) * progress * Math.PI;
  return Math.cos(theta);
}

/** true = mặt sau đang quay ra trước (nhìn thấy được) ở tiến độ này. */
export function backFaceVisible(progress: number): boolean {
  return progress > 0.5;
}

/** RTL mặc định khi mở 1 cuốn (v0.3.0 — truyện tranh auto-RTL theo thiết kế):
 *  - cuốn đã có cài đặt riêng (savedRtl) thì dùng cài đặt đó;
 *  - truyện tranh (CBZ/CBR) chưa có cài đặt riêng thì RTL mặc định BẬT;
 *  - còn lại dùng mặc định chung của app (globalDefault, checkbox trong Cài đặt). */
export function resolveInitialRtl(
  format: string,
  savedRtl: boolean | undefined,
  globalDefault: boolean,
): boolean {
  if (savedRtl !== undefined) return savedRtl;
  if (isComicFormat(format)) return true;
  return globalDefault;
}

/** Định dạng truyện tranh (ảnh theo trang). */
export function isComicFormat(format: string): boolean {
  const f = format.toLowerCase();
  return f === "cbz" || f === "cbr";
}

/**
 * Trang nền từng bên trong lúc lật (mô hình bản web: base theo từng flip).
 *  Bên lật lấy trang đích của nó; bên còn lại giữ trang hiện tại — trừ khi
 *  bên đó đang trống (vd bìa RTL đứng một mình, trang trái null) thì lấy
 *  trang đích để không bị trống trong lúc lật. Nền này tính sẵn cho đúng
 *  cú lật đó và dọn cùng lúc với lá (thay cho curlTarget toàn cục).
 *  1 trang: nền chỉ có trang đích.
 */
export function flipBaseSides(
  leaf: LeafFlip,
  spreadStart: number,
  twoPage: boolean,
  rtl: boolean,
  total: number,
): { left: number | null; right: number | null } {
  const curSides = spreadSides(spreadStart, twoPage, rtl, total);
  const nextSides = spreadSides(leaf.next, twoPage, rtl, total);
  if (!twoPage) return { left: leaf.next, right: null };
  const frontIsLeft = curSides.left === leaf.front;
  const pick = (side: "left" | "right"): number | null => {
    const isTurningSide = side === "left" ? frontIsLeft : !frontIsLeft;
    if (isTurningSide) return nextSides[side];
    return curSides[side] ?? nextSides[side];
  };
  return { left: pick("left"), right: pick("right") };
}

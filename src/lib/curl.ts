/**
 * Page-curl geometry — port trực tiếp từ bản web phan-mem-doc-sach
 * (client/src/curl.ts), bản demo mà Thiện từng khen "đọc thấy ngon".
 *
 * Bản desktop trước đây (tới v0.3.6) chỉ dùng một tấm phẳng rotateY
 * quanh gáy: lá cứng như bìa, nếp gấp là dải mờ tĩnh dán ở mép lá,
 * bóng đổ tĩnh trên trang đích — nhìn không giống giấy, lật nặng và
 * giả. Mô hình đúng (StPageFlip / iBooks reflection fold): người đọc
 * nắm trang tại điểm G và kéo tới vị trí P; nếp gấp là đường trung trực
 * của đoạn G→P — nếp gấp nằm đúng giữa chỗ nắm và tay người đọc, vuông
 * góc với hướng kéo. Phần trang qua nếp gấp là ảnh phản chiếu của vùng
 * đó qua đường gấp:
 * - mặt trước: trang hiện tại, cắt theo phần chưa gấp (phía gáy);
 * - mặt sau: trang đích, phản chiếu qua nếp gấp, cắt theo đa giác
 *   phản chiếu — nội dung được soi gương sẵn trong cell nên đọc đúng
 *   chiều ở mọi tư thế (xem CurlLeaf.tsx);
 * - trang bên dưới lộ ra ở chỗ lá đã nhấc lên, kèm bóng đổ + nếp gấp
 *   + vệt sáng dọc theo nếp gấp, tất cả bám theo đường gấp thật.
 * Nhờ G là đúng chỗ con trỏ bấm nên kéo góc, kéo giữa mép hay kéo
 * xiên đều gấp theo tay, không chỉ gấp ngang.
 *
 * LƯU Ý: đừng "sửa" lại theo kiểu card 3D (mặt sau không soi gương +
 * rotateY 180°) như bản desktop cũ — mô hình đó đã bị thay thế hoàn
 * toàn ở v0.3.7. Nội dung mặt sau PHẢI được soi gương sẵn trong cell
 * (CurlLeaf làm việc này) thì mới đọc đúng chiều khi phản chiếu.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface FoldGeometry {
  /** Front-face clip polygon (page coords): the part not yet folded. */
  near: Pt[];
  /** Back-face clip polygon (page coords): the reflected folded part. */
  back: Pt[];
  /** CSS matrix() reflection across the fold line, in page coords. */
  matrix: [number, number, number, number, number, number];
  /** Fold line segment clipped to the arena rect. */
  foldA: Pt;
  foldB: Pt;
  foldMid: Pt;
  /** Unit normal of the fold, pointing from the grab point toward P. */
  normal: Pt;
  /** Rotation (deg) for a strip whose local +x axis points along +normal. */
  stripAngleDeg: number;
  /** 0..1 curl strength for shading: peaks mid-turn, flat at both ends. */
  depth: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Sutherland–Hodgman clip of a polygon against one half-plane. */
function clipHalfPlane(
  poly: Pt[],
  mx: number,
  my: number,
  nx: number,
  ny: number,
  keepPositive: boolean,
): Pt[] {
  const s = (p: Pt) =>
    (keepPositive ? 1 : -1) * ((p.x - mx) * nx + (p.y - my) * ny);
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    const sc = s(cur);
    const sp = s(prev);
    const curIn = sc >= -1e-9;
    const prevIn = sp >= -1e-9;
    if (curIn !== prevIn) {
      const t = sp / (sp - sc);
      out.push({
        x: prev.x + (cur.x - prev.x) * t,
        y: prev.y + (cur.y - prev.y) * t,
      });
    }
    if (curIn) out.push(cur);
  }
  return out;
}

/** Liang–Barsky clip of a segment against an axis-aligned rect. */
function clipSegment(
  a: Pt,
  b: Pt,
  r: { x: number; y: number; w: number; h: number },
): { a: Pt; b: Pt } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x, r.x + r.w - a.x, a.y - r.y, r.y + r.h - a.y];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (Math.abs(pi) < 1e-12) {
      if (qi < 0) return null;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return {
    a: { x: a.x + dx * t0, y: a.y + dy * t0 },
    b: { x: a.x + dx * t1, y: a.y + dy * t1 },
  };
}

/**
 * Computes the fold for a page cell inside a spread.
 * @param grab  where the page is held (its rest position), spread coords
 * @param point where the held point is now (pointer / animation), spread coords
 * @param cell  the turning page's rect in spread coords
 * @param arena rect the fold-line segment is clipped to (spread ± one page)
 */
export function foldGeometry(
  grab: Pt,
  point: Pt,
  cell: { x: number; y: number; w: number; h: number },
  arena: { x: number; y: number; w: number; h: number },
): FoldGeometry | null {
  const dx = point.x - grab.x;
  const dy = point.y - grab.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return null;
  const nx = dx / len;
  const ny = dy / len;
  const mx = (grab.x + point.x) / 2;
  const my = (grab.y + point.y) / 2;
  const rect: Pt[] = [
    { x: cell.x, y: cell.y },
    { x: cell.x + cell.w, y: cell.y },
    { x: cell.x + cell.w, y: cell.y + cell.h },
    { x: cell.x, y: cell.y + cell.h },
  ];
  const dist = (p: Pt) => (p.x - mx) * nx + (p.y - my) * ny;
  // The far side contains the grab point: dist(grab) = -len/2 < 0.
  const near = clipHalfPlane(rect, mx, my, nx, ny, true);
  const far = clipHalfPlane(rect, mx, my, nx, ny, false);
  if (far.length < 3) return null;
  const back = far.map((p) => {
    const d = dist(p);
    return { x: p.x - 2 * d * nx, y: p.y - 2 * d * ny };
  });
  const mn = mx * nx + my * ny;
  const matrix: [number, number, number, number, number, number] = [
    1 - 2 * nx * nx,
    -2 * nx * ny,
    -2 * nx * ny,
    1 - 2 * ny * ny,
    2 * mn * nx,
    2 * mn * ny,
  ];
  const ux = -ny;
  const uy = nx;
  const L = 4 * (arena.w + arena.h);
  const seg = clipSegment(
    { x: mx - ux * L, y: my - uy * L },
    { x: mx + ux * L, y: my + uy * L },
    arena,
  );
  const foldA = seg?.a ?? { x: mx, y: my };
  const foldB = seg?.b ?? { x: mx, y: my };
  return {
    near,
    back,
    matrix,
    foldA,
    foldB,
    foldMid: { x: (foldA.x + foldB.x) / 2, y: (foldA.y + foldB.y) / 2 },
    normal: { x: nx, y: ny },
    stripAngleDeg: (Math.atan2(-ux, uy) * 180) / Math.PI,
    depth: Math.sin(Math.PI * clamp(len / (2 * Math.max(1, cell.w)), 0, 1)),
  };
}

/* ---- easing + point tweening (shared by animated and settle flips) ---- */

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export function quadBezier(p0: Pt, pc: Pt, p1: Pt, t: number): Pt {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return {
    x: a * p0.x + b * pc.x + c * p1.x,
    y: a * p0.y + b * pc.y + c * p1.y,
  };
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Tweens a point along `path(easedK)` over `durMs`, calling `onFrame`
 * per animation frame and `onDone` at the end. Returns a cancel fn.
 * The caller owns storing the point; cancelling simply stops frames.
 *
 * `preFrames` holds the first that many rAF ticks without moving: the
 * caller mounts the leaf (and the target spread under it) in the same
 * commit that starts the tween, and those frames let the browser lay
 * out and paint the fresh faces before the sheet starts moving —
 * without them the first frames of every turn pay the mount cost
 * mid-animation and the turn stutters at launch.
 */
export function tweenPoint(
  durMs: number,
  ease: (t: number) => number,
  path: (k: number) => Pt,
  onFrame: (p: Pt) => void,
  onDone: () => void,
  preFrames = 0,
  startAt = 0,
): () => void {
  let raf = 0;
  let cancelled = false;
  let warm = Math.max(0, preFrames);
  let t0 = 0;
  const step = (now: number) => {
    if (cancelled) return;
    if (warm > 0) {
      warm--;
      raf = requestAnimationFrame(step);
      return;
    }
    if (t0 === 0) t0 = now;
    // `startAt` lets a caller mount the leaf already eased that far
    // along the path (so its faces paint) and have the tween continue
    // from exactly that pose instead of snapping back to the start.
    const raw = Math.min(1, startAt + (now - t0) / Math.max(1, durMs));
    onFrame(path(ease(raw)));
    if (raw < 1) {
      raf = requestAnimationFrame(step);
    } else {
      onDone();
    }
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

/** Thời gian lật có hiệu ứng (phím/nút/chạm): góc giấy quét theo cung
 *  ~900ms, ease-out quart — giống bản web (nhanh lúc rời chồng giấy,
 *  chậm dần khi chạm xuống). Thả tay sau khi kéo thì nhanh hơn nhiều,
 *  theo quãng còn lại (170–560ms, xem dưới). */
export const FLIP_MS = 900;

export const clampNum = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Keeps the held point on the turning sheet (bản web): it may travel
 * from the grab point to just past its mirror across the spine, but
 * never back past the grab — past it the fold would invert and crease
 * on the wrong side of the paper.
 */
export function clampDragPoint(
  grab: Pt,
  mirror: Pt,
  x: number,
  y: number,
  h: number,
): Pt {
  let cx = clampNum(
    x,
    Math.min(grab.x, mirror.x) - 8,
    Math.max(grab.x, mirror.x) + 8,
  );
  if (mirror.x < grab.x) cx = Math.min(cx, grab.x + 6);
  else cx = Math.max(cx, grab.x - 6);
  return { x: cx, y: clampNum(y, -h * 0.25, h * 1.25) };
}

/** 0..1: how far the held point has travelled from `from` toward `to`
 *  along the flip axis (bản web: thả ra mà frac > 0.35 thì lật hẳn). */
export function dragFrac(from: Pt, to: Pt, point: Pt): number {
  const axisLen2 = (to.x - from.x) ** 2 + (to.y - from.y) ** 2 || 1;
  return clampNum(
    ((point.x - from.x) * (to.x - from.x) +
      (point.y - from.y) * (to.y - from.y)) /
      axisLen2,
    0,
    1,
  );
}

/** Settle duration (ms) for a drag release (bản web): theo quãng còn
 *  lại để đi — càng gần đích càng nhanh (170–560ms), không phải lúc
 *  nào cũng 900ms như bản desktop cũ. */
export function dragSettleMs(from: Pt, to: Pt, point: Pt): number {
  const dist = Math.hypot(to.x - point.x, to.y - point.y);
  return clampNum(150 + dist * 0.4, 170, 560);
}

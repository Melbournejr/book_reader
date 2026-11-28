/**
 * Cylinder-curl geometry — v0.3.11, trang giấy cuộn cong thật.
 *
 * Vấn đề gốc (video Thiện gửi 28/11, v0.3.10): `foldGeometry`
 * (src/lib/curl.ts) mô hình cú lật bằng MỘT đường gấp thẳng duy nhất
 * (nếp = đường trung trực grab→point, mặt sau = phản chiếu qua nếp).
 * Một đường gấp thẳng không bao giờ vẽ được giấy đang cuộn khi nhìn
 * gần: toàn bộ phần trang đã nhấc lên là MỘT tấm phẳng cứng (phản
 * chiếu nguyên khối), nếp là một đường sắc như dao cạo, và mặt sau bị
 * xoay nguyên khối một góc lớn (π − 2α với α là góc nếp gấp) nên hình
 * trên trang trông như bị xéo/biến dạng. Đó là trần của mô hình —
 * chỉnh easing hay cung lật bao nhiêu cũng không vượt qua được.
 * (So sánh đường kéo desktop ↔ bản web: hai đường kéo giống hệt nhau
 * về ánh xạ điểm cầm — cùng grab = chỗ tay bấm kẹp 12% khỏi gáy, cùng
 * mirror, cùng clampDragPoint, cùng ngưỡng 9px, cùng luật thả tay —
 * và cùng dùng foldGeometry; bản web chỉ "nhìn ngon hơn" vì Thiện
 * chưa bao giờ giữ lá web đứng yên giữa chừng rồi dí máy quay vào
 * nếp gấp như video này. Mô hình mới ở đây thay cho cả hai.)
 *
 * Mô hình mới: cylinder curl (mô hình cuộn trụ chuẩn mà các thư viện
 * page-flip dùng — cùng họ với Android PageCurl / StPageFlip).
 * Trang giấy là một mặt cong quấn quanh một hình trụ bán kính R:
 * - Đường tiếp tuyến (tangent line) là chỗ giấy rời khỏi chồng giấy;
 *   nó KHÔNG phải đường trung trực grab→point mà được tính từ bảo
 *   toàn độ dài cung: góc giấy đã nhấc lên có độ dài cung s_g thỏa
 *   s_g − R·sin(s_g/R) = δ (δ = quãng góc đã kéo), hoặc s_g =
 *   (δ + Rπ)/2 khi góc đã quấn quá nửa vòng (góc nằm trên mặt phẳng
 *   đã lật). Nhờ đó góc giấy (điểm cầm) hạ cánh ĐÚNG vào điểm tay
 *   (point) ở mọi tư thế — kiểm bằng test v0311.
 * - Vùng uốn là một dải cong có bán kính hữu hạn R (không phải đường
 *   gấp sắc): giấy quấn quanh trụ với góc quấn θ = s/R, tăng dần từ 0
 *   (phẳng, ở đường tiếp tuyến) tới π (lật hẳn). Vẽ bằng N dải
 *   (strip), mỗi dải là một mặt phẳng cứng xoay một góc θ_i — góc
 *   tăng dần dọc theo dải nên hình trên trang UỐN dần (gần nếp còn
 *   gần như thẳng đứng, gần mép tự do đã xoay nhiều), không còn xoay
 *   nguyên khối một góc lớn, không còn xéo.
 * - Mỗi dải là một phép quay cứng thuần túy (ma trận trực giao,
 *   định thức +1, không shear/scale) — test v0311 kiểm từng dải.
 * - Bán kính R co lại về 0 khi lật gần xong (tiến độ > 85%): giấy
 *   đáp phẳng xuống chồng giấy, tư thế cuối khớp chính xác với
 *   spread đích (không còn cú "rơi" 2R khi finishFlip đổi spread).
 *   Lúc bắt đầu R giữ nguyên (không co về 0) để góc quấn → 0 một
 *   cách liên tục theo luật bóc giấy (s_g ~ (6R²δ)^(1/3)).
 *
 * Ba vùng của trang (theo khoảng cách cung s từ đường tiếp tuyến):
 * - s < 0: còn phẳng trên chồng giấy, mặt trước (1 dải phẳng).
 * - 0 ≤ s ≤ Rπ: vùng uốn, quấn quanh trụ (N dải cong).
 * - s > Rπ: đã lật hẳn, phẳng ở độ cao 2R, mặt sau (1 dải phẳng).
 *
 * Module này thuần túy (không DOM, không React) để test số được bằng
 * Node. CurlLeaf.tsx chỉ việc lấy danh sách dải + ma trận rồi viết
 * style vào DOM từng frame (giữ nguyên cơ chế imperative update).
 */

import type { Pt } from "./curl";

const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** smoothstep(a, b, x): 0 trước a, 1 sau b, cong mượt ở giữa. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Sutherland–Hodgman: cắt đa giác theo một nửa mặt phẳng. */
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

export interface CurlStrip {
  /** Khoảng cung s của dải (độ dài cung từ đường tiếp tuyến). */
  s0: number;
  s1: number;
  /** Góc quấn ở giữa dải (radian): 0 = phẳng, π = lật hẳn. */
  theta: number;
  /** "front" | "back" | "both" — dải uốn có cả 2 mặt (trình duyệt tự
   *  chọn mặt theo góc qua backface-visibility), 2 dải phẳng chỉ 1 mặt. */
  faces: "front" | "back" | "both";
  /** Kích thước dải trong hệ tọa độ cục bộ (px): rộng = độ dài cung,
   *  cao = độ dài dọc theo đường tiếp tuyến. */
  w: number;
  h: number;
  /** Ma trận 3D (CSS matrix3d) đặt dải vào đúng vị trí/orientation. */
  matrix3d: string;
  /** Ma trận 3D dạng số (16 số, column-major) — để test áp dụng. */
  matrix: number[];
  /** Đa giác clip trong hệ tọa độ cục bộ của dải (px). */
  clip: Pt[];
  /** Ma trận 2D (CSS matrix) đặt bản sao trang vào đúng lát cắt. */
  contentMatrix: string;
  /** Ma trận 2D dạng số [a, b, c, d, e, f] — để test áp dụng. */
  content: number[];
  /** Ma trận 2D cho MẶT SAU (bản sao trang đích): khác mặt trước vì
   *  mặt sau là phía ngược của cùng tờ giấy — điểm ảnh (px, py) của
   *  mặt sau nằm ở cùng điểm vật chất với điểm ảnh (cellW − px, py)
   *  của mặt trước (soi gương ngang), và mặt sau còn xoay 180° quanh
   *  trục dọc của dải (rotateY) để ngửa về phía người xem. Hai phép
   *  soi gương này hợp lại thành ma trận dưới (xem CurlLeaf.tsx). */
  contentBackMatrix: string;
  /** Ma trận 2D mặt sau dạng số [a, b, c, d, e, f]. */
  contentBack: number[];
  /** Tâm dải trong hệ tọa độ spread (để test + bóng đổ). */
  center: Pt;
  /** Độ cao z của tâm dải (px) — để test + bóng đổ. */
  z: number;
}

export interface CurlGeometry {
  strips: CurlStrip[];
  /** Bán kính trụ hiện tại (px). */
  radius: number;
  /** Điểm F trên đường tiếp tuyến (tọa độ spread). */
  tangent: Pt;
  /** Hướng đơn vị dọc đường tiếp tuyến (u). */
  tangentDir: Pt;
  /** Hướng kéo (pull, từ grab tới point) và hướng ngược (out). */
  pull: Pt;
  out: Pt;
  /** Tiến độ lật 0..1 (δ / δ_max). */
  progress: number;
  /** 0..1: độ mạnh của uốn để shading (0 ở 2 đầu, 1 giữa chừng). */
  depth: number;
  /** Đa giác bóng đổ (hình chiếu của phần đã nhấc lên, tọa độ spread). */
  shadowPoly: Pt[];
  /** Độ lệch của bóng đổ (px, tọa độ spread): bóng rơi lệch về phía
   *  mép tự do (out) + hơi xuống dưới — giống bóng đổ mềm của giấy
   *  nhấc lên khỏi mặt bàn. */
  shadowOffset: Pt;
  /** Độ đậm của bóng đổ 0..1 (đậm dần giữa chừng, theo depth). */
  shadowOpacity: number;
  /** Điểm trên đường gờ sáng (đỉnh sóng uốn, s = Rπ/2) + hướng u. */
  crest: Pt;
  crestDir: Pt;
  /** Khoảng cung s của trang (để lá quyết định gờ/bóng có nằm trên
   *  trang không) + độ dài cung tới góc giấy. */
  sMin: number;
  sMax: number;
  sG: number;
}

export interface CurlOptions {
  /** Bán kính trụ mong muốn (px). Mặc định theo chiều rộng trang. */
  radius?: number;
  /** Số dải trong vùng uốn. Mặc định 12 (mỗi dải quấn 15°). */
  strips?: number;
}

export const CURL_STRIP_COUNT = 12;
/** Góc quấn tối đa của vùng uốn (nửa vòng). Vượt quá thì giấy đã lật
 *  hẳn và nằm phẳng ở mặt sau. */
export const CURL_MAX_WRAP = Math.PI;
/** Tiến độ bắt đầu co bán kính để giấy đáp phẳng (85% → 100%). */
export const CURL_RELAX_FROM = 0.85;

/**
 * Bán kính trụ theo tiến độ lật: giữ nguyên trong phần lớn cú lật,
 * co mượt về 0 ở 15% cuối để giấy đáp phẳng, khớp spread đích.
 * (Không co về 0 ở đầu lật: góc quấn lúc đó → 0 theo luật bóc giấy,
 * không có điểm kỳ dị.)
 */
export function curlRadiusAt(
  radiusPreferred: number,
  progress: number,
): number {
  return radiusPreferred * (1 - smoothstep(CURL_RELAX_FROM, 1, progress));
}

/**
 * Độ dài cung s_g từ đường tiếp tuyến tới góc giấy, từ quãng kéo δ.
 * - δ ≤ Rπ: giải s − R·sin(s/R) = δ (bảo toàn độ dài cung; hàm đơn
 *   điệu tăng nên bisection hội tụ — luật bóc giấy: s ~ (6R²δ)^(1/3)
 *   khi δ nhỏ, đường tiếp tuyến rời góc nhanh nhưng liên tục).
 * - δ > Rπ: góc đã quấn quá nửa vòng, nằm trên mặt phẳng đã lật:
 *   s_g = (δ + Rπ)/2 (tuyến tính, không cần giải).
 */
export function curlArcLength(delta: number, radius: number): number {
  if (radius < 0.5 || delta > radius * Math.PI) {
    return (delta + radius * Math.PI) / 2;
  }
  const f = (s: number) => s - radius * Math.sin(s / radius);
  let lo = 0;
  let hi = delta + radius;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < delta) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const fmt = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : `${r}`;
};

/**
 * Vị trí thế giới của một điểm vật chất (s, t) trên giấy đã cuộn:
 * s = độ dài cung từ đường tiếp tuyến (dọc out), t = dọc u, gốc ở
 * đường tiếp tuyến F. Ba vùng: phẳng (s ≤ 0), uốn quanh trụ
 * (0 < s < Rπ), đã lật hẳn (s ≥ Rπ, phẳng ở độ cao 2R).
 * Dùng chung cho curlGeometry và cho test (kiểm góc hạ cánh).
 */
export function curlPlacePoint(
  tangent: Pt,
  out: Pt,
  u: Pt,
  radius: number,
  s: number,
  t: number,
): { c: Pt; z: number; T: [number, number, number]; N: [number, number, number] } {
  if (s <= 0) {
    return {
      c: { x: tangent.x + s * out.x + t * u.x, y: tangent.y + s * out.y + t * u.y },
      z: 0,
      T: [out.x, out.y, 0],
      N: [0, 0, 1],
    };
  }
  const wrap = radius * CURL_MAX_WRAP;
  if (s >= wrap) {
    const d = s - wrap;
    return {
      c: {
        x: tangent.x - d * out.x + t * u.x,
        y: tangent.y - d * out.y + t * u.y,
      },
      z: 2 * radius,
      T: [-out.x, -out.y, 0],
      N: [0, 0, -1],
    };
  }
  const th = s / radius;
  const sin = Math.sin(th);
  const cos = Math.cos(th);
  return {
    c: {
      x: tangent.x + radius * sin * out.x + t * u.x,
      y: tangent.y + radius * sin * out.y + t * u.y,
    },
    z: radius * (1 - cos),
    T: [cos * out.x, cos * out.y, sin],
    N: [-sin * out.x, -sin * out.y, cos],
  };
}

/**
 * Áp ma trận 3D của một dải lên một điểm cục bộ (x, y) của dải (gốc
 * ở góc trên-trái của dải, transform-origin ở tâm) -> tọa độ spread
 * (x, y, z). Chỉ dùng cho test (kiểm góc giấy hạ cánh đúng point,
 * hình vuông không bị xéo...).
 */
export function applyStripMatrix(
  strip: CurlStrip,
  x: number,
  y: number,
): [number, number, number] {
  const m = strip.matrix;
  const dx = x - strip.w / 2;
  const dy = y - strip.h / 2;
  return [
    strip.w / 2 + m[0]! * dx + m[4]! * dy + m[12]!,
    strip.h / 2 + m[1]! * dx + m[5]! * dy + m[13]!,
    m[2]! * dx + m[6]! * dy + m[14]!,
  ];
}

/**
 * Hình học cuộn trụ cho một tư thế (grab, point).
 * @param grab  điểm nắm lúc nghỉ (góc trang), tọa độ spread
 * @param point điểm cầm hiện tại (tay/chuột/tween), tọa độ spread
 * @param cell  hình chữ nhật của trang đang lật, tọa độ spread
 * @param mirror điểm đáp (góc phản chiếu qua gáy); null thì ước lượng
 *   quãng lật tối đa = 2 × chiều rộng trang
 * @param opts  bán kính trụ / số dải
 * @returns null khi tư thế suy biến (grab ≈ point, như foldGeometry)
 */
export function curlGeometry(
  grab: Pt,
  point: Pt,
  cell: { x: number; y: number; w: number; h: number },
  mirror: Pt | null,
  opts: CurlOptions = {},
): CurlGeometry | null {
  const dx = point.x - grab.x;
  const dy = point.y - grab.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return null;
  const pull: Pt = { x: dx / len, y: dy / len };
  const out: Pt = { x: -pull.x, y: -pull.y };
  // u: vuông góc với pull, chọn chiều sao cho (out, u) thuận chiều
  // với hệ tọa độ màn hình (out × u = +z, để ma trận dải là phép quay
  // thuần túy, định thức +1 — không mirror, không shear).
  const u: Pt = { x: -out.y, y: out.x };

  const delta = len;
  const deltaMax = mirror
    ? Math.hypot(mirror.x - grab.x, mirror.y - grab.y)
    : 2 * cell.w;
  const progress = clamp(delta / Math.max(1, deltaMax), 0, 1);
  const radiusPreferred =
    opts.radius ?? clamp(cell.w * 0.12, 32, 64);
  const radius = curlRadiusAt(radiusPreferred, progress);
  const stripCount = Math.max(4, opts.strips ?? CURL_STRIP_COUNT);

  // Độ dài cung từ đường tiếp tuyến tới góc giấy.
  const sG = curlArcLength(delta, radius);
  // Đường tiếp tuyến đi qua F, hướng u. F ở phía gáy so với grab
  // một đoạn s_g dọc theo pull (giấy đã bóc khỏi chồng giấy).
  const F: Pt = { x: grab.x - sG * out.x, y: grab.y - sG * out.y };

  // Đa giác trang trong hệ (s, t): s = khoảng cách cung từ đường
  // tiếp tuyến dọc out, t = dọc u. Gốc ở F.
  const corners: Pt[] = [
    { x: cell.x, y: cell.y },
    { x: cell.x + cell.w, y: cell.y },
    { x: cell.x + cell.w, y: cell.y + cell.h },
    { x: cell.x, y: cell.y + cell.h },
  ];
  const toST = (p: Pt): Pt => ({
    x: (p.x - F.x) * out.x + (p.y - F.y) * out.y,
    y: (p.x - F.x) * u.x + (p.y - F.y) * u.y,
  });
  const cornersST = corners.map(toST);
  const sMin = Math.min(...cornersST.map((p) => p.x));
  const sMax = Math.max(...cornersST.map((p) => p.x));
  const tMin = Math.min(...cornersST.map((p) => p.y));
  const tMax = Math.max(...cornersST.map((p) => p.y));
  const tC = (tMin + tMax) / 2;
  const stripH = Math.max(1, tMax - tMin);

  // Bản sao trang: góc trên-trái của cell trong hệ (s, t).
  const pageOriginST = toST({ x: cell.x, y: cell.y });

  const wrap = radius * CURL_MAX_WRAP;

  // Vị trí + hướng của một điểm vật chất (s, t) trên giấy đã cuộn
  // (xem curlPlacePoint ở trên).
  const place = (
    s: number,
    t: number,
  ): {
    c: Pt;
    z: number;
    T: [number, number, number];
    N: [number, number, number];
  } => curlPlacePoint(F, out, u, radius, s, t);

  const strips: CurlStrip[] = [];

  // Một dải vật chất s ∈ [a, b]: tâm s_c, góc θ_c, ma trận 3D, clip,
  // ma trận nội dung. `faces` quyết định dải vẽ mặt nào.
  const makeStrip = (
    a: number,
    b: number,
    theta: number,
    faces: CurlStrip["faces"],
  ) => {
    const w = Math.max(0.5, b - a);
    const sC = (a + b) / 2;
    const p = place(sC, tC);
    const [Tx, Ty, Tz] = p.T;
    const [Nx, Ny, Nz] = p.N;
    // Ma trận 3D (column-major): cột 1 = T, cột 2 = u, cột 3 = N,
    // cột 4 = tịnh tiến sao cho tâm dải (w/2, h/2) rơi vào C.
    const tx = p.c.x - w / 2;
    const ty = p.c.y - stripH / 2;
    const tz = p.z;
    const matrix = [
      Tx, Ty, Tz, 0,
      u.x, u.y, 0, 0,
      Nx, Ny, Nz, 0,
      tx, ty, tz, 1,
    ];
    const matrix3d =
      `matrix3d(${matrix.map(fmt).join(", ")})`;
    // Clip: đa giác trang (hệ s,t) cắt theo dải [a, b], đổi sang hệ
    // cục bộ của dải (x = s − a, y = t − tMin).
    let poly = cornersST;
    poly = clipHalfPlane(poly, a, 0, 1, 0, true);
    poly = clipHalfPlane(poly, b, 0, 1, 0, false);
    const clip = poly.map((pt) => ({ x: pt.x - a, y: pt.y - tMin }));
    // Ma trận nội dung: bản sao trang (góc trên-trái tại pageOriginST)
    // đặt vào hệ cục bộ của dải. Ánh xạ (px, py) -> (s, t):
    //   s = s0page + px·out.x + py·out.y
    //   t = t0page + px·u.x + py·u.y
    // rồi đổi sang hệ cục bộ (x = s − a, y = t − tMin).
    const content = [
      out.x, u.x, out.y, u.y,
      pageOriginST.x - a, pageOriginST.y - tMin,
    ];
    const contentMatrix = `matrix(${content.map(fmt).join(", ")})`;
    // Ma trận nội dung MẶT SAU: điểm ảnh (px, py) của mặt sau nằm ở
    // cùng điểm vật chất với điểm ảnh (cellW − px, py) của mặt trước
    // (soi gương ngang qua tờ giấy), và mặt sau còn xoay 180° quanh
    // trục dọc dải (rotateY) nên x của nó bị lật thành (w − x) — hai
    // phép lật hợp lại thành ma trận này (xem CurlLeaf.tsx).
    const contentBack = [
      out.x, -u.x, -out.y, u.y,
      w - pageOriginST.x + a - cell.w * out.x,
      pageOriginST.y - tMin + cell.w * u.x,
    ];
    const contentBackMatrix = `matrix(${contentBack.map(fmt).join(", ")})`;
    strips.push({
      s0: a,
      s1: b,
      theta,
      faces,
      w,
      h: stripH,
      matrix3d,
      matrix,
      clip,
      contentMatrix,
      content,
      contentBackMatrix,
      contentBack,
      center: p.c,
      z: p.z,
    });
  };

  // 1 · phần còn phẳng (s < 0): 1 dải phẳng, chỉ mặt trước.
  if (sMin < -0.5) {
    makeStrip(sMin, 0, 0, "front");
  }
  // 2 · vùng uốn (0 ≤ s ≤ Rπ): N dải, mỗi dải quấn π/N, cả 2 mặt.
  // Chỉ tạo dải tới hết vật chất của trang (sMax) — dải vượt quá
  // trang có clip rỗng, chỉ tốn DOM. Số dải chọn theo GÓC (mỗi dải
  // quấn tối đa π/N) chứ không theo độ dài — dải ngắn vẫn mịn, không
  // có bước góc lớn khi vùng uốn mới hình thành.
  if (radius > 0.5 && wrap > 1) {
    const curlEnd = Math.min(wrap, sMax);
    const n = Math.max(
      1,
      Math.ceil((curlEnd / radius / Math.PI) * stripCount),
    );
    for (let i = 0; i < n; i++) {
      const a = (i * curlEnd) / n;
      const b = ((i + 1) * curlEnd) / n;
      makeStrip(a, b, (a + b) / 2 / radius, "both");
    }
  }
  // 3 · phần đã lật hẳn (s > Rπ): 1 dải phẳng ở độ cao 2R, mặt sau.
  if (sMax > wrap + 0.5) {
    makeStrip(wrap, sMax, Math.PI, "back");
  }
  // Trường hợp suy biến (R ≈ 0, giấy đáp phẳng): không có dải uốn,
  // chỉ còn 2 dải phẳng — vẫn đủ vẽ đúng tư thế cuối.
  if (strips.length === 0) {
    makeStrip(sMin, sMax, delta > 0 ? Math.PI : 0, delta > 0 ? "back" : "front");
  }

  // Bóng đổ: hình chiếu (bỏ z) của phần đã nhấc lên (s > 0).
  const projectFlat = (s: number, t: number): Pt => {
    if (s <= 0) return { x: F.x + s * out.x + t * u.x, y: F.y + s * out.y + t * u.y };
    if (s >= wrap) {
      const d = s - wrap;
      return { x: F.x - d * out.x + t * u.x, y: F.y - d * out.y + t * u.y };
    }
    const th = s / radius;
    return {
      x: F.x + radius * Math.sin(th) * out.x + t * u.x,
      y: F.y + radius * Math.sin(th) * out.y + t * u.y,
    };
  };
  let lifted = cornersST.filter((p) => p.x > 0);
  // Thêm giao điểm của các cạnh trang với đường tiếp tuyến (s = 0)
  // để đa giác bóng kín đúng hình.
  const edgeHits: Pt[] = [];
  for (let i = 0; i < cornersST.length; i++) {
    const a = cornersST[i]!;
    const b = cornersST[(i + 1) % cornersST.length]!;
    if ((a.x > 0) !== (b.x > 0)) {
      const t = a.x / (a.x - b.x);
      edgeHits.push({ x: 0, y: a.y + (b.y - a.y) * t });
    }
  }
  lifted = [...lifted, ...edgeHits];
  const shadowPoly =
    lifted.length >= 3
      ? lifted.map((p) => projectFlat(p.x, p.y))
      : [F, { x: F.x + u.x * 10, y: F.y + u.y * 10 }];

  // Đường gờ sáng: đường s = Rπ/2 (θ = 90°, vai của sóng uốn).
  const crestS = wrap / 2;
  const crestPlace = place(crestS, tC);
  const depth = Math.sin(Math.PI * clamp(progress, 0, 1));

  return {
    strips,
    radius,
    tangent: F,
    tangentDir: u,
    pull,
    out,
    progress,
    depth,
    shadowPoly,
    // Bóng rơi lệch về phía mép tự do + hơi xuống dưới; đậm dần
    // giữa chừng (cùng công thức với bản gấp thẳng cũ).
    shadowOffset: { x: out.x * 10, y: out.y * 10 + 6 },
    shadowOpacity: 0.16 + 0.4 * depth,
    crest: crestPlace.c,
    crestDir: u,
    sMin,
    sMax,
    sG,
  };
}

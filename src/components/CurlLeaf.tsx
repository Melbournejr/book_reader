import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { foldGeometry, type FoldGeometry, type Pt } from "../lib/curl";

/**
 * Lá lật cong thật — port trực tiếp từ bản web phan-mem-doc-sach
 * (client/src/CurlLeaf.tsx), bản demo mà Thiện từng khen.
 *
 * Bản desktop trước đây (tới v0.3.6) chỉ là một tấm phẳng rotateY
 * quanh gáy: cứng như bìa, không cong, nếp gấp + bóng đổ là 2 dải mờ
 * tĩnh dán ở mép lá — đó là lý do hiệu ứng lật "cực kém" dù thời gian
 * (900ms) và easing giống hệt bản web. Component này vẽ 1 trang đang
 * lật thành nếp gấp cong thật (reflection fold): xem src/lib/curl.ts.
 *
 * Imperative handle: trong lúc lật, reader gọi `update(point)` mỗi
 * animation frame thay vì đẩy point qua React state — update qua state
 * mỗi khung hình sẽ render lại cả reader (chữ/ảnh tính lại layout)
 * làm lật bị giật, nhất là lật bằng phím. `update` chỉ viết lại style
 * (clip-path, transform, opacity) trên chính các node của lá.
 */
export interface CurlLeafHandle {
  update: (point: Pt) => void;
}

interface CurlLeafProps {
  /** Spread width in px (the coordinate space grab/point live in). */
  width: number;
  /** Page height in px. */
  height: number;
  /** Left edge of the turning page's cell, in spread coords. */
  cellX: number;
  /** Page width in px. */
  cellW: number;
  grab: Pt;
  point: Pt;
  front: ReactNode;
  back: ReactNode;
  /** Face background, painted under the content inside each face. */
  frontBg?: string;
  backBg?: string;
  /** Dark-room variant (comic reader): softer white ridge, deeper shade. */
  dark?: boolean;
}

/**
 * Renders one turning page as a true curl (reflection fold), given the
 * grab point and the current held-point position. The readers own the
 * flip state; React renders the leaf once per flip with the launch
 * point, and the animation then drives it through the ref handle.
 *
 * Layers, back to front:
 * 1. a soft blurred shadow in the shape of the folded-over part, offset
 *    away from the fold — the shadow the lifted paper casts on the page
 *    revealed underneath; it deepens as the curl grows;
 * 2. a dark gradient strip hugging the fold on the revealed page;
 * 3. the front face: page content clipped to the not-yet-folded region,
 *    with a bend shade that darkens toward the crease;
 * 4. the back face: page content reflected across the fold line,
 *    clipped to the reflected polygon, shaded like the underside of a
 *    bending sheet;
 * 5. a specular ridge: a bright highlight strip centred on the fold
 *    line — the sheen along the crease that sells the paper.
 */
export const CurlLeaf = forwardRef<CurlLeafHandle, CurlLeafProps>(
  function CurlLeaf(
    { width, height, cellX, cellW, grab, point, front, back, frontBg, backBg, dark = false },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const shadowOuterRef = useRef<HTMLDivElement | null>(null);
    const shadowInnerRef = useRef<HTMLDivElement | null>(null);
    const foldShadowRef = useRef<HTMLDivElement | null>(null);
    const frontClipRef = useRef<HTMLDivElement | null>(null);
    const frontShadeRef = useRef<HTMLDivElement | null>(null);
    const backClipRef = useRef<HTMLDivElement | null>(null);
    const backInnerRef = useRef<HTMLDivElement | null>(null);
    const backShadeRef = useRef<HTMLDivElement | null>(null);
    const ridgeRef = useRef<HTMLDivElement | null>(null);

    const cell = { x: cellX, y: 0, w: cellW, h: height };
    const arena = { x: cellX - cellW, y: 0, w: cellW * 3, h: height };

    /**
     * The last point actually painted. A parent re-render mid-flip
     * (fullscreen chrome auto-hiding, a progress save landing) re-runs
     * this component with the stale launch point in props; the layout
     * effect below re-applies `live` after every render so the sheet
     * never snaps back to the launch pose.
     */
    const liveRef = useRef<{ grab: Pt; point: Pt }>({ grab, point });
    if (liveRef.current.grab !== grab) {
      liveRef.current = { grab, point };
    }

    const poly = (pts: Pt[]) =>
      `polygon(${pts.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(", ")})`;

    /** Writes one fold-following strip's dynamic style for `geo`. */
    const setStrip = (
      elRef: RefObject<HTMLDivElement | null>,
      geo: FoldGeometry,
      offsetN: number,
      opacity: number,
    ) => {
      const el = elRef.current;
      if (!el) return;
      const segLen =
        Math.hypot(geo.foldB.x - geo.foldA.x, geo.foldB.y - geo.foldA.y) + 6;
      el.style.left = `${(geo.foldMid.x + geo.normal.x * offsetN).toFixed(1)}px`;
      el.style.top = `${(geo.foldMid.y + geo.normal.y * offsetN).toFixed(1)}px`;
      el.style.height = `${segLen.toFixed(1)}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${geo.stripAngleDeg}deg)`;
      el.style.opacity = `${opacity}`;
    };

    /** Paints the fold for the held point `p` — styles only, no React. */
    const applyPoint = (p: Pt) => {
      const root = rootRef.current;
      if (!root) return;
      const geo = foldGeometry(liveRef.current.grab, p, cell, arena);
      if (!geo) {
        root.style.visibility = "hidden";
        return;
      }
      root.style.visibility = "visible";
      const d = geo.depth;
      if (shadowOuterRef.current) {
        shadowOuterRef.current.style.opacity = `${0.16 + 0.4 * d}`;
      }
      if (shadowInnerRef.current) {
        shadowInnerRef.current.style.clipPath = poly(geo.back);
        shadowInnerRef.current.style.transform =
          `translate(${(-geo.normal.x * 13).toFixed(1)}px, ${(-geo.normal.y * 13 + 6).toFixed(1)}px)`;
      }
      setStrip(foldShadowRef, geo, -34, 0.35 + 0.65 * d);
      if (frontClipRef.current) {
        frontClipRef.current.style.display = geo.near.length >= 3 ? "" : "none";
        frontClipRef.current.style.clipPath = poly(geo.near);
      }
      setStrip(frontShadeRef, geo, 0, 0.4 + 0.6 * d);
      if (backClipRef.current) {
        backClipRef.current.style.clipPath = poly(geo.back);
      }
      if (backInnerRef.current) {
        const [a, b, c, dd, e, f] = geo.matrix;
        backInnerRef.current.style.transform =
          `matrix(${a}, ${b}, ${c}, ${dd}, ${e}, ${f})`;
      }
      setStrip(backShadeRef, geo, 0, 0.4 + 0.6 * d);
      setStrip(ridgeRef, geo, 0, 0.3 + 0.7 * d);
    };

    useImperativeHandle(ref, () => ({
      update: (p: Pt) => {
        liveRef.current = { grab: liveRef.current.grab, point: p };
        applyPoint(p);
      },
    }));

    useLayoutEffect(() => {
      applyPoint(liveRef.current.point);
    });

    const geo = foldGeometry(grab, point, cell, arena);
    if (!geo) return null;
    const shadeRgb = dark ? "0, 0, 0" : "62, 38, 12";
    const layer: CSSProperties = {
      position: "absolute",
      left: 0,
      top: 0,
      width,
      height,
      pointerEvents: "none",
    };
    /** Initial style for one fold strip; `applyPoint` rewrites it per frame. */
    const stripInit = (
      stripW: number,
      background: string,
      offsetN: number,
      z: number,
      opacity: number,
    ): CSSProperties => {
      const segLen =
        Math.hypot(geo.foldB.x - geo.foldA.x, geo.foldB.y - geo.foldA.y) + 6;
      return {
        position: "absolute",
        left: geo.foldMid.x + geo.normal.x * offsetN,
        top: geo.foldMid.y + geo.normal.y * offsetN,
        width: stripW,
        height: segLen,
        transform: `translate(-50%, -50%) rotate(${geo.stripAngleDeg}deg)`,
        background,
        opacity,
        pointerEvents: "none",
        zIndex: z,
        willChange: "transform",
      };
    };
    const [a, b, c, d, e, f] = geo.matrix;
    return (
      <div ref={rootRef} style={{ ...layer, zIndex: 30 }}>
        {/* 1 · cast shadow of the lifted part, on the page underneath */}
        <div
          ref={shadowOuterRef}
          aria-hidden
          style={{
            ...layer,
            filter: "blur(13px)",
            opacity: 0.16 + 0.4 * geo.depth,
          }}
        >
          <div
            ref={shadowInnerRef}
            style={{
              ...layer,
              clipPath: poly(geo.back),
              background: dark ? "#000" : "#241304",
              transform: `translate(${(-geo.normal.x * 13).toFixed(1)}px, ${(-geo.normal.y * 13 + 6).toFixed(1)}px)`,
            }}
          />
        </div>
        {/* 2 · fold shadow on the revealed page, just past the crease */}
        <div
          ref={foldShadowRef}
          aria-hidden
          style={stripInit(
            88,
            `linear-gradient(to right, rgba(${shadeRgb}, 0) 4%, rgba(${shadeRgb}, 0.30) 86%, rgba(${shadeRgb}, 0.34) 100%)`,
            -34,
            1,
            0.35 + 0.65 * geo.depth,
          )}
        />
        {/* 3 · front face, clipped to the region still lying flat */}
        {geo.near.length >= 3 && (
          <div
            ref={frontClipRef}
            style={{ ...layer, clipPath: poly(geo.near), zIndex: 2 }}
          >
            <div
              style={{
                position: "absolute",
                left: cellX,
                top: 0,
                width: cellW,
                height,
                background: frontBg,
              }}
            >
              {front}
            </div>
            <div
              ref={frontShadeRef}
              aria-hidden
              style={stripInit(
                132,
                `linear-gradient(to right, rgba(${shadeRgb}, 0) 6%, rgba(${shadeRgb}, 0.27) 50%, rgba(${shadeRgb}, 0.08) 60%, rgba(${shadeRgb}, 0) 74%)`,
                0,
                3,
                0.4 + 0.6 * geo.depth,
              )}
            />
          </div>
        )}
        {/* 4 · back face: the folded part, reflected across the crease */}
        <div
          ref={backClipRef}
          style={{ ...layer, clipPath: poly(geo.back), zIndex: 4 }}
        >
          <div
            ref={backInnerRef}
            style={{
              position: "absolute",
              left: cellX,
              top: 0,
              width: cellW,
              height,
              background: backBg,
              transform: `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`,
              transformOrigin: `${-cellX}px 0px`,
            }}
          >
            {/*
              The back content is the page printed on the reverse of this
              sheet — the page that lands flat on the other side when the
              turn completes. The fold reflection above is orientation-
              reversing, so content drawn into the cell un-mirrored reads
              mirrored for the whole turn and only snaps right when the
              base spread swaps in at the end. Pre-mirroring the content
              horizontally inside the cell composes with the fold
              reflection to a pure rotation of the sheet: the back page
              reads correctly at every pose, and at the landing pose it
              matches the base spread exactly (no snap).
            */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: cellW,
                height,
                transform: "scaleX(-1)",
                transformOrigin: "50% 50%",
              }}
            >
              {back}
            </div>
          </div>
          <div
            ref={backShadeRef}
            aria-hidden
            style={stripInit(
              150,
              `linear-gradient(to right, rgba(${shadeRgb}, 0.20) 2%, rgba(${shadeRgb}, 0.04) 30%, rgba(255, 250, 238, 0.20) 47%, rgba(255, 250, 238, 0.04) 54%, rgba(${shadeRgb}, 0) 66%)`,
              0,
              5,
              0.4 + 0.6 * geo.depth,
            )}
          />
        </div>
        {/* 5 · specular ridge along the crease */}
        <div
          ref={ridgeRef}
          aria-hidden
          style={stripInit(
            46,
            dark
              ? "linear-gradient(to right, rgba(255,255,255,0) 10%, rgba(255,255,255,0.05) 32%, rgba(255,255,255,0.34) 50%, rgba(0,0,0,0.28) 62%, rgba(0,0,0,0) 86%)"
              : "linear-gradient(to right, rgba(255,255,255,0) 10%, rgba(255,255,255,0.07) 32%, rgba(255,255,255,0.48) 50%, rgba(96, 62, 24, 0.20) 61%, rgba(96, 62, 24, 0) 86%)",
            0,
            6,
            0.3 + 0.7 * geo.depth,
          )}
        />
      </div>
    );
  },
);

/**
 * CurlLeaf — lá trang đang lật, mô hình CUỘN TRỤ (cylinder curl).
 *
 * v0.3.11: thay mô hình gấp thẳng cũ (foldGeometry: một đường gấp
 * thẳng duy nhất, mặt sau phản xạ qua nếp — nhìn gần như tấm bìa
 * cứng gập, nếp sắc, mặt sau xéo) bằng mô hình cuộn trụ thật:
 *
 *   - Trang quấn quanh một hình trụ bán kính R lăn ngang trang.
 *     Vùng uốn là một dải cong có bán kính hữu hạn (Rπ), không phải
 *     đường gấp sắc: dải cong chia thành N lát (strip), mỗi lát là
 *     một mặt phẳng cứng xoay một góc nhỏ (≤ 15°) — góc uốn tăng
 *     dần dọc dải, không có bước nhảy góc nào lớn.
 *   - Mỗi lát là một phép QUAY cứng (ma trận 3D trực giao, định
 *     thức +1): không shear, không xéo — một hình vuông trên mặt
 *     sau vẫn là hình vuông sau khi lật.
 *   - Góc giấy bám đúng điểm tay nhờ luật bóc (arc-length): điểm
 *     tiếp tuyến F tính từ độ dài cung, không phải đường trung trực.
 *   - Bán kính R thu nhỏ mượt về 0 ở 15% cuối cú lật để trang đáp
 *     phẳng đúng vị trí, không bị "rơi" 2R.
 *
 * Hình học sống trong src/lib/curlGeometry.ts (curlGeometry); file
 * này chỉ là lớp render: N lát div (mỗi lát có 2 mặt, trước/sau),
 * bóng đổ, vệt bóng nếp gấp, vệt sáng gờ cuộn. Mọi style đổi theo
 * khung hình được ghi thẳng vào DOM qua imperative handle (không
 * re-render React giữa cú lật) — giữ nguyên cơ chế từ v0.3.7.
 *
 * Props giữ nguyên như cũ + thêm `mirror` (điểm đáp) để tính tiến
 * độ / bán kính; thiếu mirror thì ước lượng quãng lật = 2 × cellW.
 */

import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { Pt } from "../lib/curl";
import { ensureFoldPoint } from "../lib/curl";
import {
  curlGeometry,
  CURL_STRIP_COUNT,
} from "../lib/curlGeometry";

export interface CurlLeafHandle {
  update: (point: Pt) => void;
}

export interface CurlLeafProps {
  width: number; // chiều rộng spread (px)
  height: number; // chiều cao spread (px)
  cellX: number; // x của trang đang lật trong spread
  cellW: number; // chiều rộng trang đang lật
  grab: Pt; // điểm nắm lúc nghỉ (góc trang)
  point: Pt; // điểm cầm lúc mount (điểm bắt đầu tween / tay)
  mirror?: Pt; // điểm đáp (phản chiếu grab qua gáy)
  front: React.ReactNode;
  back: React.ReactNode;
  frontBg: string;
  backBg: string;
  dark?: boolean;
}

/** Số lát tối đa: 1 phẳng + 12 uốn + 1 đã lật = 14. */
export const CURL_LEAF_MAX_STRIPS = CURL_STRIP_COUNT + 2;

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "0");

export const CurlLeaf = forwardRef<CurlLeafHandle, CurlLeafProps>(
  function CurlLeaf(
    {
      width,
      height,
      cellX,
      cellW,
      grab,
      point,
      mirror,
      front,
      back,
      frontBg,
      backBg,
      dark = false,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const stripRefs = useRef<Array<HTMLDivElement | null>>([]);
    const frontFaceRefs = useRef<Array<HTMLDivElement | null>>([]);
    const backFaceRefs = useRef<Array<HTMLDivElement | null>>([]);
    const frontContentRefs = useRef<Array<HTMLDivElement | null>>([]);
    const backContentRefs = useRef<Array<HTMLDivElement | null>>([]);
    const shadowRef = useRef<HTMLDivElement | null>(null);
    const foldShadowRef = useRef<HTMLDivElement | null>(null);
    const ridgeRef = useRef<HTMLDivElement | null>(null);
    const liveRef = useRef({ grab, point });

    const cell = { x: cellX, y: 0, w: cellW, h: height };
    const arena = { x: cellX - cellW, y: 0, w: cellW * 3, h: height };

    /**
     * Điểm giữ lúc mount / lần render lại giữa cú lật. Một lần
     * re-render giữa chừng (chrome full màn tự ẩn/hiện, progress
     * save) chạy lại component với điểm mount cũ trong props; giữ
     * điểm đã vẽ (live) để không bật về tư thế ban đầu — giữ cơ chế
     * từ bản gấp thẳng cũ.
     */
    if (liveRef.current.grab !== grab) {
      liveRef.current = { grab, point };
    }

    /** Viết toàn bộ tư thế (grab, point) vào DOM. */
    const applyPoint = (p: Pt) => {
      const root = rootRef.current;
      if (!root) return;
      const pt = ensureFoldPoint(liveRef.current.grab, p, cell, arena);
      const geo = curlGeometry(liveRef.current.grab, pt, cell, mirror ?? null);
      if (!geo) return;
      root.style.display = "";
      // --- các lát ---
      for (let i = 0; i < CURL_LEAF_MAX_STRIPS; i++) {
        const el = stripRefs.current[i];
        if (!el) continue;
        const strip = geo.strips[i];
        if (!strip) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.width = `${strip.w}px`;
        el.style.height = `${strip.h}px`;
        el.style.transform = strip.matrix3d;
        // v0.3.13: KHÔNG đặt clip-path lên lát hay mặt — clip-path
        // (grouping property) ép transform-style thành flat, phá vỡ
        // backface-visibility: mặt sau không bao giờ hiện, mặt trước
        // hiện NGƯỢC khi lát quay quá 90°. Đã thử dời clip từ lát
        // xuống 2 mặt (bundle đã kiểm đúng) — ảnh chụp vẫn
        // pixel-identical với bản lỗi, tức clip ở mặt cũng phá.
        // Chỉ còn overflow:hidden của mặt cắt nội dung theo hộp
        // lát; đa giác cắt bỏ hẳn (đã kiểm bằng mắt ở kéo giữ
        // 60%/40%: không thấy tam giác thừa lộ).
        const clip = "none";
        const frontFace = frontFaceRefs.current[i];
        const backFace = backFaceRefs.current[i];
        const frontContent = frontContentRefs.current[i];
        const backContent = backContentRefs.current[i];
        if (frontFace) {
          frontFace.style.clipPath = clip;
          frontFace.style.display = strip.faces === "back" ? "none" : "";
        }
        if (backFace) {
          backFace.style.clipPath = clip;
          backFace.style.display = strip.faces === "front" ? "none" : "";
        }
        if (frontContent) {
          frontContent.style.transform = strip.contentMatrix;
        }
        if (backContent) {
          backContent.style.transform = strip.contentBackMatrix;
        }
      }
      // --- bóng đổ của phần đã nhấc lên (trên trang gốc) ---
      const shadow = shadowRef.current;
      if (shadow) {
        shadow.style.clipPath =
          geo.shadowPoly.length >= 3
            ? `polygon(${geo.shadowPoly
                .map((pt) => `${fmt(pt.x)}px ${fmt(pt.y)}px`)
                .join(", ")})`
            : "none";
        shadow.style.transform = `translate(${fmt(
          geo.shadowOffset.x,
        )}px, ${fmt(geo.shadowOffset.y)}px)`;
        shadow.style.opacity = String(geo.shadowOpacity);
      }
      // --- vệt bóng nếp gấp: dải dọc đường tiếp tuyến ---
      const stripH = geo.strips[0]?.h ?? height;
      const foldShadow = foldShadowRef.current;
      if (foldShadow) {
        const R = geo.radius;
        if (R > 1) {
          const { x: Fx, y: Fy } = geo.tangent;
          const { x: ux, y: uy } = geo.tangentDir;
          const { x: ox, y: oy } = geo.out;
          foldShadow.style.display = "";
          foldShadow.style.width = `${stripH}px`;
          foldShadow.style.height = `${2 * R}px`;
          foldShadow.style.transform = `matrix(${fmt(ux)}, ${fmt(
            uy,
          )}, ${fmt(ox)}, ${fmt(oy)}, ${fmt(
            Fx - (stripH / 2) * ux - R * ox,
          )}, ${fmt(Fy - (stripH / 2) * uy - R * oy)})`;
          foldShadow.style.transformOrigin = "0 0";
          foldShadow.style.opacity = String(
            Math.min(1, geo.progress * 2) * 0.85,
          );
        } else {
          foldShadow.style.display = "none";
        }
      }
      // --- vệt sáng gờ cuộn: dải dọc đường gờ (s = Rπ/2) ---
      const ridge = ridgeRef.current;
      if (ridge) {
        const R = geo.radius;
        if (R > 1 && geo.progress > 0.02 && geo.progress < 0.98) {
          const cx = geo.tangent.x + ((R * Math.PI) / 2) * geo.out.x;
          const cy = geo.tangent.y + ((R * Math.PI) / 2) * geo.out.y;
          const { x: ux, y: uy } = geo.tangentDir;
          const { x: ox, y: oy } = geo.out;
          ridge.style.display = "";
          ridge.style.width = `${stripH}px`;
          ridge.style.height = "6px";
          ridge.style.transform = `matrix(${fmt(ux)}, ${fmt(
            uy,
          )}, ${fmt(ox)}, ${fmt(oy)}, ${fmt(
            cx - (stripH / 2) * ux - 3 * ox,
          )}, ${fmt(cy - (stripH / 2) * uy - 3 * oy)})`;
          ridge.style.transformOrigin = "0 0";
          ridge.style.opacity = String(
            0.5 * Math.sin(Math.PI * geo.progress),
          );
        } else {
          ridge.style.display = "none";
        }
      }
    };

    useImperativeHandle(ref, () => ({
      update: (p: Pt) => {
        const pt = ensureFoldPoint(liveRef.current.grab, p, cell, arena);
        liveRef.current = { grab: liveRef.current.grab, point: pt };
        applyPoint(pt);
      },
    }));

    // Vẽ tư thế mount ngay trước khi paint (tránh chớp 1 frame);
    // chạy lại sau mỗi render để re-render giữa cú lật không bật
    // lá về tư thế mount ban đầu.
    useLayoutEffect(() => {
      applyPoint(liveRef.current.point);
    });

    // v0.3.9: nudge điểm mount trước khi tính hình học — trước đây
    // mount với point == grab nên hình học trả null, component trả
    // null, không có DOM nào cho imperative handle viết vào, lá tàng
    // hình suốt cả cú lật (v0.3.7–v0.3.8). Giờ lá luôn mount được với
    // hình học hợp lệ (xem ensureFoldPoint trong lib/curl.ts).
    const safePoint = ensureFoldPoint(grab, point, cell, arena);
    const geo = curlGeometry(grab, safePoint, cell, mirror ?? null);
    if (!geo) return null;

    const stripH = geo.strips[0]?.h ?? height;

    return (
      <div
        ref={rootRef}
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          zIndex: 30,
          pointerEvents: "none",
          // Một perspective chung cho mọi lát (không đặt per-strip)
          // để các lát cùng chia một không gian 3D.
          perspective: "1600px",
          transformStyle: "preserve-3d",
        }}
      >
        {/* Bóng đổ của phần đã nhấc lên, nằm trên trang gốc. */}
        <div
          ref={shadowRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            background: dark
              ? "rgba(0, 0, 0, 0.55)"
              : "rgba(30, 20, 10, 0.5)",
            filter: "blur(13px)",
            opacity: geo.shadowOpacity,
            clipPath:
              geo.shadowPoly.length >= 3
                ? `polygon(${geo.shadowPoly
                    .map((pt) => `${fmt(pt.x)}px ${fmt(pt.y)}px`)
                    .join(", ")})`
                : "none",
            transform: `translate(${fmt(geo.shadowOffset.x)}px, ${fmt(
              geo.shadowOffset.y,
            )}px)`,
            pointerEvents: "none",
          }}
        />
        {/* Vệt bóng nếp gấp dọc đường tiếp tuyến. */}
        <div
          ref={foldShadowRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: stripH,
            height: 2 * Math.max(1, geo.radius),
            background:
              "linear-gradient(to bottom, transparent, rgba(0,0,0,0.32) 50%, transparent)",
            transformOrigin: "0 0",
            pointerEvents: "none",
          }}
        />
        {/* Các lát cuộn. */}
        {Array.from({ length: CURL_LEAF_MAX_STRIPS }, (_, i) => {
          const strip = geo.strips[i];
          if (!strip) {
            return (
              <div
                key={i}
                ref={(el) => {
                  stripRefs.current[i] = el;
                }}
                style={{ display: "none" }}
              />
            );
          }
          return (
            <div
              key={i}
              ref={(el) => {
                stripRefs.current[i] = el;
              }}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: strip.w,
                height: strip.h,
                transform: strip.matrix3d,
                transformStyle: "preserve-3d",
                willChange: "transform",
                pointerEvents: "none",
              }}
            >
              {/* Mặt trước: chỉ hiện khi lát chưa quay quá 90°. */}
              <div
                ref={(el) => {
                  frontFaceRefs.current[i] = el;
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transformStyle: "preserve-3d",
                  overflow: "hidden",
                  display: strip.faces === "back" ? "none" : "",
                }}
              >
                <div
                  ref={(el) => {
                    frontContentRefs.current[i] = el;
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: cellW,
                    height,
                    background: frontBg,
                    transform: strip.contentMatrix,
                    transformOrigin: "0 0",
                    overflow: "hidden",
                  }}
                >
                  {front}
                </div>
              </div>
              {/* Mặt sau: xoay 180° quanh trục dọc để ngửa về phía
                  người xem khi lát quay quá 90°; ma trận nội dung
                  mặt sau (contentBackMatrix) đã tính cả phép lật
                  này nên không cần scaleX(-1) như bản gấp thẳng. */}
              <div
                ref={(el) => {
                  backFaceRefs.current[i] = el;
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                  transformStyle: "preserve-3d",
                  overflow: "hidden",
                  display: strip.faces === "front" ? "none" : "",
                }}
              >
                <div
                  ref={(el) => {
                    backContentRefs.current[i] = el;
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: cellW,
                    height,
                    background: backBg,
                    transform: strip.contentBackMatrix,
                    transformOrigin: "0 0",
                    overflow: "hidden",
                  }}
                >
                  {back}
                </div>
              </div>
            </div>
          );
        })}
        {/* Vệt sáng gờ cuộn dọc đường gờ (s = Rπ/2). */}
        <div
          ref={ridgeRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: stripH,
            height: 6,
            background:
              "linear-gradient(to bottom, transparent, rgba(255,255,255,0.55) 50%, transparent)",
            transformOrigin: "0 0",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  },
);

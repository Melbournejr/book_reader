import { useCallback, useEffect, useRef, useState } from "react";
import { easeOutQuart, FLIP_MS, foldGeometry } from "../lib/curl";

export interface ReaderPage {
  /** Ảnh (data URL) hoặc HTML chương EPUB. */
  content: string;
  isImage: boolean;
  label: string;
}

interface Props {
  title: string;
  /** Tổng số trang/chương của sách. */
  total: number;
  /** Mảng thưa: trang nào đã nạp thì có sẵn, chưa nạp là null. */
  initialPages: (ReaderPage | null)[];
  /** Nạp 1 trang theo chỉ số (CBZ local/Telegram: giải mã từng trang). */
  loadPage: (i: number) => Promise<ReaderPage>;
  startPage: number;
  rtl: boolean;
  onProgress: (page: number, total: number) => void;
  onClose: () => void;
}

/**
 * Trình đọc 2 trang/spread với page-curl như bản web:
 * - Nạp lười từng trang: mở truyện chỉ nạp 3 trang đầu, lật tới đâu nạp
 *   tới đó (nạp trước cả spread đích) nên đọc được tới trang cuối cùng.
 * - Lá lật chỉ ôm 1 trang (không phải cả spread), xoay quanh gáy sách,
 *   bóng đổ lên trang đích đậm dần theo tiến độ + vệt sáng nếp gấp.
 * - Lật nút/phím: giải mã ảnh spread đích trước rồi mới chạy animation
 *   900ms easeOutQuart, ghi thẳng vào DOM qua rAF (không render lại
 *   React mỗi khung hình — đó là nguồn giật trước đây).
 * - Mặt sau của lá soi gương sẵn (scaleX(-1)) nên không bao giờ hiện ngược.
 */
export default function Reader({ title, total, initialPages, loadPage, startPage, rtl, onProgress, onClose }: Props) {
  const [spread, setSpread] = useState(() => Math.floor(startPage / 2) * 2);
  const [twoPage, setTwoPage] = useState(true);
  const [flipOn, setFlipOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  // Trong lúc lật, nền hiển thị spread đích để lá lật xong là khớp, không giật.
  const [curlTarget, setCurlTarget] = useState<number | null>(null);
  const [, setCacheVersion] = useState(0);

  const cacheRef = useRef(new Map<number, ReaderPage>());
  const inflightRef = useRef(new Set<number>());
  const busyRef = useRef(false);
  const leafRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const creaseRef = useRef<HTMLDivElement>(null);
  const spreadRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ grabX: number; grabY: number; dir: 1 | -1; slot: "left" | "right"; rect: DOMRect } | null>(null);
  const curlRef = useRef<{ dir: 1 | -1; slot: "left" | "right"; target: number } | null>(null);

  // Nạp cache ban đầu từ trang đã nạp sẵn.
  useEffect(() => {
    initialPages.forEach((p, i) => {
      if (p) cacheRef.current.set(i, p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = twoPage ? 2 : 1;
  const cur = Math.min(spread, Math.max(0, total - 1));
  const shownSpread = curlTarget ?? cur;
  const left = cacheRef.current.get(shownSpread);
  const right = twoPage ? cacheRef.current.get(shownSpread + 1) : undefined;

  const ensure = useCallback(
    async (indices: number[]): Promise<void> => {
      const missing = indices.filter(
        (i) => i >= 0 && i < total && !cacheRef.current.has(i) && !inflightRef.current.has(i),
      );
      if (missing.length === 0) return;
      await Promise.all(
        missing.map(async (i) => {
          inflightRef.current.add(i);
          try {
            const p = await loadPage(i);
            cacheRef.current.set(i, p);
          } catch {
            // Để trống, lần sau lật tới sẽ thử nạp lại.
          } finally {
            inflightRef.current.delete(i);
          }
        }),
      );
      setCacheVersion((v) => v + 1);
    },
    [loadPage, total],
  );

  // Lật tới đâu nạp tới đó: spread hiện tại + spread đích (mặt sau của lá).
  useEffect(() => {
    void ensure([cur, cur + 1, cur + step, cur + step + 1]);
  }, [cur, step, ensure]);

  const decodeImages = useCallback(async (pages: (ReaderPage | undefined)[]) => {
    await Promise.all(
      pages.map(async (p) => {
        if (!p?.isImage) return;
        try {
          const img = new Image();
          img.src = p.content;
          await img.decode();
        } catch {
          // Giải mã lỗi thì cứ lật tiếp, ảnh sẽ hiện khi trình duyệt nạp xong.
        }
      }),
    );
  }, []);

  /** Trang nào đang lật (bên trái hay phải), theo chiều lật + RTL. */
  const turningSlot = useCallback(
    (dir: 1 | -1): "left" | "right" => {
      if (!twoPage) return "left";
      const forward = dir === 1;
      if (rtl) return forward ? "left" : "right";
      return forward ? "right" : "left";
    },
    [twoPage, rtl],
  );

  /** Ghi tư thế lá lật thẳng vào DOM (không render lại React). */
  const applyPose = useCallback((progress: number, slot: "left" | "right", tiltDeg: number) => {
    const leaf = leafRef.current;
    const shadow = shadowRef.current;
    const crease = creaseRef.current;
    const shade = Math.sin(progress * Math.PI);
    if (leaf) {
      const sign = slot === "right" ? -1 : 1;
      leaf.style.opacity = progress <= 0 ? "0" : "1";
      leaf.style.transform = `rotateY(${sign * progress * 180}deg) rotateX(${tiltDeg}deg)`;
      leaf.style.transformOrigin = slot === "right" ? "left center" : "right center";
    }
    if (shadow) shadow.style.opacity = String(shade * 0.5);
    if (crease) crease.style.opacity = String(shade * 0.85);
  }, []);

  const resetPose = useCallback(() => {
    const leaf = leafRef.current;
    if (leaf) {
      leaf.style.transform = "";
      leaf.style.opacity = "0";
    }
    if (shadowRef.current) shadowRef.current.style.opacity = "0";
    if (creaseRef.current) creaseRef.current.style.opacity = "0";
  }, []);

  /** Chạy animation lật từ tiến độ `from` tới `to` (0 = chưa lật, 1 = lật xong). */
  const animateCurl = useCallback(
    (dir: 1 | -1, slot: "left" | "right", from: number, to: number, done: () => void) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / FLIP_MS);
        const progress = from + (to - from) * easeOutQuart(t);
        applyPose(progress, slot, 0);
        if (t < 1) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    },
    [applyPose],
  );

  const commit = useCallback(
    async (dir: 1 | -1, fromProgress = 0) => {
      if (busyRef.current) return;
      const next = cur + dir * step;
      if (next < 0 || next >= total) return;
      busyRef.current = true;
      const slot = turningSlot(dir);
      try {
        // Nạp + giải mã spread đích trước khi lật để không giật giữa chừng.
        await ensure([next, next + 1]);
        await decodeImages([cacheRef.current.get(next), cacheRef.current.get(next + 1)]);
        if (!flipOn || fromProgress >= 1) {
          setSpread(next);
          onProgress(next, total);
          return;
        }
        curlRef.current = { dir, slot, target: next };
        setCurlTarget(next);
        // Đợi 1 khung hình để nền spread đích vẽ xong rồi mới lật.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise<void>((resolve) => {
          animateCurl(dir, slot, fromProgress, 1, resolve);
        });
        setSpread(next);
        onProgress(next, total);
      } finally {
        curlRef.current = null;
        setCurlTarget(null);
        resetPose();
        busyRef.current = false;
      }
    },
    [cur, step, total, flipOn, ensure, decodeImages, turningSlot, animateCurl, onProgress, resetPose],
  );

  // Phím mũi tên: bỏ qua sự kiện lặp khi giữ phím (chống lật chồng).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "ArrowRight") void commit(rtl ? -1 : 1);
      else if (e.key === "ArrowLeft") void commit(rtl ? 1 : -1);
      else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, rtl]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setFullscreen(false);
    } else {
      void document.documentElement.requestFullscreen().catch(() => {
        // Khung nhúng chặn fullscreen thật -> fallback phủ kín cửa sổ app.
        document.body.classList.toggle("app-fullscreen");
        setFullscreen((v) => !v);
      });
      setFullscreen(true);
    }
  };

  // Kéo chuột lật trang: nắm ở đâu, nếp gấp đi theo đó.
  const onPointerDown = (e: React.PointerEvent, dir: 1 | -1, slot: "left" | "right") => {
    if (busyRef.current || !flipOn) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const next = cur + dir * step;
    if (next < 0 || next >= total) return;
    dragRef.current = { grabX: e.clientX, grabY: e.clientY, dir, slot, rect };
    busyRef.current = true;
    curlRef.current = { dir, slot, target: next };
    setCurlTarget(next);
    void ensure([next, next + 1]);
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const g = foldGeometry(
      { x: d.grabX, y: d.grabY },
      { x: e.clientX, y: e.clientY },
      d.rect.width,
    );
    const tilt = Math.max(-12, Math.min(12, g.creaseAngle * 17));
    applyPose(g.progress, d.slot, tilt);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const g = foldGeometry(
      { x: d.grabX, y: d.grabY },
      { x: e.clientX, y: e.clientY },
      d.rect.width,
    );
    if (g.progress > 0.33) {
      // Lật hẳn từ đúng tư thế đang kéo.
      void (async () => {
        try {
          await ensure([cur + d.dir * step, cur + d.dir * step + 1]);
          await new Promise<void>((resolve) => {
            animateCurl(d.dir, d.slot, g.progress, 1, resolve);
          });
          const next = cur + d.dir * step;
          setSpread(next);
          onProgress(next, total);
        } finally {
          curlRef.current = null;
          setCurlTarget(null);
          resetPose();
          busyRef.current = false;
        }
      })();
    } else {
      // Chưa đủ đà: lá nảy về chỗ cũ.
      animateCurl(d.dir, d.slot, g.progress, 0, () => {
        curlRef.current = null;
        setCurlTarget(null);
        resetPose();
        busyRef.current = false;
      });
    }
  };

  const renderFace = (p: ReaderPage | undefined, mirrored: boolean) =>
    p ? (
      <div className="page-face" style={mirrored ? { transform: "scaleX(-1)" } : undefined}>
        {p.isImage ? (
          <img src={p.content} alt={p.label} draggable={false} />
        ) : (
          <div className="epub-page" dangerouslySetInnerHTML={{ __html: p.content }} />
        )}
      </div>
    ) : (
      <div className="page-face page-loading">Đang tải trang…</div>
    );

  // Trang đích của lá đang lật (mặt sau của tờ giấy).
  const target = curlTarget ?? cur + step;
  const leafSlot: "left" | "right" = curlRef.current
    ? curlRef.current.slot
    : turningSlot(1);
  const leafFront = leafSlot === "right" ? right : left;
  const leafBack = leafSlot === "right"
    ? cacheRef.current.get(target)
    : cacheRef.current.get(target + 1);

  return (
    <div className={`reader ${fullscreen ? "is-fullscreen" : ""}`}>
      <header className="reader-bar">
        <button onClick={onClose}>← Thư viện</button>
        <strong>{title}</strong>
        <span>
          {cur + 1}
          {twoPage && right ? `–${cur + 2}` : ""} / {total}
        </span>
        <button onClick={() => setTwoPage((v) => !v)}>{twoPage ? "2 trang" : "1 trang"}</button>
        <button onClick={() => setFlipOn((v) => !v)}>Lật trang: {flipOn ? "Bật" : "Tắt"}</button>
        <button onClick={toggleFullscreen}>⛶ Toàn màn hình (F)</button>
      </header>

      <div className="spread" ref={spreadRef} style={{ perspective: "1600px" }}>
        {/* Trang nền bên trái */}
        <div
          className="page-slot"
          onPointerDown={(e) => onPointerDown(e, rtl ? 1 : -1, "left")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {renderFace(left, false)}
        </div>
        {twoPage && (
          <div
            className="page-slot"
            onPointerDown={(e) => onPointerDown(e, rtl ? -1 : 1, "right")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {renderFace(right, false)}
          </div>
        )}
        {/* Bóng đổ lên trang đích, đậm dần giữa chừng lật. */}
        <div ref={shadowRef} className={`curl-shadow${leafSlot === "left" ? " flip" : ""}`} style={{ left: leafSlot === "right" ? "0" : "50%" }} />
        {/* Lá đang lật: chỉ ôm 1 trang, xoay quanh gáy. Mặt trước = trang
            hiện tại, mặt sau = trang đích (soi gương sẵn để không bị ngược). */}
        <div
          ref={leafRef}
          className="curl-leaf"
          style={{
            left: leafSlot === "right" ? "50%" : "0",
            width: twoPage ? "50%" : "100%",
            opacity: 0,
          }}
        >
          <div className="leaf-front">{renderFace(leafFront, false)}</div>
          <div className="leaf-back">{renderFace(leafBack, true)}</div>
          <div ref={creaseRef} className={`leaf-crease${leafSlot === "left" ? " flip" : ""}`} style={{ right: leafSlot === "right" ? "auto" : 0, left: leafSlot === "right" ? 0 : "auto" }} />
        </div>
      </div>

      <footer className="reader-bar">
        <button onClick={() => void commit(-1)} disabled={cur <= 0}>
          ← Trước
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={cur}
          onChange={(e) => {
            const n = Number(e.target.value);
            void ensure([n, n + 1]);
            setSpread(Math.floor(n / step) * step);
            onProgress(n, total);
          }}
        />
        <button onClick={() => void commit(1)} disabled={cur + step >= total}>
          Sau →
        </button>
      </footer>
      <p className="hint">
        Kéo chuột từ mép trang để lật như tay cầm sách • ← → lật trang • F toàn màn
        hình • Esc thoát
      </p>
    </div>
  );
}

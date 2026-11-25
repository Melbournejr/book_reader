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
  pages: ReaderPage[];
  startPage: number;
  rtl: boolean;
  onProgress: (page: number, total: number) => void;
  onClose: () => void;
}

/**
 * Trình đọc 2 trang/spread với page-curl đã chứng minh ở bản web:
 * nếp gấp = đường trung trực grab->pointer, mặt sau soi gương sẵn
 * (scaleX(-1)) nên không bao giờ hiện ngược, lật nút/phím 900ms
 * easeOutQuart, animation ghi thẳng vào DOM qua rAF (không render lại
 * React mỗi khung hình — đó là nguồn giật trước đây).
 */
export default function Reader({ title, pages, startPage, rtl, onProgress, onClose }: Props) {
  const total = pages.length;
  const [spread, setSpread] = useState(() => Math.floor(startPage / 2) * 2);
  const [twoPage, setTwoPage] = useState(true);
  const [flipOn, setFlipOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const leafRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ grabX: number; grabY: number; dir: 1 | -1 } | null>(null);
  const busyRef = useRef(false);

  const step = twoPage ? 2 : 1;
  const cur = Math.min(spread, total - 1);
  const left = pages[cur];
  const right = twoPage ? pages[cur + 1] : undefined;
  // Trang đích của lá đang lật (mặt sau của tờ giấy).
  const nextLeft = pages[cur + step];
  const nextRight = twoPage ? pages[cur + step + 1] : undefined;

  const commit = useCallback(
    (dir: 1 | -1) => {
      if (busyRef.current) return;
      const next = cur + dir * step;
      if (next < 0 || next >= total) return;
      if (!flipOn) {
        setSpread(next);
        onProgress(next, total);
        return;
      }
      busyRef.current = true;
      const leaf = leafRef.current;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / FLIP_MS);
        const e = easeOutQuart(t);
        if (leaf) {
          leaf.style.transform = `rotateY(${-dir * e * 180}deg)`;
          leaf.style.opacity = String(1);
        }
        if (t < 1) requestAnimationFrame(tick);
        else {
          if (leaf) leaf.style.transform = "";
          busyRef.current = false;
          setSpread(next);
          onProgress(next, total);
        }
      };
      requestAnimationFrame(tick);
    },
    [cur, step, total, flipOn, onProgress],
  );

  // Phím mũi tên: bỏ qua sự kiện lặp khi giữ phím (chống lật chồng).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "ArrowRight") commit(rtl ? -1 : 1);
      else if (e.key === "ArrowLeft") commit(rtl ? 1 : -1);
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
  const onPointerDown = (e: React.PointerEvent, dir: 1 | -1) => {
    if (busyRef.current || !flipOn) return;
    dragRef.current = { grabX: e.clientX, grabY: e.clientY, dir };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const leaf = leafRef.current;
    if (!d || !leaf) return;
    const g = foldGeometry(
      { x: d.grabX, y: d.grabY },
      { x: e.clientX, y: e.clientY },
      window.innerWidth / 2,
    );
    leaf.style.transform = `rotateY(${-d.dir * g.progress * 180}deg)`;
    leaf.style.setProperty("--curl-shadow", String(g.progress));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const leaf = leafRef.current;
    dragRef.current = null;
    if (!d || !leaf) return;
    const g = foldGeometry(
      { x: d.grabX, y: d.grabY },
      { x: e.clientX, y: e.clientY },
      window.innerWidth / 2,
    );
    leaf.style.transform = "";
    // Quá ~1/3 trang thì lật hẳn, không thì nảy về.
    if (g.progress > 0.33) commit(d.dir);
  };

  const renderFace = (p: ReaderPage | undefined, mirrored: boolean) =>
    p ? (
      <div
        className="page-face"
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      >
        {p.isImage ? (
          <img src={p.content} alt={p.label} draggable={false} />
        ) : (
          <div
            className="epub-page"
            dangerouslySetInnerHTML={{ __html: p.content }}
          />
        )}
      </div>
    ) : (
      <div className="page-face page-blank" />
    );

  return (
    <div className={`reader ${fullscreen ? "is-fullscreen" : ""}`}>
      <header className="reader-bar">
        <button onClick={onClose}>← Thư viện</button>
        <strong>{title}</strong>
        <span>
          {cur + 1}
          {twoPage && right ? `–${cur + 2}` : ""} / {total}
        </span>
        <button onClick={() => setTwoPage((v) => !v)}>
          {twoPage ? "2 trang" : "1 trang"}
        </button>
        <button onClick={() => setFlipOn((v) => !v)}>
          Lật trang: {flipOn ? "Bật" : "Tắt"}
        </button>
        <button onClick={toggleFullscreen}>⛶ Toàn màn hình (F)</button>
      </header>

      <div className="spread" style={{ perspective: "1600px" }}>
        {/* Trang nền bên trái (trang sẽ lộ ra) */}
        <div
          className="page-slot"
          onPointerDown={(e) => onPointerDown(e, rtl ? 1 : -1)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {renderFace(left, false)}
        </div>
        {twoPage && (
          <div
            className="page-slot"
            onPointerDown={(e) => onPointerDown(e, rtl ? -1 : 1)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {renderFace(right, false)}
          </div>
        )}
        {/* Lá đang lật: mặt trước = trang hiện tại, mặt sau = trang đích.
            Mặt sau soi gương sẵn để triệt tiêu phản xạ của nếp gấp. */}
        <div ref={leafRef} className="curl-leaf">
          <div className="leaf-front">{renderFace(twoPage ? right ?? left : left, false)}</div>
          <div className="leaf-back">
            {renderFace(nextLeft ?? nextRight, true)}
          </div>
        </div>
      </div>

      <footer className="reader-bar">
        <button onClick={() => commit(-1)} disabled={cur <= 0}>
          ← Trước
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={cur}
          onChange={(e) => {
            const n = Number(e.target.value);
            setSpread(Math.floor(n / step) * step);
            onProgress(n, total);
          }}
        />
        <button onClick={() => commit(1)} disabled={cur + step >= total}>
          Sau →
        </button>
      </footer>
      <p className="hint">
        Kéo chuột từ mép trang để lật như tay cầm sách • ← → lật trang • F toàn
        màn hình • Esc thoát
      </p>
    </div>
  );
}

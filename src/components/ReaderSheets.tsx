import { useEffect, useRef, useState } from "react";
import type {
  Bookmark,
  Chapter,
  CropMargins,
  Highlight,
  SearchResult,
} from "../types";

export type SheetKind =
  | "menu"
  | "typo"
  | "search"
  | "grid"
  | "bookmarks"
  | "highlights"
  | null;

/** Bôi vàng từ khóa trong snippet (escape HTML trước rồi mới chèn <mark>). */
function markSnippet(snippet: string, query: string): string {
  const esc = snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const q = query.trim();
  if (!q) return esc;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return esc.replace(re, (m) => `<mark>${m}</mark>`);
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      className={`switch${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
    />
  );
}

interface CommonProps {
  title: string;
  onClose: () => void;
  onOpenSheet: (s: Exclude<SheetKind, null>) => void;
}

function SheetShell({
  title,
  onClose,
  children,
}: CommonProps & { children: React.ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  );
}

/* ================= Menu ⋯ — nơi duy nhất chứa tính năng phụ ================= */

export interface MenuProps extends CommonProps {
  bookInfo: string;
  isComic: boolean;
  isTextBook: boolean;
  immersive: boolean;
  onToggleImmersive: () => void;
  twoPage: boolean;
  onSetTwoPage: (v: boolean) => void;
  rtl: boolean;
  onSetRtl: (v: boolean) => void;
  cropAuto: boolean;
  onSetCropAuto: (v: boolean) => void;
  crop: CropMargins;
  onCropChange: (c: CropMargins) => void;
  onCropAutoDetect: () => void;
  onCropClear: () => void;
  cropBusy: boolean;
  cropMsg: string;
  zoomLabel: string;
  fit: "page" | "width" | "height";
  onSetFit: (f: "page" | "width" | "height") => void;
  zoomPct: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  fontLabel: string; // vd "Noto Serif · Giấy"
  ttsPlaying: boolean;
  ttsSupported: boolean;
  onToggleTts: () => void;
  voices: SpeechSynthesisVoice[];
  voiceUri: string;
  onVoice: (uri: string) => void;
  rate: number;
  onRate: (r: number) => void;
  onDictHint: () => void;
  onOpenStats: () => void;
  onShowInfo: () => void;
}

export function MenuSheet(p: MenuProps) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);

  const cropSlider = (
    key: keyof CropMargins,
    label: string,
  ) => (
    <div className="sliderrow" key={key}>
      <label>{label}</label>
      <input
        type="range"
        min={0}
        max={40}
        value={p.crop[key]}
        onChange={(e) =>
          p.onCropChange({ ...p.crop, [key]: Number(e.target.value) })
        }
      />
      <span className="val">{p.crop[key]}%</span>
    </div>
  );

  return (
    <SheetShell title="Tùy chọn đọc" onClose={p.onClose} onOpenSheet={p.onOpenSheet}>
      <p className="mgroup">Đọc</p>
      <button className="mitem" onClick={p.onToggleImmersive}>
        <span className="mi-ic">⛶</span>
        <span className="mi-label">Đọc toàn màn hình</span>
        <span className="kbd">F</span>
      </button>
      <div className="seg-row">
        <span className="seg-label">Kiểu trang</span>
        <div className="seg">
          <button className={p.twoPage ? "on" : ""} onClick={() => p.onSetTwoPage(true)}>
            2 trang
          </button>
          <button className={!p.twoPage ? "on" : ""} onClick={() => p.onSetTwoPage(false)}>
            1 trang
          </button>
        </div>
      </div>
      {p.isComic && (
        <div className="mitem" style={{ cursor: "default" }}>
          <span className="mi-ic">⇄</span>
          <span className="mi-label">Đọc phải → trái (manga)</span>
          <Switch on={p.rtl} onToggle={() => p.onSetRtl(!p.rtl)} label="Đọc phải sang trái" />
        </div>
      )}
      {p.isComic && (
        <>
          <div className="mitem" style={{ cursor: "default" }}>
            <span className="mi-ic">✂</span>
            <span className="mi-label">Tự cắt lề trắng</span>
            <Switch
              on={p.cropAuto}
              onToggle={() => {
                p.onSetCropAuto(!p.cropAuto);
                if (!p.cropAuto) setCropOpen(true);
              }}
              label="Tự cắt lề trắng"
            />
          </div>
          {p.cropAuto && (
            <div style={{ paddingLeft: 8 }}>
              {cropSlider("left", "Trái")}
              {cropSlider("right", "Phải")}
              {cropSlider("top", "Trên")}
              {cropSlider("bottom", "Dưới")}
              <div style={{ display: "flex", gap: 8, padding: "4px 10px" }}>
                <button onClick={p.onCropAutoDetect} disabled={p.cropBusy}>
                  {p.cropBusy ? "Đang quét…" : "Tự nhận diện"}
                </button>
                <button onClick={p.onCropClear}>Bỏ cắt lề</button>
              </div>
              {p.cropMsg && <p className="sheet-note">{p.cropMsg}</p>}
              <p className="sheet-note">Chỉ cắt lúc hiển thị trang ảnh, không sửa file gốc.</p>
            </div>
          )}
        </>
      )}
      <button className="mitem" onClick={() => setZoomOpen(!zoomOpen)}>
        <span className="mi-ic">🔍</span>
        <span className="mi-label">Thu phóng</span>
        <span className="mi-val">{p.zoomLabel}</span>
      </button>
      {zoomOpen && (
        <div style={{ paddingLeft: 8 }}>
          <div className="seg-row">
            <div className="seg">
              <button className={p.fit === "page" ? "on" : ""} onClick={() => p.onSetFit("page")}>
                Vừa trang
              </button>
              <button className={p.fit === "width" ? "on" : ""} onClick={() => p.onSetFit("width")}>
                Vừa rộng
              </button>
              <button className={p.fit === "height" ? "on" : ""} onClick={() => p.onSetFit("height")}>
                Vừa cao
              </button>
            </div>
          </div>
          <div className="zoom-row">
            <button className="zbtn" onClick={p.onZoomOut} aria-label="Thu nhỏ">
              −
            </button>
            <span className="zval">{p.zoomPct}%</span>
            <button className="zbtn" onClick={p.onZoomIn} aria-label="Phóng to">
              +
            </button>
            <button onClick={p.onZoomReset}>Đặt lại</button>
          </div>
        </div>
      )}

      <p className="mgroup">Trang này</p>
      <button className="mitem" onClick={p.onToggleBookmark}>
        <span className="mi-ic">🔖</span>
        <span className="mi-label">Đánh dấu trang</span>
        {p.bookmarked ? <span className="mi-check">✓</span> : <span className="kbd">B</span>}
      </button>
      <button className="mitem" onClick={() => p.onOpenSheet("bookmarks")}>
        <span className="mi-ic">☰</span>
        <span className="mi-label">Danh sách đánh dấu</span>
      </button>
      {p.isTextBook && (
        <button className="mitem" onClick={() => p.onOpenSheet("highlights")}>
          <span className="mi-ic">✎</span>
          <span className="mi-label">Gạch chân đã lưu</span>
        </button>
      )}
      <button className="mitem" onClick={() => p.onOpenSheet("grid")}>
        <span className="mi-ic">▦</span>
        <span className="mi-label">Lưới trang</span>
        <span className="kbd">G</span>
      </button>
      <button className="mitem" onClick={() => p.onOpenSheet("search")}>
        <span className="mi-ic">⌕</span>
        <span className="mi-label">Tìm trong sách</span>
        <span className="kbd">Ctrl F</span>
      </button>
      <button className="mitem" onClick={() => p.onOpenSheet("typo")}>
        <span className="mi-ic">Aa</span>
        <span className="mi-label">Chữ &amp; nền trang</span>
        <span className="mi-val">{p.fontLabel}</span>
      </button>

      <p className="mgroup">Nghe &amp; tra cứu</p>
      <button className="mitem" onClick={p.onToggleTts} disabled={!p.ttsSupported}>
        <span className="mi-ic">🔊</span>
        <span className="mi-label">Đọc thành tiếng</span>
        <span className="kbd">T</span>
        {p.ttsPlaying ? <span className="mi-check">▶</span> : null}
      </button>
      {p.ttsSupported && (
        <>
          <div className="sliderrow">
            <label>Giọng đọc</label>
            <select
              value={p.voiceUri}
              onChange={(e) => p.onVoice(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              {p.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
          <div className="sliderrow">
            <label>Tốc độ</label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={p.rate}
              onChange={(e) => p.onRate(Number(e.target.value))}
            />
            <span className="val">{p.rate.toFixed(1)}×</span>
          </div>
        </>
      )}
      <button className="mitem" onClick={p.onDictHint}>
        <span className="mi-ic">📖</span>
        <span className="mi-label">Tra từ điển</span>
        <span className="mi-val">Bôi đen chữ để tra</span>
      </button>

      <p className="mgroup">Cuốn sách</p>
      <button className="mitem" onClick={p.onShowInfo}>
        <span className="mi-ic">ℹ</span>
        <span className="mi-label">Thông tin sách</span>
        <span className="mi-val">{p.bookInfo}</span>
      </button>
      <button className="mitem" onClick={p.onOpenStats}>
        <span className="mi-ic">📊</span>
        <span className="mi-label">Thống kê đọc</span>
      </button>
    </SheetShell>
  );
}

/* ================= Chữ & nền trang ================= */

export interface TypoProps extends CommonProps {
  fontSize: number;
  onFontSize: (v: number) => void;
  lineHeight: number;
  onLineHeight: (v: number) => void;
  fontSans: boolean;
  onFontSans: (v: boolean) => void;
  pageTheme: "light" | "paper" | "night";
  onPageTheme: (t: "light" | "paper" | "night") => void;
}

export function TypoSheet(p: TypoProps) {
  return (
    <SheetShell title="Chữ & nền trang" onClose={p.onClose} onOpenSheet={p.onOpenSheet}>
      <div className="sliderrow">
        <label>Cỡ chữ</label>
        <input
          type="range"
          min={13.5}
          max={19}
          step={0.5}
          value={p.fontSize}
          onChange={(e) => p.onFontSize(Number(e.target.value))}
        />
        <span className="val">{p.fontSize.toFixed(1)} px</span>
      </div>
      <div className="sliderrow">
        <label>Giãn dòng</label>
        <input
          type="range"
          min={1.5}
          max={2.1}
          step={0.02}
          value={p.lineHeight}
          onChange={(e) => p.onLineHeight(Number(e.target.value))}
        />
        <span className="val">{p.lineHeight.toFixed(2)}</span>
      </div>
      <div className="seg-row">
        <span className="seg-label">Kiểu chữ</span>
        <div className="seg">
          <button className={!p.fontSans ? "on" : ""} onClick={() => p.onFontSans(false)}>
            Serif
          </button>
          <button className={p.fontSans ? "on" : ""} onClick={() => p.onFontSans(true)}>
            Sans
          </button>
        </div>
      </div>
      <p className="mgroup">Nền trang</p>
      <div className="swatches">
        <button
          className={`swatch s-light${p.pageTheme === "light" ? " on" : ""}`}
          onClick={() => p.onPageTheme("light")}
        >
          Sáng
        </button>
        <button
          className={`swatch s-paper${p.pageTheme === "paper" ? " on" : ""}`}
          onClick={() => p.onPageTheme("paper")}
        >
          Giấy
        </button>
        <button
          className={`swatch s-night${p.pageTheme === "night" ? " on" : ""}`}
          onClick={() => p.onPageTheme("night")}
        >
          Đêm
        </button>
      </div>
      <p className="sheet-note">
        Nhớ theo từng cuốn — chỉ áp dụng cho sách chữ (EPUB/MOBI). Truyện tranh
        hiển thị nguyên trang ảnh, không đổi được cỡ chữ.
      </p>
    </SheetShell>
  );
}

/* ================= Tìm trong sách ================= */

export interface SearchProps extends CommonProps {
  query: string;
  onQuery: (q: string) => void;
  onSearch: () => void;
  searching: boolean;
  progress: string;
  onCancel: () => void;
  results: SearchResult[];
  onJump: (r: SearchResult) => void;
  /** false = truyện ảnh: tìm chữ trong tranh không làm được, báo thẳng. */
  searchable: boolean;
}

export function SearchSheet(p: SearchProps) {
  return (
    <SheetShell title="Tìm trong sách" onClose={p.onClose} onOpenSheet={p.onOpenSheet}>
      {!p.searchable ? (
        <p className="sheet-note">
          Đây là truyện tranh — chữ nằm trong ảnh nên không tìm được bằng chữ.
          (App không làm OCR giả — tìm theo tên chương/trang ở lưới trang.)
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") p.onSearch();
              }}
              placeholder="Nhập từ cần tìm…"
              style={{ flex: 1, minWidth: 0 }}
              autoFocus
            />
            <button className="primary" onClick={p.onSearch} disabled={p.searching || !p.query.trim()}>
              {p.searching ? "Đang tìm…" : "Tìm"}
            </button>
          </div>
          {p.searching && (
            <p className="sheet-note">
              {p.progress}{" "}
              <button className="linklike" onClick={p.onCancel}>
                Dừng
              </button>
            </p>
          )}
          {!p.searching && p.results.length > 0 && (
            <p className="sheet-note">Tìm thấy {p.results.length} chỗ khớp.</p>
          )}
          {!p.searching && p.results.length === 0 && p.query.trim() && (
            <p className="sheet-note">Chưa tìm — bấm “Tìm” hoặc Enter.</p>
          )}
          <div>
            {p.results.map((r, i) => (
              <button key={i} className="sresult" onClick={() => p.onJump(r)}>
                <div className="sr-page">{r.label}</div>
                <div
                  className="sr-snip"
                  dangerouslySetInnerHTML={{ __html: markSnippet(r.snippet, p.query) }}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </SheetShell>
  );
}

/* ================= Lưới trang ================= */

export function ThumbCell({
  index,
  isCurrent,
  loadThumb,
  onJump,
}: {
  index: number;
  isCurrent: boolean;
  loadThumb: (i: number) => Promise<string | null>;
  onJump: (i: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          void loadThumb(index)
            .then((s) => setSrc(s))
            .finally(() => setDone(true));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [index, loadThumb]);

  return (
    <button
      ref={ref}
      className={`thumbcell${isCurrent ? " on" : ""}`}
      onClick={() => onJump(index)}
      aria-label={`Trang ${index + 1}`}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <div className="tp-empty">{done ? "—" : "…"}</div>
      )}
      <span className="tp">{index + 1}</span>
    </button>
  );
}

export interface GridProps extends CommonProps {
  total: number;
  currentPage: number;
  isTextBook: boolean;
  chapters: Chapter[];
  loadThumb: (i: number) => Promise<string | null>;
  onJump: (page: number) => void;
}

export function GridSheet(p: GridProps) {
  return (
    <SheetShell title="Lưới trang" onClose={p.onClose} onOpenSheet={p.onOpenSheet}>
      {p.isTextBook && p.chapters.length > 0 ? (
        <div>
          {p.chapters.map((c, i) => (
            <button key={i} className="sresult" onClick={() => p.onJump(i)}>
              <div className="sr-page">Chương {i + 1}</div>
              <div className="sr-snip">{c.title}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="thumbgrid">
          {Array.from({ length: p.total }, (_, i) => (
            <ThumbCell
              key={i}
              index={i}
              isCurrent={i === p.currentPage}
              loadThumb={p.loadThumb}
              onJump={p.onJump}
            />
          ))}
        </div>
      )}
      <p className="sheet-note">
        Ảnh nhỏ tải lười khi cuộn tới — sách dài vẫn mở lưới nhanh.
      </p>
    </SheetShell>
  );
}

/* ================= Đánh dấu ================= */

export interface BookmarksProps extends CommonProps {
  bookmarks: Bookmark[];
  currentPage: number;
  onJump: (page: number) => void;
  onDelete: (id: number) => void;
}

export function BookmarksSheet(p: BookmarksProps) {
  return (
    <SheetShell title="Đánh dấu" onClose={p.onClose} onOpenSheet={p.onOpenSheet}>
      {p.bookmarks.length === 0 ? (
        <p className="sheet-note">
          Chưa có đánh dấu nào. Bấm B hoặc nút 🔖 trong menu để đánh dấu trang
          đang đọc.
        </p>
      ) : (
        <div>
          {p.bookmarks.map((b) => (
            <div key={b.id} className="mark-row">
              <button
                className="mr-main"
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", flex: 1, minWidth: 0 }}
                onClick={() => p.onJump(b.page)}
              >
                <div className="mr-title">
                  Trang {b.page + 1}
                  {b.page === p.currentPage ? " · đang đọc" : ""}
                </div>
                <div className="mr-sub">
                  {b.chapter ? `${b.chapter} · ` : ""}
                  {new Date(b.created_at).toLocaleDateString("vi-VN")}
                  {b.note ? ` · ${b.note}` : ""}
                </div>
              </button>
              <button className="mr-del" onClick={() => p.onDelete(b.id)} aria-label="Xóa đánh dấu">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </SheetShell>
  );
}

/* ================= Gạch chân ================= */

export interface HighlightsProps extends CommonProps {
  highlights: Highlight[];
  onJump: (h: Highlight) => void;
  onDelete: (id: number) => void;
}

export function HighlightsSheet(p: HighlightsProps) {
  const colorName: Record<string, string> = {
    yellow: "Vàng",
    pink: "Hồng",
    green: "Xanh lá",
    blue: "Xanh dương",
  };
  const colorHex: Record<string, string> = {
    yellow: "#ffe066",
    pink: "#ffb3c7",
    green: "#b7f0c0",
    blue: "#b3d7ff",
  };
  return (
    <SheetShell title="Gạch chân đã lưu" onClose={p.onClose} onOpenSheet={p.onOpenSheet}>
      {p.highlights.length === 0 ? (
        <p className="sheet-note">
          Chưa có đoạn gạch chân nào. Bôi đen chữ trong sách chữ (EPUB/MOBI)
          rồi chọn màu để lưu.
        </p>
      ) : (
        <div>
          {p.highlights.map((h) => (
            <div key={h.id} className="mark-row">
              <button
                className="mr-main"
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", flex: 1, minWidth: 0 }}
                onClick={() => p.onJump(h)}
              >
                <div className="mr-title">
                  <span
                    className="hl-chip"
                    style={{ background: colorHex[h.color] ?? "#ffe066" }}
                  />
                  Trang {h.page + 1} · {colorName[h.color] ?? h.color}
                </div>
                <div className="mr-sub">
                  “{h.text.slice(0, 120)}
                  {h.text.length > 120 ? "…" : ""}”
                  {h.note ? ` — ${h.note}` : ""}
                </div>
              </button>
              <button className="mr-del" onClick={() => p.onDelete(h.id)} aria-label="Xóa gạch chân">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </SheetShell>
  );
}

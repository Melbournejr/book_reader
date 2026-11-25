import { useEffect, useRef, useState } from "react";
import type { Bookmark, Highlight, SearchResult } from "../types";

export type PanelTab = "bookmarks" | "search" | "highlights" | "grid";

interface PanelsProps {
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  total: number;
  cur: number;
  /** Sách chữ (EPUB/MOBI) mới có gạch chân; sách ảnh thì không. */
  isTextBook: boolean;
  // --- bookmarks ---
  bookmarks: Bookmark[];
  onAddBookmark: (label: string) => void;
  onJumpTo: (page: number) => void;
  onDeleteBookmark: (id: number) => void;
  // --- search ---
  searchSupported: boolean;
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  onSearch: () => void;
  searching: boolean;
  searchDone: number;
  searchTotal: number;
  searchResults: SearchResult[];
  onJumpSearch: (r: SearchResult) => void;
  onCancelSearch: () => void;
  // --- highlights ---
  highlights: Highlight[];
  onDeleteHighlight: (id: number) => void;
  onJumpHighlight: (h: Highlight) => void;
  // --- grid ---
  /** Nạp thumbnail cho trang i; null = hiện danh sách chương thay vì ảnh. */
  thumbFor: ((i: number) => Promise<string | null>) | null;
  chapterTitles?: string[];
  /** Manga RTL: lưới trang chảy từ phải sang trái. */
  rtl?: boolean;
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

/** 1 ô thumbnail trong lưới: chỉ nạp ảnh khi cuộn tới gần. */
function ThumbCell({
  index,
  label,
  current,
  loadThumb,
  onJump,
}: {
  index: number;
  label: string;
  current: boolean;
  loadThumb: (i: number) => Promise<string | null>;
  onJump: (i: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void loadThumb(index).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, index, loadThumb]);
  return (
    <button
      ref={ref}
      className={`thumb-cell${current ? " current" : ""}`}
      onClick={() => onJump(index)}
      title={label}
    >
      {src ? <img src={src} alt={label} loading="lazy" /> : <span className="thumb-ph">…</span>}
      <span className="thumb-label">{label}</span>
    </button>
  );
}

export default function ReaderPanels(props: PanelsProps) {
  const {
    tab, onTab, onClose, total, cur, isTextBook,
    bookmarks, onAddBookmark, onJumpTo, onDeleteBookmark,
    searchSupported, searchQuery, onSearchQuery, onSearch, searching,
    searchDone, searchTotal, searchResults, onJumpSearch, onCancelSearch,
    highlights, onDeleteHighlight, onJumpHighlight,
    thumbFor, chapterTitles, rtl = false,
  } = props;
  const [bmLabel, setBmLabel] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Mở tab tìm kiếm bằng Ctrl+F thì focus thẳng vào ô nhập.
  useEffect(() => {
    if (tab === "search") searchInputRef.current?.focus();
  }, [tab]);

  return (
    <aside className="reader-panel">
      <div className="panel-tabs">
        <button className={tab === "bookmarks" ? "active" : ""} onClick={() => onTab("bookmarks")}>
          ★ Đánh dấu
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => onTab("search")}>
          🔍 Tìm
        </button>
        <button className={tab === "highlights" ? "active" : ""} onClick={() => onTab("highlights")}>
          ✏️ Gạch chân
        </button>
        <button className={tab === "grid" ? "active" : ""} onClick={() => onTab("grid")}>
          🗂 Lưới trang
        </button>
        <button className="panel-close" onClick={onClose} title="Đóng bảng (Esc)">
          ✕
        </button>
      </div>

      {tab === "bookmarks" && (
        <div className="panel-body">
          <p className="muted">Đánh dấu trang đang đọc (phím B) để nhảy lại sau.</p>
          <p>
            <input
              value={bmLabel}
              onChange={(e) => setBmLabel(e.target.value)}
              placeholder={`Nhãn, VD: Trang ${cur + 1}`}
            />{" "}
            <button
              onClick={() => {
                onAddBookmark(bmLabel.trim() || `Trang ${cur + 1}`);
                setBmLabel("");
              }}
            >
              Lưu trang này
            </button>
          </p>
          {bookmarks.length === 0 && <p className="muted">Chưa có đánh dấu nào.</p>}
          <ul className="panel-list">
            {bookmarks.map((b) => (
              <li key={b.id} className={b.page === cur ? "current" : ""}>
                <button className="linklike" onClick={() => onJumpTo(b.page)}>
                  {b.note || b.chapter || `Trang ${b.page + 1}`}
                </button>{" "}
                <span className="muted">
                  tr. {b.page + 1} • {fmtTime(b.created_at)}
                </span>{" "}
                <button onClick={() => onDeleteBookmark(b.id)} title="Xóa đánh dấu">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "search" && (
        <div className="panel-body">
          {!searchSupported ? (
            <p>
              Truyện ảnh không tìm được chữ trong tranh — file này chỉ có ảnh,
              không có lớp chữ nên app không thể tìm theo từ khóa. Dùng lưới
              trang để nhảy tới trang cần đọc.
            </p>
          ) : (
            <>
              <p>
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => onSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSearch();
                  }}
                  placeholder="Nhập từ cần tìm…"
                />{" "}
                <button onClick={onSearch} disabled={searching || !searchQuery.trim()}>
                  Tìm
                </button>
              </p>
              {searching && (
                <p>
                  Đang tìm… {searchDone}/{searchTotal} trang{" "}
                  <button onClick={onCancelSearch}>Hủy</button>
                </p>
              )}
              {!searching && searchResults.length > 0 && (
                <p className="muted">Tìm thấy {searchResults.length} kết quả.</p>
              )}
              <ul className="panel-list">
                {searchResults.map((r, i) => (
                  <li key={`${r.page}-${i}`}>
                    <button className="linklike" onClick={() => onJumpSearch(r)}>
                      {r.label}
                    </button>
                    <div className="muted">{r.snippet}</div>
                  </li>
                ))}
              </ul>
              {!searching && searchQuery.trim() !== "" && searchResults.length === 0 && searchDone > 0 && (
                <p className="muted">Không tìm thấy “{searchQuery}” trong sách này.</p>
              )}
            </>
          )}
        </div>
      )}

      {tab === "highlights" && (
        <div className="panel-body">
          {!isTextBook ? (
            <p>
              Sách ảnh không gạch chân được — trang chỉ có ảnh, không có chữ
              để chọn. Gạch chân chỉ dùng cho sách chữ (EPUB/MOBI): bôi đen 1
              đoạn chữ trong trang rồi bấm Lưu.
            </p>
          ) : (
            <>
              <p className="muted">
                Bôi đen 1 đoạn chữ trong trang rồi lưu lại ở đây, kèm màu và ghi
                chú. Bấm vào 1 dòng để nhảy tới đoạn đó.
              </p>
              {highlights.length === 0 && <p className="muted">Chưa có đoạn gạch chân nào.</p>}
              <ul className="panel-list">
                {highlights.map((h) => (
                  <li key={h.id} className={h.page === cur ? "current" : ""}>
                    <button className="linklike" onClick={() => onJumpHighlight(h)}>
                      <span
                        className="hl-swatch"
                        style={{ backgroundColor: h.color === "yellow" ? "#ffe066" : h.color === "pink" ? "#ffb3c7" : h.color === "green" ? "#b7f0b1" : "#a8d8ff" }}
                      />
                      {h.text.length > 80 ? h.text.slice(0, 80) + "…" : h.text}
                    </button>
                    <div className="muted">
                      {h.chapter || `Trang ${h.page + 1}`}
                      {h.note ? ` • ghi chú: ${h.note}` : ""} • {fmtTime(h.created_at)}
                    </div>{" "}
                    <button onClick={() => onDeleteHighlight(h.id)} title="Xóa gạch chân">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "grid" && (
        <div className="panel-body">
          {thumbFor ? (
            <>
              <p className="muted">
                {total} trang — thumbnail chỉ nạp khi cuộn tới, bấm vào 1 ô để nhảy tới trang đó.
              </p>
              <div className="thumb-grid" dir={rtl ? "rtl" : "ltr"}>
                {Array.from({ length: total }, (_, i) => (
                  <ThumbCell
                    key={i}
                    index={i}
                    label={`Trang ${i + 1}`}
                    current={i === cur || i === cur + 1}
                    loadThumb={thumbFor}
                    onJump={onJumpTo}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="muted">Sách chữ: chọn chương để nhảy tới.</p>
              <ul className="panel-list" dir={rtl ? "rtl" : "ltr"}>
                {(chapterTitles ?? []).map((t, i) => (
                  <li key={i} className={i === cur ? "current" : ""}>
                    <button className="linklike" onClick={() => onJumpTo(i)}>
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { BookMeta, HistoryEntry } from "../types";
import { api } from "../lib/api";
import { isComicFormat } from "../lib/spread";

/** Gradient bìa theo định dạng (theo thiết kế v0.3.0: cv1–cv8). */
function formatGradient(format: string): string {
  switch (format.toLowerCase()) {
    case "epub":
      return "linear-gradient(150deg, #31413a, #1d2925)"; // cv1 xanh lá đậm
    case "pdf":
      return "linear-gradient(150deg, #5d2320, #38120f)"; // cv2 đỏ
    case "mobi":
      return "linear-gradient(150deg, #274156, #16222f)"; // cv3 xanh dương
    case "cbz":
      return "linear-gradient(150deg, #3d2c4e, #241831)"; // cv5 tím
    case "cbr":
      return "linear-gradient(150deg, #6b3418, #42200d)"; // cv6 cam nâu
    default:
      return "linear-gradient(150deg, #4a3a20, #2b2110)"; // cv4 nâu
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Bìa sách: truyện CBZ trên máy thì tải lười trang đầu làm ảnh bìa,
 *  còn lại dùng gradient + tên sách theo thiết kế. */
export function BookCover({
  title,
  author,
  format,
  path,
  className,
}: {
  title: string;
  author?: string | null;
  format: string;
  path?: string | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    setImg(null);
    setTried(false);
    if (format.toLowerCase() !== "cbz" || !path) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          api
            .cbzPage(path, 0)
            .then((p) => setImg(p.data_url))
            .catch(() => undefined)
            .finally(() => setTried(true));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [format, path]);

  return (
    <div ref={ref} className={className ?? "cover"} style={{ background: formatGradient(format) }}>
      {img ? (
        <img src={img} alt="" />
      ) : (
        <>
          <div className="cv-title">{title}</div>
          {author ? <div className="cv-author">{author}</div> : null}
        </>
      )}
      <span className="fmt-badge">{format}</span>
    </div>
  );
}

type Filter = "all" | "local" | "telegram" | "opds" | "comic" | "reading";

interface GridItem {
  key: string;
  title: string;
  author: string | null;
  format: string;
  size: number;
  source: "local" | "telegram";
  progress: number | null; // 0..1, null = chưa đọc
  path?: string | null;
  history?: HistoryEntry;
  local?: BookMeta;
}

interface Props {
  localBooks: BookMeta[];
  history: HistoryEntry[];
  /** Đường dẫn các file đã tải về qua OPDS (để lọc chip OPDS). */
  opdsPaths: string[];
  continueBook: HistoryEntry | null;
  onOpenLocal: (m: BookMeta) => void;
  onPickFile: () => void;
  onPickFolder: () => void;
  onResume: (h: HistoryEntry) => void;
  onOpenSources: () => void;
  /** File local bị dời/xóa: chỉ lại đường dẫn mới, giữ nguyên lịch sử. */
  onRelink: (h: HistoryEntry) => void;
  /** Xóa 1 mục khỏi lịch sử đọc (kèm bookmark/gạch chân/phiên của nó). */
  onRemoveHistory: (id: string) => void;
}

/** Thư viện (v0.3.0): thẻ "Tiếp tục đọc" + kệ sách, lọc theo nguồn.
 *  Telegram chỉ hiện sách đã từng đọc (lịch sử); mở lại từ màn Nguồn sách. */
export default function Library({
  localBooks,
  history,
  opdsPaths,
  continueBook,
  onOpenLocal,
  onPickFile,
  onPickFolder,
  onResume,
  onOpenSources,
  onRelink,
  onRemoveHistory,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const reading = useMemo(
    () => history.filter((h) => h.status === "reading"),
    [history],
  );
  const telegramHistory = useMemo(
    () => history.filter((h) => h.source === "telegram"),
    [history],
  );

  const items: GridItem[] = useMemo(() => {
    const byId = new Map<string, HistoryEntry>();
    for (const h of history) byId.set(h.id, h);
    const q = query.trim().toLowerCase();
    const match = (t: string) => !q || t.toLowerCase().includes(q);

    const fromLocal = (m: BookMeta): GridItem => {
      const h = byId.get(`local:${m.path}`);
      return {
        key: `local:${m.path}`,
        title: m.name,
        author: null,
        format: m.format,
        size: m.size,
        source: "local",
        progress: h ? h.percent / 100 : null,
        path: m.path,
        history: h,
        local: m,
      };
    };
    const fromHistory = (h: HistoryEntry): GridItem => ({
      key: `hist:${h.id}`,
      title: h.title,
      author: null,
      format: h.format,
      size: 0,
      source: h.source === "telegram" ? "telegram" : "local",
      progress: h.percent / 100,
      path: h.path,
      history: h,
    });

    let list: GridItem[];
    switch (filter) {
      case "local":
        list = localBooks.map(fromLocal);
        break;
      case "telegram":
        list = telegramHistory.map(fromHistory);
        break;
      case "opds":
        list = localBooks.filter((m) => opdsPaths.includes(m.path)).map(fromLocal);
        break;
      case "comic":
        list = localBooks.filter((m) => isComicFormat(m.format)).map(fromLocal);
        break;
      case "reading":
        list = reading.map(fromHistory);
        break;
      default: {
        // Tất cả: sách máy + sách Telegram chưa có trên máy (không trùng).
        const localPaths = new Set(localBooks.map((m) => m.path));
        const extra = telegramHistory.filter(
          (h) => !(h.path && localPaths.has(h.path)),
        );
        list = [...localBooks.map(fromLocal), ...extra.map(fromHistory)];
        break;
      }
    }
    return list.filter((it) => match(it.title));
  }, [filter, query, localBooks, history, opdsPaths, reading, telegramHistory]);

  const totalCount = localBooks.length + telegramHistory.length;
  const showContinue = continueBook !== null;

  const openItem = (it: GridItem) => {
    if (it.history && !it.history.file_exists && it.source === "local") {
      // File bị dời/xóa: bấm vào để chỉ lại đường dẫn, không mở lỗi.
      onRelink(it.history);
      return;
    }
    if (it.local) {
      onOpenLocal(it.local);
    } else if (it.history) {
      if (it.history.source === "telegram") onOpenSources();
      else onResume(it.history);
    }
  };

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "Tất cả" },
    { id: "local", label: "Máy này" },
    { id: "telegram", label: "Telegram" },
    { id: "opds", label: "OPDS" },
    { id: "comic", label: "Truyện tranh" },
    { id: "reading", label: "Đang đọc dở" },
  ];

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Thư viện</h1>
        <span className="sub">
          {totalCount} cuốn · {localBooks.length} trên máy này
          {telegramHistory.length > 0 ? ` · ${telegramHistory.length} từ Telegram` : ""}
        </span>
        <div className="spacer" />
        <div className="searchbox">
          <span className="sicon">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên sách…"
            aria-label="Tìm tên sách"
          />
        </div>
        <button onClick={onPickFile}>+ Mở 1 file</button>
        <button onClick={onPickFolder}>Thêm thư mục</button>
      </div>

      <div className="chips">
        {chips.map((c) => (
          <button
            key={c.id}
            className={`chip${filter === c.id ? " active" : ""}`}
            onClick={() => setFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {showContinue && (
        <div className="continue-card">
          <div className="cc-body">
            <p className="cc-label">Tiếp tục đọc</p>
            <h2>{continueBook.title}</h2>
            <p className="cc-meta">
              Trang {continueBook.current_page + 1}
              {continueBook.total_pages > 0 ? ` / ${continueBook.total_pages}` : ""}
              {continueBook.chapter ? ` · ${continueBook.chapter}` : ""}
              {` · ${Math.round(continueBook.percent)}%`}
            </p>
            <div className="cc-progress">
              <i style={{ width: `${Math.min(100, Math.max(0, continueBook.percent))}%` }} />
            </div>
            <div className="cc-actions">
              <button className="btn-read" onClick={() => onResume(continueBook)}>
                Đọc tiếp →
              </button>
              <button className="ghost" onClick={() => onRemoveHistory(continueBook.id)}>
                Bỏ khỏi Đang đọc
              </button>
            </div>
          </div>
          <BookCover
            title={continueBook.title}
            format={continueBook.format}
            path={continueBook.source === "telegram" ? null : continueBook.path}
            className="cc-cover"
          />
        </div>
      )}

      <p className="section-title">Trên kệ</p>
      {items.length === 0 ? (
        <div className="empty-note">
          {filter === "telegram"
            ? "Chưa có sách nào từ Telegram. Mở màn Nguồn sách để đăng nhập Telegram rồi tải truyện về."
            : filter === "opds"
              ? "Chưa có sách nào tải qua OPDS. Mở màn Nguồn sách → OPDS để duyệt catalogue."
              : localBooks.length === 0
                ? "Chưa có sách nào. Bấm “Mở 1 file” hoặc “Thêm thư mục” để đưa sách vào kệ."
                : "Không tìm thấy sách nào khớp."}
        </div>
      ) : (
        <div className="book-grid">
          {items.map((it) => (
            <button key={it.key} className="book-card" onClick={() => openItem(it)}>
              <BookCover
                title={it.title}
                author={it.author}
                format={it.format}
                path={it.source === "telegram" ? null : it.path}
              />
              <div className="bk-title">{it.title}</div>
              <div className="bk-meta">
                {it.format.toUpperCase()}
                {it.size > 0 ? ` · ${formatSize(it.size)}` : ""}
                {it.source === "telegram" ? " · Telegram" : ""}
                {it.history && !it.history.file_exists && it.source === "local"
                  ? " · ⚠ Mất file — bấm để chỉ lại"
                  : ""}
              </div>
              {it.progress !== null && it.progress > 0 && (
                <div className="bk-progress">
                  <i style={{ width: `${Math.round(it.progress * 100)}%` }} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import type { BookMeta, HistoryEntry, StatsPerBook, StatsSummary } from "../types";
import StatsView from "./StatsView";
import OpdsPanel from "./OpdsPanel";

interface Props {
  history: HistoryEntry[];
  localBooks: BookMeta[];
  statsSummary: StatsSummary | null;
  statsPerBook: StatsPerBook[];
  onOpenLocal: (b: BookMeta) => void;
  onResume: (h: HistoryEntry) => void;
  onRelink: (h: HistoryEntry) => void;
  onRemoveHistory: (id: string) => void;
  onPickFile: () => void;
  onPickFolder: () => void;
  /** Mở 1 cuốn đã tải từ OPDS về máy (đọc như file local). */
  onOpenDownloaded: (path: string) => void;
}

export default function Library({
  history,
  localBooks,
  statsSummary,
  statsPerBook,
  onOpenLocal,
  onResume,
  onRelink,
  onRemoveHistory,
  onPickFile,
  onPickFolder,
  onOpenDownloaded,
}: Props) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const match = (t: string) => !q || t.toLowerCase().includes(q);
  const reading = history.filter((h) => h.status !== "done" && match(h.title));
  const books = localBooks.filter((b) => match(b.name));
  const resumeById = (bookId: string) => {
    const h = history.find((x) => x.id === bookId);
    if (h) void onResume(h);
  };
  return (
    <div className="library">
      <p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Tìm theo tên sách…"
          style={{ width: "min(420px, 90%)" }}
        />
      </p>
      <section>
        <h2>Đang đọc dở</h2>
        {reading.length === 0 && (
          <p className="muted">
            {q ? "Không có sách nào đang đọc khớp với tìm kiếm." : "Chưa có sách nào đang đọc. Mở 1 cuốn bên dưới là nó vào đây."}
          </p>
        )}
        <ul className="book-list">
          {reading.map((h) => (
            <li key={h.id} className="book-row">
              <div>
                <strong>{h.title}</strong>{" "}
                <span className="muted">
                  {h.format.toUpperCase()} • {h.source === "telegram" ? "Telegram" : "Máy này"} •{" "}
                  {Math.round(h.percent * 100)}% • trang {h.current_page + 1}/{h.total_pages || "?"}
                </span>
                {!h.file_exists && (
                  <span className="warn"> — mất file, chỉ lại đường dẫn</span>
                )}
              </div>
              <div>
                {h.file_exists ? (
                  <button onClick={() => onResume(h)}>Đọc tiếp</button>
                ) : (
                  <button onClick={() => onRelink(h)}>Chỉ lại file</button>
                )}
                <button onClick={() => onRemoveHistory(h.id)}>Xóa</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Sách trên máy này</h2>
        <p>
          <button onClick={onPickFile}>Mở 1 file…</button>{" "}
          <button onClick={onPickFolder}>Thêm cả thư mục…</button>
        </p>
        <p className="muted">
          App chỉ lưu đường dẫn, không copy file. CBZ/CBR/EPUB/PDF/MOBI đọc trực
          tiếp từ file gốc; PDF đọc theo đoạn byte, CBR nạp cả file vào RAM nên
          file RAR rất lớn sẽ nặng máy; MOBI/AZW3 bản không DRM đọc được, bản
          DRM thì app báo rõ.
        </p>
        <ul className="book-list">
          {books.map((b) => (
            <li key={b.id} className="book-row">
              <div>
                <strong>{b.name}</strong>{" "}
                <span className="muted">
                  {b.format.toUpperCase()} • {(b.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              <button onClick={() => onOpenLocal(b)}>Mở</button>
            </li>
          ))}
        </ul>
      </section>

      <StatsView summary={statsSummary} perBook={statsPerBook} onResume={resumeById} />
      <OpdsPanel onOpenDownloaded={onOpenDownloaded} />
    </div>
  );
}

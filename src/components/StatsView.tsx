import { useMemo } from "react";
import type { StatsPerBook, StatsSummary } from "../types";
import { computeStreak, dayNumber, formatDay, formatDuration } from "../lib/stats";

interface Props {
  summary: StatsSummary | null;
  perBook: StatsPerBook[];
  onResume: (bookId: string) => void;
}

/** Thống kê đọc (P2): toàn bộ số liệu local, không tài khoản, không cloud. */
export default function StatsView({ summary, perBook, onResume }: Props) {
  const streak = useMemo(() => {
    if (!summary) return 0;
    return computeStreak(summary.days, dayNumber(Date.now()));
  }, [summary]);

  if (!summary) {
    return (
      <section>
        <h2>Thống kê đọc</h2>
        <p className="muted">Đang tải thống kê…</p>
      </section>
    );
  }

  const daysRead = summary.days.length;
  const maxSeconds = Math.max(1, ...perBook.map((b) => b.seconds));

  return (
    <section>
      <h2>Thống kê đọc</h2>
      {summary.total_sessions === 0 ? (
        <p className="muted">
          Chưa có phiên đọc nào được ghi — mở sách đọc rồi đóng lại là app
          tự ghi vào đây (thời gian, số trang, ngày đọc, streak).
        </p>
      ) : (
        <>
          <p>
            <strong>{formatDuration(summary.total_seconds)}</strong> đã đọc •{" "}
            <strong>{summary.total_pages}</strong> trang •{" "}
            <strong>{summary.books_finished}</strong> cuốn đọc xong •{" "}
            <strong>{daysRead}</strong> ngày đã đọc • chuỗi{" "}
            <strong>{streak} ngày</strong> liên tiếp
            {streak === 0 && daysRead > 0 ? " (hôm nay chưa đọc)" : ""} •{" "}
            {summary.total_sessions} phiên đọc
          </p>
          <ul className="book-list">
            {perBook.map((b) => (
              <li key={b.book_id} className="book-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <strong>{b.title}</strong>{" "}
                    <span className="muted">
                      {formatDuration(b.seconds)} • {b.pages} trang • {b.sessions} phiên
                      {b.finished === 1 ? " • ✓ đã đọc xong" : ""}
                      {b.last_read > 0 ? ` • đọc gần nhất ${formatDay(b.last_read)}` : ""}
                    </span>
                  </div>
                  <div
                    className="stat-bar"
                    style={{ width: `${Math.max(2, Math.round((b.seconds / maxSeconds) * 100))}%` }}
                    title={`${formatDuration(b.seconds)} đã đọc cuốn này`}
                  />
                </div>
                <button onClick={() => onResume(b.book_id)}>Đọc tiếp</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">
        Số liệu chỉ lưu trên máy này (bảng reading_sessions trong SQLite),
        không gửi đi đâu. Ngày đọc tính theo ngày UTC nên streak có thể
        lệch 1 ngày quanh nửa đêm theo giờ Việt Nam.
      </p>
    </section>
  );
}

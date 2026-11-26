import { useMemo } from "react";
import type { HistoryEntry, StatsPerBook, StatsSummary } from "../types";
import {
  computeStreak,
  dayNumber,
  formatDay,
  formatDuration,
  weekdayLabel,
  weekDeltaPct,
  weekTotals,
} from "../lib/stats";

interface Props {
  summary: StatsSummary | null;
  perBook: StatsPerBook[];
  history: HistoryEntry[];
  onResume: (bookId: string) => void;
}

const THUMB_GRADIENTS = [
  "linear-gradient(150deg, #31413a, #1d2925)",
  "linear-gradient(150deg, #5d2320, #38120f)",
  "linear-gradient(150deg, #274156, #16222f)",
  "linear-gradient(150deg, #3d2c4e, #241831)",
  "linear-gradient(150deg, #6b3418, #42200d)",
  "linear-gradient(150deg, #4a3a20, #2b2110)",
];

function thumbGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return THUMB_GRADIENTS[h % THUMB_GRADIENTS.length];
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="sc-delta flat">tuần đầu có số liệu</span>;
  if (pct === 0) return <span className="sc-delta flat">không đổi so với tuần trước</span>;
  const up = pct > 0;
  return (
    <span className={`sc-delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}% so với tuần trước
    </span>
  );
}

/** Thống kê đọc (P2, giao diện v0.3.0): toàn bộ số liệu local, không
 *  tài khoản, không cloud. Biểu đồ 7 ngày + so sánh tuần trước lấy từ
 *  per_day (Rust trả 14 ngày gần nhất). */
export default function StatsView({ summary, perBook, history, onResume }: Props) {
  const today = dayNumber(Date.now());
  const weekStart = today - ((today + 3) % 7); // thứ 2 đầu tuần (ngày UTC)

  const streak = useMemo(
    () => (summary ? computeStreak(summary.days, today) : 0),
    [summary, today],
  );

  const week = useMemo(
    () => weekTotals(summary?.per_day ?? [], weekStart),
    [summary, weekStart],
  );
  const prevWeek = useMemo(
    () => weekTotals(summary?.per_day ?? [], weekStart - 7),
    [summary, weekStart],
  );

  const chartDays = useMemo(() => {
    const perDay = summary?.per_day ?? [];
    const map = new Map(perDay.map((d) => [d.day, d]));
    return Array.from({ length: 7 }, (_, i) => {
      const day = weekStart + i;
      return { day, minutes: Math.round((map.get(day)?.seconds ?? 0) / 60) };
    });
  }, [summary, weekStart]);
  const maxMin = Math.max(1, ...chartDays.map((d) => d.minutes));
  const maxDay = chartDays.reduce((a, b) => (b.minutes > a.minutes ? b : a), chartDays[0]);

  const progressById = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history) m.set(h.id, h.percent);
    return m;
  }, [history]);

  if (!summary) {
    return (
      <div className="screen">
        <div className="screen-head">
          <h1>Thống kê đọc</h1>
        </div>
        <p className="muted">Đang tải thống kê…</p>
      </div>
    );
  }

  const avgPerDay =
    week.activeDays > 0 ? Math.round(week.pages / week.activeDays) : 0;

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Thống kê đọc</h1>
        <span className="sub">
          Tuần này · {summary.total_sessions} phiên đọc · {summary.days.length} ngày đã đọc
          {summary.total_seconds > 0 ? ` · tổng ${formatDuration(summary.total_seconds)}` : ""}
        </span>
      </div>

      {summary.total_sessions === 0 ? (
        <div className="empty-note">
          Chưa có phiên đọc nào được ghi — mở sách đọc rồi đóng lại là app tự
          ghi vào đây (thời gian, số trang, ngày đọc, chuỗi ngày liên tiếp).
        </div>
      ) : (
        <>
          <div className="stat-cards">
            <div className="stat-card">
              <div className="sc-label">Thời gian đọc tuần này</div>
              <div className="sc-value">{formatDuration(week.seconds)}</div>
              <Delta pct={weekDeltaPct(week.seconds, prevWeek.seconds)} />
            </div>
            <div className="stat-card">
              <div className="sc-label">Trang đã đọc tuần này</div>
              <div className="sc-value">{week.pages}</div>
              <Delta pct={weekDeltaPct(week.pages, prevWeek.pages)} />
            </div>
            <div className="stat-card">
              <div className="sc-label">Chuỗi ngày liên tiếp</div>
              <div className="sc-value">{streak} ngày</div>
              <span className="sc-delta flat">
                {streak === 0 && summary.days.length > 0
                  ? "hôm nay chưa đọc"
                  : `${week.activeDays} ngày đọc tuần này`}
              </span>
            </div>
            <div className="stat-card">
              <div className="sc-label">Trung bình / ngày đọc</div>
              <div className="sc-value">{avgPerDay} trang</div>
              <span className="sc-delta flat">
                {summary.books_finished} cuốn đã đọc xong
              </span>
            </div>
          </div>

          <div className="chart-card">
            <h3>7 ngày gần nhất</h3>
            <div className="chart-sub">Số phút đọc mỗi ngày (ngày UTC).</div>
            <div className="chart-bars">
              {chartDays.map((d) => (
                <div className="chart-col" key={d.day}>
                  <span className="bar-val">{d.minutes > 0 ? `${d.minutes}p` : ""}</span>
                  <div
                    className={`bar${d.day === maxDay.day && d.minutes > 0 ? " max" : ""}${d.day === today ? " today" : ""}`}
                    style={{ height: `${Math.max(3, Math.round((d.minutes / maxMin) * 84))}px` }}
                    title={`${weekdayLabel(d.day)}: ${d.minutes} phút`}
                  />
                  <span className="bar-day">{weekdayLabel(d.day)}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="section-title">Theo từng cuốn</p>
          <div className="stat-rows">
            {perBook.map((b) => {
              const pct = Math.round(progressById.get(b.book_id) ?? 0);
              return (
                <button key={b.book_id} className="stat-row" onClick={() => onResume(b.book_id)}>
                  <span className="sr-thumb" style={{ background: thumbGradient(b.book_id) }}>
                    {b.title.trim().charAt(0) || "?"}
                  </span>
                  <span className="sr-main">
                    <span className="sr-title">{b.title}</span>
                    <span className="sr-meta" style={{ display: "block" }}>
                      {formatDuration(b.seconds)} • {b.pages} trang • {b.sessions} phiên
                      {b.finished === 1 ? " • ✓ đã đọc xong" : ""}
                      {b.last_read > 0 ? ` • gần nhất ${formatDay(b.last_read)}` : ""}
                    </span>
                    <span className="sr-bar">
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                  <span className="sr-pct">{pct}%</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className="muted" style={{ marginTop: 16 }}>
        Số liệu chỉ lưu trên máy này (bảng reading_sessions trong SQLite),
        không gửi đi đâu. Ngày đọc tính theo ngày UTC nên streak có thể lệch
        1 ngày quanh nửa đêm theo giờ Việt Nam.
      </p>
    </div>
  );
}

/**
 * Thống kê đọc (P2) — hàm thuần, không cần DOM nên test được bằng Node.
 * Số ngày tính theo ngày UTC (started_at / 86_400_000) để Rust và frontend
 * khớp nhau; chênh lệch múi giờ có thể làm streak lệch 1 ngày quanh nửa
 * đêm — ghi rõ trong README, không giả vờ chính xác tuyệt đối.
 */

export const DAY_MS = 86_400_000;

/** Số ngày (UTC) của 1 mốc epoch ms. */
export function dayNumber(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/**
 * Số ngày đọc liên tiếp (streak) tính tới hôm nay: đếm ngược từ hôm nay,
 * nếu hôm nay chưa đọc thì tính từ hôm qua. `days` là danh sách số ngày
 * đã đọc (không cần sắp xếp, có trùng cũng được).
 */
export function computeStreak(days: number[], todayDay: number): number {
  const set = new Set(days);
  let streak = 0;
  let d = set.has(todayDay) ? todayDay : todayDay - 1;
  while (set.has(d)) {
    streak++;
    d--;
  }
  return streak;
}

/** "3661 giây" -> "1 giờ 1 phút"; "45 giây" -> "45 giây". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h} giờ ${rm} phút` : `${h} giờ`;
}

// ---------- v0.3.0: tổng theo tuần, phục vụ màn hình Thống kê ----------

export interface WeekTotals {
  seconds: number;
  pages: number;
  /** Số ngày trong tuần có đọc. */
  activeDays: number;
}

/** Tổng đọc của 1 tuần: tuần bắt đầu từ `weekStartDay` (số ngày UTC),
 *  dài 7 ngày. `perDay` là StatsDay[] từ stats_summary. */
export function weekTotals(
  perDay: { day: number; seconds: number; pages: number }[],
  weekStartDay: number,
): WeekTotals {
  let seconds = 0;
  let pages = 0;
  let activeDays = 0;
  for (const d of perDay) {
    if (d.day >= weekStartDay && d.day < weekStartDay + 7) {
      seconds += d.seconds;
      pages += d.pages;
      activeDays++;
    }
  }
  return { seconds, pages, activeDays };
}

/** Nhãn ngày trong tuần (tiếng Việt) của 1 số ngày UTC: T2..CN.
 *  Ngày 0 (1970-01-01) là thứ 5 -> day % 7: 0=T5, 1=T6, 2=T7, 3=CN,
 *  4=T2, 5=T3, 6=T4. */
export function weekdayLabel(day: number): string {
  const labels = ["T5", "T6", "T7", "CN", "T2", "T3", "T4"];
  return labels[((day % 7) + 7) % 7];
}

/** % thay đổi tuần này so với tuần trước; null khi tuần trước = 0
 *  (không có gì để so — hiển thị "mới" thay vì 1 con số vô nghĩa). */
export function weekDeltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** "25/11/2026" — ngày đọc cuối của 1 cuốn. */
export function formatDay(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

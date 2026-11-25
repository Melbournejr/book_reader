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

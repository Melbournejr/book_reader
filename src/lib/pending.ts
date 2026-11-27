/** Dedup các lần nạp đang chờ theo key (bản web: pendingRef).
 *  Caller gọi lại trong lúc inflight nhận đúng promise cũ — chờ trang
 *  nạp xong thay vì tiến hành với trang trống (trước đây ensure bỏ qua
 *  trang inflight rồi trả về ngay, nên flip commit trong khi trang đích
 *  chưa có trong cache). */
export class PendingMap {
  private map = new Map<number, Promise<void>>();

  has(key: number): boolean {
    return this.map.has(key);
  }

  get(key: number): Promise<void> | undefined {
    return this.map.get(key);
  }

  delete(key: number): void {
    this.map.delete(key);
  }

  /** Bắt đầu lần nạp mới cho key. Nếu đã có lần nạp đang chờ thì trả
   *  về đúng promise cũ (không nạp lại) — caller chờ lần nạp đó.
   *  Promise tự dọn khỏi map khi xong — chỉ dọn nếu vẫn là lần nạp
   *  hiện tại, tránh lần cũ kết thúc muộn xóa lần mới hơn. */
  start(key: number, run: () => Promise<void>): Promise<void> {
    const existing = this.map.get(key);
    if (existing) return existing;
    const p = run();
    const cleanup = () => {
      if (this.map.get(key) === p) this.map.delete(key);
    };
    p.then(cleanup, cleanup);
    this.map.set(key, p);
    return p;
  }
}

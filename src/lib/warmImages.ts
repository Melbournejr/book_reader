/**
 * Cache giữ sống ảnh đã giải mã (v0.3.12) — chữa "nền đen dưới lá".
 *
 * Cơ chế lỗi (video Thiện gửi 28/11, v0.3.11): lúc lật bắt đầu, mặt
 * nền (base spread) đổi sang trang đích; slot của nó mount một <img>
 * mới với URL mio-page:// của trang đích. Ảnh phải fetch + decode
 * xong mới vẽ được — trong lúc chờ, slot hiện nền `#111` của
 * `.page-img` (đen). Lookahead v0.3.10 đã decode trước bằng
 * `new Image()` + `img.decode()`, nhưng đối tượng Image đó là biến
 * cục bộ, decode xong là thả — GC thu hồi bitmap đã giải mã, lần
 * mount <img> sau lại phải fetch qua protocol + decode lại (mỗi lần
 * ~100–300ms trên file CBZ lớn) nên slot đen tới ~200ms sau khi lật
 * bắt đầu (frame f06/f08 video 28/11). Trang đang lật thì vẽ ngay
 * được vì ảnh của nó vừa hiện trên spread (còn nóng trong cache).
 *
 * Cách chữa: giữ các đối tượng Image đã decode trong cache này
 * (key theo URL — an toàn khi đổi sách vì URL đã chứa đường dẫn
 * file + số trang). Còn tham chiếu sống thì trình duyệt giữ bitmap
 * đã giải mã trong bộ nhớ; <img> mount sau với cùng URL vẽ ngay
 * từ bitmap có sẵn, không fetch/decode lại. Giới hạn LRU (mặc định
 * 8 ảnh: đủ spread hiện tại + lookahead 2 hướng + mặt lá) để bộ
 * nhớ không phình vô hạn — ảnh truyện ~8–15MB/bitmap khi giải mã.
 *
 * Thuần túy (không DOM ngoài Image đã decode xong) nên test số
 * được bằng Node với đối tượng giả (xem test v0312).
 */
export class WarmImageCache {
  private map = new Map<string, HTMLImageElement>();

  constructor(private readonly max = 8) {}

  /** Giữ sống ảnh đã decode xong cho `url` (đưa về cuối = mới nhất). */
  add(url: string, img: HTMLImageElement): void {
    this.map.delete(url);
    this.map.set(url, img);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** Ảnh của `url` còn được giữ sống không (đã decode + chưa bị đẩy). */
  has(url: string): boolean {
    return this.map.has(url);
  }

  get size(): number {
    return this.map.size;
  }
}

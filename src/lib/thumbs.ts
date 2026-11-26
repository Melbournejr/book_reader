/**
 * Thumbnail lưới trang: thu nhỏ ảnh trang thành JPEG nhỏ (mặc định rộng
 * tối đa 240px) + cache có giới hạn, để lưới 2000 trang không ngốn RAM.
 *
 * - Ảnh gốc vẫn nạp đủ (qua loadPage/renderThumb) rồi mới thu nhỏ — với
 *   CBZ mỗi thumb tốn 1 lần giải nén trang, nên chỉ render thumb khi
 *   ô đó cuộn tới gần (IntersectionObserver bên lưới trang).
 * - Cache tối đa 60 thumb (LRU): vượt thì xóa cái cũ nhất. Đang nạp dở
 *   thì gộp chung 1 promise, không nạp trùng.
 */

/** Thu nhỏ data URL ảnh thành thumbnail JPEG. */
export function downscaleDataUrl(dataUrl: string, maxWidth = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxWidth / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("no-2d"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("thumb-load"));
    img.src = dataUrl;
  });
}

export class ThumbCache {
  private map = new Map<number, string>();
  private inflight = new Map<number, Promise<string | null>>();

  constructor(private max = 60) {}

  get size(): number {
    return this.map.size;
  }

  /** Lấy thumb đã cache (đẩy lên mới nhất), hoặc nạp mới qua produce(). */
  load(i: number, produce: () => Promise<string | null>, signal?: AbortSignal): Promise<string | null> {
    const hit = this.map.get(i);
    if (hit) {
      this.map.delete(i);
      this.map.set(i, hit);
      return Promise.resolve(hit);
    }
    const inf = this.inflight.get(i);
    if (inf) return inf;
    const p = produce()
      .then((v) => {
        this.inflight.delete(i);
        if (v && !signal?.aborted) {
          this.map.set(i, v);
          while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) break;
            this.map.delete(oldest);
          }
        }
        return signal?.aborted ? null : v;
      })
      .catch(() => {
        this.inflight.delete(i);
        return null;
      });
    this.inflight.set(i, p);
    return p;
  }

  clear(): void {
    this.map.clear();
    this.inflight.clear();
  }
}

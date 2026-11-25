import { locateOffset } from "./highlights";

/**
 * Đọc thành tiếng (TTS, P2) bằng giọng hệ thống của Windows qua
 * `window.speechSynthesis` (WebView2/Chromium) — không thêm thư viện,
 * không API key, không tài khoản.
 *
 * Giới hạn nói thẳng: chất lượng giọng hoàn toàn phụ thuộc vào giọng
 * Windows đã cài trên máy (mặc định chỉ có tiếng Anh; giọng Việt chỉ
 * có nếu máy đã cài thêm, ví dụ gói ngôn ngữ Vietnamese). Không có
 * giọng offline riêng của app. Đọc câu nào tô câu đó chỉ làm được với
 * sách chữ (EPUB/MOBI, có DOM chữ); PDF chỉ đọc tiếng, không tô câu.
 */

/** Tách text thành câu: giữ dấu câu cuối câu, cắt ở . ! ? … */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Câu = chuỗi không chứa dấu kết câu, rồi tới 1+ dấu kết câu (kèm
  // dấu đóng ngoặc/ngoặc kép nếu có); đoạn cuối không có dấu cũng lấy.
  const parts = clean.match(/[^.!?…]+[.!?…]+["”’)\]]?|[^.!?…]+$/g) ?? [];
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Tìm câu trong text của container, bỏ qua khác biệt khoảng trắng
 * (text bóc từ HTML đã gộp khoảng trắng, text trong DOM thì chưa).
 * Trả về vị trí bắt đầu trong text gốc, -1 nếu không khớp.
 */
export function findLoose(haystack: string, needle: string): number {
  const n = needle.replace(/\s+/g, " ").trim();
  if (!n) return -1;
  const exact = haystack.indexOf(n);
  if (exact >= 0) return exact;
  // Gộp khoảng trắng cả hai bên, ghi lại vị trí gốc của từng ký tự.
  const map: number[] = [];
  let collapsed = "";
  for (let i = 0; i < haystack.length; i++) {
    const c = haystack[i];
    if (/\s/.test(c)) {
      if (collapsed.length > 0 && !collapsed.endsWith(" ")) {
        collapsed += " ";
        map.push(i);
      }
      continue;
    }
    collapsed += c;
    map.push(i);
  }
  const at = collapsed.indexOf(n);
  if (at < 0) return -1;
  return map[at] ?? -1;
}

export type TtsState = "idle" | "playing" | "paused";

export interface TtsCallbacks {
  /** Câu thứ i bắt đầu đọc (để UI tô câu đó). */
  onSentence?: (i: number, sentence: string) => void;
  /** Đọc hết danh sách câu. */
  onDone?: () => void;
  onError?: (msg: string) => void;
}

export class TtsEngine {
  private synth: SpeechSynthesis | null =
    typeof window !== "undefined" && "speechSynthesis" in window
      ? window.speechSynthesis
      : null;
  private sentences: string[] = [];
  private idx = 0;
  private cb: TtsCallbacks = {};
  private stopped = true;

  voiceURI: string | null = null;
  rate = 1;

  get supported(): boolean {
    return this.synth !== null;
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.synth ? this.synth.getVoices() : [];
  }

  /** Đọc 1 danh sách câu theo thứ tự; hết câu thì gọi onDone. */
  speak(sentences: string[], cb: TtsCallbacks): void {
    if (!this.synth) {
      cb.onError?.("Máy này không có giọng đọc (speechSynthesis).");
      return;
    }
    this.stop();
    this.sentences = sentences;
    this.idx = 0;
    this.cb = cb;
    this.stopped = false;
    if (sentences.length === 0) {
      cb.onDone?.();
      return;
    }
    this.speakCurrent();
  }

  private speakCurrent(): void {
    if (!this.synth || this.stopped || this.idx >= this.sentences.length) {
      if (!this.stopped) {
        this.stopped = true;
        this.cb.onDone?.();
      }
      return;
    }
    const sentence = this.sentences[this.idx];
    const u = new SpeechSynthesisUtterance(sentence);
    u.rate = this.rate;
    if (this.voiceURI) {
      const v = this.synth.getVoices().find((x) => x.voiceURI === this.voiceURI);
      if (v) u.voice = v;
    }
    const myIdx = this.idx;
    u.onstart = () => {
      if (!this.stopped && myIdx === this.idx) this.cb.onSentence?.(myIdx, sentence);
    };
    u.onend = () => {
      if (this.stopped || myIdx !== this.idx) return;
      this.idx++;
      this.speakCurrent();
    };
    u.onerror = (e) => {
      // Lỗi ở 1 câu (giọng lỗi, câu quá dài...) thì bỏ qua câu đó,
      // đọc câu tiếp theo thay vì dừng cả chương.
      if (this.stopped || myIdx !== this.idx) return;
      if (e.error === "canceled" || e.error === "interrupted") return;
      this.idx++;
      this.speakCurrent();
    };
    this.synth.speak(u);
  }

  pause(): void {
    this.synth?.pause();
  }

  resume(): void {
    this.synth?.resume();
  }

  stop(): void {
    this.stopped = true;
    this.synth?.cancel();
  }
}

/** Xóa dấu tô câu đang đọc trong container. */
export function clearTtsMark(container: HTMLElement): void {
  container.querySelectorAll("mark.tts-current").forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

/**
 * Tô câu đang đọc trong container (kiểu gạch chân P1). `from` là vị trí
 * bắt đầu tìm (để câu lặp lại trong chương thì tô đúng câu tiếp theo).
 * Trả về vị trí kết thúc của câu trong text container, null nếu không tìm thấy.
 */
export function markTtsSentence(
  container: HTMLElement,
  sentence: string,
  from = 0,
): number | null {
  clearTtsMark(container);
  const text = container.textContent ?? "";
  // Cắt tìm trong phần text từ `from` trở đi, rồi cộng lại vị trí gốc.
  const sub = text.slice(from);
  const rel = findLoose(sub, sentence);
  if (rel < 0) return null;
  const start = from + rel;
  const end = start + sentence.trim().length;
  const s = locateOffset(container, start);
  const e = locateOffset(container, Math.min(end, text.length));
  if (!s || !e) return null;
  try {
    const range = document.createRange();
    range.setStart(s.node, s.off);
    range.setEnd(e.node, e.off);
    const mark = document.createElement("mark");
    mark.className = "tts-current";
    range.surroundContents(mark);
    mark.scrollIntoView({ block: "center" });
    return end;
  } catch {
    return null;
  }
}

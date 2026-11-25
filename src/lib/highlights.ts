import { HIGHLIGHT_COLORS, type Highlight } from "../types";

/**
 * Gạch chân chữ trong chương EPUB/MOBI (DOM thật trong WebView).
 *
 * Vị trí lưu trong DB là offset tuyệt đối trong text thuần của chương
 * (tính bằng Range API lúc bôi đen). Khi hiển thị lại, đổi offset thành
 * (text node, offset trong node) rồi bọc bằng <mark> — text gốc không
 * đổi nên offset vẫn đúng dù HTML có thẻ lồng nhau.
 *
 * Giới hạn: highlight nào chồng lấn nhau hoặc lệch offset (chương đã
 * đổi) thì bỏ qua lặng lẽ, không làm hỏng trang.
 */

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) out.push(n);
  return out;
}

/** Đổi offset tuyệt đối trong text của container thành (node, offset). */
export function locateOffset(root: Node, abs: number): { node: Text; off: number } | null {
  let acc = 0;
  for (const t of textNodes(root)) {
    const len = t.data.length;
    if (abs <= acc + len) return { node: t, off: Math.min(Math.max(0, abs - acc), len) };
    acc += len;
  }
  return null;
}

/**
 * Vị trí (start, end) của vùng bôi đen hiện tại trong container, tính
 * theo text thuần — dùng Range đã chọn + 1 Range phụ đo từ đầu container.
 */
export function selectionOffsets(container: HTMLElement): {
  start: number;
  end: number;
  text: string;
} | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const text = range.toString();
  if (!text.trim()) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + text.length, text };
}

export function colorFor(color: string): string {
  return HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS.yellow;
}

/** Bỏ hết <mark.hl> cũ trong container, trả text về nguyên trạng. */
function clearHighlightMarks(container: HTMLElement): void {
  container.querySelectorAll("mark.hl").forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

/** Vẽ lại các highlight của 1 chương lên DOM (gọi sau mỗi lần render chương). */
export function applyHighlights(container: HTMLElement, highlights: Highlight[]): void {
  clearHighlightMarks(container);
  for (const h of highlights) {
    try {
      const s = locateOffset(container, h.start_off);
      const e = locateOffset(container, h.end_off);
      if (!s || !e || h.end_off <= h.start_off) continue;
      const range = document.createRange();
      range.setStart(s.node, s.off);
      range.setEnd(e.node, e.off);
      const mark = document.createElement("mark");
      mark.className = "hl";
      mark.dataset.id = String(h.id);
      mark.style.backgroundColor = colorFor(h.color);
      if (h.note) mark.title = h.note;
      range.surroundContents(mark);
    } catch {
      // Chồng lấn / lệch offset -> bỏ qua highlight này, trang vẫn đọc được.
    }
  }
}

/** Đánh dấu lần xuất hiện đầu tiên của query trong container (kết quả tìm). */
export function markSearchHit(container: HTMLElement, query: string): HTMLElement | null {
  clearSearchHit(container);
  const text = container.textContent ?? "";
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0 || !query.trim()) return null;
  const s = locateOffset(container, idx);
  const e = locateOffset(container, idx + query.length);
  if (!s || !e) return null;
  try {
    const range = document.createRange();
    range.setStart(s.node, s.off);
    range.setEnd(e.node, e.off);
    const mark = document.createElement("mark");
    mark.className = "search-hit";
    range.surroundContents(mark);
    return mark;
  } catch {
    return null;
  }
}

/** Xóa đánh dấu tìm kiếm trong container. */
export function clearSearchHit(container: HTMLElement): void {
  container.querySelectorAll("mark.search-hit").forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

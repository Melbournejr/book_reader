/**
 * Tra từ điển (P2) — API miễn phí, không cần key, không kèm file từ điển.
 * - Tiếng Anh: dictionaryapi.dev (free, không key).
 * - Tiếng Việt / từ không có trong API: mở Wiktionary trên trình duyệt.
 * Mất mạng hoặc API lỗi thì báo rõ, không crash app.
 */

export interface DictDefinition {
  definition: string;
  example?: string;
}

export interface DictMeaning {
  partOfSpeech: string;
  definitions: DictDefinition[];
}

export interface DictResult {
  word: string;
  phonetic?: string;
  meanings: DictMeaning[];
  sourceUrl: string;
}

/** Bóc JSON của dictionaryapi.dev thành DictResult — hàm thuần, test được. */
export function parseDictionaryJson(json: unknown, fallbackWord: string): DictResult | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const first = json[0] as Record<string, unknown>;
  const meanings: DictMeaning[] = [];
  const rawMeanings = first.meanings;
  if (Array.isArray(rawMeanings)) {
    for (const m of rawMeanings) {
      const mm = m as Record<string, unknown>;
      const defs: DictDefinition[] = [];
      if (Array.isArray(mm.definitions)) {
        for (const d of mm.definitions.slice(0, 3)) {
          const dd = d as Record<string, unknown>;
          if (typeof dd.definition === "string" && dd.definition.trim()) {
            defs.push({
              definition: dd.definition,
              example: typeof dd.example === "string" ? dd.example : undefined,
            });
          }
        }
      }
      if (defs.length > 0) {
        meanings.push({
          partOfSpeech: typeof mm.partOfSpeech === "string" ? mm.partOfSpeech : "",
          definitions: defs,
        });
      }
    }
  }
  if (meanings.length === 0) return null;
  const phonetics = first.phonetic;
  return {
    word: typeof first.word === "string" ? first.word : fallbackWord,
    phonetic:
      typeof phonetics === "string" && phonetics.trim() ? phonetics : undefined,
    meanings,
    sourceUrl: `https://dictionaryapi.dev/`,
  };
}

export type DictError = "empty" | "not-found" | "offline" | "http";

/** Tra 1 từ tiếng Anh qua dictionaryapi.dev (timeout 8s). */
export async function lookupDictionary(
  word: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; result: DictResult } | { ok: false; error: DictError }> {
  const w = word.trim();
  if (!w) return { ok: false, error: "empty" };
  // Từ điển này chỉ có tiếng Anh: từ có dấu tiếng Việt thì báo thẳng.
  if (/[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(w)) {
    return { ok: false, error: "not-found" };
  }
  try {
    const res = await fetchFn(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w.toLowerCase())}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { ok: false, error: res.status === 404 ? "not-found" : "http" };
    const json: unknown = await res.json();
    const parsed = parseDictionaryJson(json, w);
    if (!parsed) return { ok: false, error: "not-found" };
    return { ok: true, result: parsed };
  } catch {
    return { ok: false, error: "offline" };
  }
}

/** Link tra từ trên Wiktionary (mở bằng trình duyệt ngoài). */
export function wiktionaryUrl(word: string, lang: "vi" | "en"): string {
  const host = lang === "vi" ? "vi.wiktionary.org" : "en.wiktionary.org";
  return `https://${host}/wiki/${encodeURIComponent(word.trim())}`;
}

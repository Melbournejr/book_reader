import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { lookupDictionary, wiktionaryUrl } from "../lib/dictionary";

interface Props {
  /** Từ đang tra (từ đoạn bôi đen trong sách, hoặc nhập tay). */
  word: string;
  onWordChange: (w: string) => void;
}

/** Tra từ điển (P2): API miễn phí dictionaryapi.dev (tiếng Anh) +
 *  link Wiktionary tiếng Việt. Mất mạng/API lỗi thì báo rõ, không crash. */
export default function DictionaryBox({ word, onWordChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; word: string; phonetic?: string; meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[] }
    | { kind: "error"; error: string }
    | null
  >(null);

  const lookup = async (w: string) => {
    const clean = w.trim();
    if (!clean) return;
    setLoading(true);
    setResult(null);
    const r = await lookupDictionary(clean);
    setLoading(false);
    if (r.ok) {
      setResult({ kind: "ok", ...r.result });
    } else {
      setResult({
        kind: "error",
        error:
          r.error === "not-found"
            ? `Không tìm thấy “${clean}” trong từ điển tiếng Anh (dictionaryapi.dev). Từ tiếng Việt thì bấm link Wiktionary bên dưới.`
            : r.error === "offline"
              ? "Không tra được — mất mạng hoặc API từ điển không trả lời. Kiểm tra mạng rồi thử lại, hoặc bấm link Wiktionary bên dưới."
              : "Từ điển trả lỗi, thử lại sau.",
      });
    }
  };

  const openLink = (url: string) => {
    void openUrl(url).catch(() => window.open(url, "_blank"));
  };

  return (
    <div className="dict-box">
      <p>
        <input
          value={word}
          onChange={(e) => onWordChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void lookup(word);
          }}
          placeholder="Nhập từ cần tra (tiếng Anh)…"
          style={{ width: "min(280px, 70%)" }}
        />{" "}
        <button onClick={() => void lookup(word)} disabled={loading || !word.trim()}>
          {loading ? "Đang tra…" : "Tra từ"}
        </button>
      </p>
      {result?.kind === "ok" && (
        <div>
          <p>
            <strong>{result.word}</strong>
            {result.phonetic ? ` /${result.phonetic}/` : ""}
          </p>
          {result.meanings.map((m, i) => (
            <div key={i}>
              {m.partOfSpeech && <p className="muted">{m.partOfSpeech}</p>}
              <ol>
                {m.definitions.map((d, j) => (
                  <li key={j}>
                    {d.definition}
                    {d.example ? <div className="muted">VD: “{d.example}”</div> : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {result?.kind === "error" && <p className="warn">{result.error}</p>}
      {word.trim() && (
        <p className="muted">
          Tra thêm trên Wiktionary:{" "}
          <button className="linklike" onClick={() => openLink(wiktionaryUrl(word, "vi"))}>
            tiếng Việt
          </button>{" "}
          •{" "}
          <button className="linklike" onClick={() => openLink(wiktionaryUrl(word, "en"))}>
            tiếng Anh
          </button>
        </p>
      )}
      <p className="muted">
        Từ điển tiếng Anh lấy từ dictionaryapi.dev (miễn phí, cần mạng).
        Không có từ điển offline kèm theo app.
      </p>
    </div>
  );
}

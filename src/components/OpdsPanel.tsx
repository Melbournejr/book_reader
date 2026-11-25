import { useState } from "react";
import { api } from "../lib/api";
import { bytesToB64 } from "../lib/files";
import {
  fetchOpdsFeed,
  friendlyOpdsError,
  guessExt,
  sanitizeFilename,
  searchOpdsFeed,
  type OpdsAcquisition,
  type OpdsAuth,
  type OpdsEntry,
  type OpdsFeed,
} from "../lib/opds";

interface Props {
  /** Sau khi tải xong 1 cuốn: mở đọc như file local. */
  onOpenDownloaded: (path: string) => void;
}

/**
 * OPDS (P2): duyệt catalogue sách từ server Calibre/Kavita/Komga...
 * (v1 Atom XML + v2 JSON, HTTP Basic). Tải sách về thư mục user chọn,
 * rồi đọc như file local — không clone vào app.
 */
export default function OpdsPanel({ onOpenDownloaded }: Props) {
  const [url, setUrl] = useState(() => {
    try {
      return localStorage.getItem("mio-opds-url") ?? "";
    } catch {
      return "";
    }
  });
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [feed, setFeed] = useState<OpdsFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<{ title: string; path: string } | null>(null);

  const auth: OpdsAuth | undefined = user.trim()
    ? { user: user.trim(), pass }
    : undefined;

  const browse = async (target: string) => {
    const u = target.trim();
    if (!u) return;
    setLoading(true);
    setError("");
    setDownloaded(null);
    try {
      const f = await fetchOpdsFeed(u, auth);
      setFeed(f);
      setUrl(u);
      try {
        localStorage.setItem("mio-opds-url", u);
      } catch {
        // Bỏ qua lỗi lưu URL.
      }
    } catch (e) {
      setError(friendlyOpdsError(e));
    } finally {
      setLoading(false);
    }
  };

  const search = async () => {
    if (!feed || !searchQuery.trim()) return;
    setLoading(true);
    setError("");
    try {
      const f = await searchOpdsFeed(feed, searchQuery.trim(), auth);
      setFeed(f);
    } catch (e) {
      setError(friendlyOpdsError(e));
    } finally {
      setLoading(false);
    }
  };

  const download = async (entry: OpdsEntry, acq: OpdsAcquisition) => {
    setDownloading(entry.title);
    setError("");
    setDownloaded(null);
    try {
      const res = await fetch(acq.url, {
        headers: auth?.user
          ? { Authorization: `Basic ${btoa(`${auth.user}:${auth.pass}`)}` }
          : {},
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error("OPDS_AUTH");
      }
      if (!res.ok) throw new Error("OPDS_MANG");
      const blob = await res.blob();
      const folder = await api.pickFolder();
      if (!folder) {
        setDownloading(null);
        return;
      }
      const ext = guessExt(acq.type, acq.url);
      const name = sanitizeFilename(entry.title) + ext;
      const path = `${folder}/${name}`;
      const buf = new Uint8Array(await blob.arrayBuffer());
      await api.saveBytes(path, bytesToB64(buf));
      setDownloaded({ title: entry.title, path });
    } catch (e) {
      setError(friendlyOpdsError(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <section>
      <h2>OPDS — kéo sách từ server</h2>
      <p className="muted">
        Dán URL catalogue OPDS của server mày (Calibre, Kavita, Komga...),
        ví dụ <code>http://192.168.1.10:8080/opds</code>. App duyệt mục, tìm
        kiếm (nếu server hỗ trợ) và tải sách về thư mục mày chọn — sách tải
        về đọc như file local bình thường. Chỉ hỗ trợ đăng nhập HTTP Basic;
        server nào không gửi CORS thì WebView không đọc được catalogue.
      </p>
      <p>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void browse(url);
          }}
          placeholder="URL catalogue OPDS, VD: http://192.168.1.10:8080/opds"
          style={{ width: "min(520px, 90%)" }}
        />{" "}
        <button onClick={() => void browse(url)} disabled={loading || !url.trim()}>
          {loading ? "Đang tải…" : "Duyệt catalogue"}
        </button>
      </p>
      <p>
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="Tên đăng nhập (nếu server yêu cầu)"
          style={{ width: "min(220px, 45%)" }}
        />{" "}
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="Mật khẩu"
          style={{ width: "min(220px, 45%)" }}
        />
      </p>
      {error && <p className="warn">{error}</p>}

      {feed && (
        <div>
          <p>
            <strong>{feed.title}</strong>
            {feed.nav.length > 0 && (
              <>
                {" — "}
                {feed.nav.map((n, i) => (
                  <span key={`${n.href}-${i}`}>
                    {i > 0 ? " • " : ""}
                    <button className="linklike" onClick={() => void browse(n.href)}>
                      {n.title}
                    </button>
                  </span>
                ))}
              </>
            )}
          </p>
          {feed.searchTemplate && (
            <p>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void search();
                }}
                placeholder="Tìm trong catalogue…"
                style={{ width: "min(320px, 70%)" }}
              />{" "}
              <button onClick={() => void search()} disabled={loading || !searchQuery.trim()}>
                Tìm
              </button>
            </p>
          )}
          {feed.entries.length === 0 && !loading && (
            <p className="muted">Catalogue này không có sách nào ở mục này — thử bấm vào 1 mục ở trên.</p>
          )}
          <ul className="book-list">
            {feed.entries.map((entry, i) => (
              <li key={`${entry.title}-${i}`} className="book-row">
                <div>
                  <strong>{entry.title}</strong>{" "}
                  {entry.author && <span className="muted">— {entry.author}</span>}
                  {entry.summary && (
                    <div className="muted">
                      {entry.summary.length > 160 ? entry.summary.slice(0, 160) + "…" : entry.summary}
                    </div>
                  )}
                </div>
                <div>
                  {entry.acquisitions.length === 0 ? (
                    <span className="muted">Không có link tải</span>
                  ) : (
                    entry.acquisitions.map((acq, j) => (
                      <button
                        key={`${acq.url}-${j}`}
                        disabled={downloading !== null}
                        onClick={() => void download(entry, acq)}
                      >
                        {downloading === entry.title
                          ? "Đang tải…"
                          : `Tải ${acq.title ?? acq.type.split("/").pop() ?? "sách"}`}
                      </button>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
          {downloaded && (
            <p>
              Đã tải “{downloaded.title}” về <code>{downloaded.path}</code>{" "}
              <button onClick={() => onOpenDownloaded(downloaded.path)}>Mở sách này</button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

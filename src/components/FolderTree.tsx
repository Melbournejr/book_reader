import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { BookMeta, FolderEntry } from "../types";

/**
 * Màn "Thư mục" (v0.3.3): duyệt thư mục truyện theo từng tầng như cây
 * thư mục trong Explorer — thư mục con trước, rồi tới file sách trong
 * thư mục đó. Mở thư mục to không còn đổ tất cả sách vào 1 danh sách
 * phẳng nữa; bấm vào thư mục để đi vào, bấm vào sách để mở đọc.
 */

function formatSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export default function FolderTree({
  root,
  onPickFolder,
  onOpenLocal,
}: {
  root: string | null;
  onPickFolder: () => void;
  onOpenLocal: (meta: BookMeta) => void;
}) {
  const [path, setPath] = useState<string | null>(root);
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Đổi thư mục gốc ngoài màn này (chọn lại ở Nguồn sách) thì theo luôn.
  useEffect(() => {
    setPath(root);
  }, [root]);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .listFolder(path)
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  // Breadcrumb: gốc -> ... -> thư mục hiện tại.
  const crumbs = useMemo(() => {
    if (!root || !path) return [];
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const r = norm(root);
    const c = norm(path);
    if (c === r) return [{ label: baseName(r), path: r }];
    const rel = c.startsWith(r + "/") ? c.slice(r.length + 1) : c;
    const segs = rel.split("/").filter(Boolean);
    const out = [{ label: baseName(r), path: r }];
    let acc = r;
    for (const s of segs) {
      acc += "/" + s;
      out.push({ label: s, path: acc });
    }
    return out;
  }, [root, path]);

  const goUp = useCallback(() => {
    if (!path || !root) return;
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    if (norm(path) === norm(root)) return;
    const parent = norm(path).split("/").slice(0, -1).join("/") || root;
    setPath(parent);
  }, [path, root]);

  if (!root) {
    return (
      <div className="ft-wrap">
        <h1>Thư mục</h1>
        <p className="ft-empty">
          Chưa chọn thư mục truyện. Chọn thư mục gốc (ví dụ: Truyện tranh),
          rồi duyệt từng tầng thư mục con để mở sách.
        </p>
        <button className="btn" onClick={onPickFolder}>
          Chọn thư mục truyện
        </button>
      </div>
    );
  }

  const folders = entries.filter((e) => e.is_folder);
  const books = entries.filter((e) => !e.is_folder);

  return (
    <div className="ft-wrap">
      <div className="ft-head">
        <h1>Thư mục</h1>
        <button className="btn" onClick={onPickFolder}>
          Đổi thư mục gốc
        </button>
      </div>

      <div className="ft-crumbs">
        {crumbs.length > 1 && (
          <button className="ft-up" onClick={goUp} aria-label="Lên 1 tầng">
            ← Lên
          </button>
        )}
        {crumbs.map((c, i) => (
          <span key={c.path}>
            {i > 0 && <span className="ft-sep">/</span>}
            {i === crumbs.length - 1 ? (
              <span className="ft-crumb-now">{c.label}</span>
            ) : (
              <button className="ft-crumb" onClick={() => setPath(c.path)}>
                {c.label}
              </button>
            )}
          </span>
        ))}
      </div>

      {loading ? (
        <p className="ft-empty">Đang liệt kê…</p>
      ) : error ? (
        <p className="ft-empty">Không mở được thư mục này: {error}</p>
      ) : entries.length === 0 ? (
        <p className="ft-empty">Thư mục này trống (không có thư mục con hay sách).</p>
      ) : (
        <div className="ft-list">
          {folders.length > 0 && (
            <div className="ft-group">Thư mục · {folders.length}</div>
          )}
          {folders.map((f) => (
            <button
              key={f.path}
              className="ft-row ft-folder"
              onClick={() => setPath(f.path)}
            >
              <span className="ft-ico">📁</span>
              <span className="ft-name">{f.name}</span>
              <span className="ft-go">›</span>
            </button>
          ))}
          {books.length > 0 && (
            <div className="ft-group">Sách · {books.length}</div>
          )}
          {books.map((b) => (
            <button
              key={b.path}
              className="ft-row ft-book"
              onClick={() => b.meta && onOpenLocal(b.meta)}
            >
              <span className="ft-badge">{(b.meta?.format ?? "?").toUpperCase()}</span>
              <span className="ft-name">{b.name}</span>
              <span className="ft-size">
                {b.meta ? formatSize(b.meta.size) : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

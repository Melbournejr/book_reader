// Kiểm tra bản mới kiểu OTA qua GitHub Releases — KHÔNG cần ký số.
// Cách chạy: mỗi lần push tag vX.Y.Z lên repo là GitHub Actions tạo 1
// Release kèm file .msi/.exe; app so tag mới nhất với version hiện tại
// rồi báo cho user tải về cài đè. Đây là thông báo + tải về, KHÔNG phải
// tự cài lặng lẽ (muốn tự cài lặng lẽ phải dùng tauri-plugin-updater,
// cần cặp khóa ký tạo bằng `tauri signer generate` + secret
// TAURI_SIGNING_PRIVATE_KEY trên GitHub — chưa làm ở bước này).

export const APP_VERSION = "0.3.4"; // giữ đồng bộ với package.json

const RELEASES_URL =
  "https://api.github.com/repos/Melbournejr/book_reader/releases/latest";

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string | null;
  notes: string | null;
  /** Link tải file .msi của bản mới; fallback là trang Release. */
  downloadUrl: string | null;
  /** "ok" = đã kiểm tra xong; "unavailable" = không kiểm tra được lúc này
   * (mất mạng, repo private, API GitHub lỗi...) — app không được crash. */
  status: "ok" | "unavailable";
}

function norm(v: string): string {
  return v.trim().replace(/^v/i, "");
}

/** So sánh 2 version dạng x.y.z (thiếu phần thì coi như 0). */
function isNewer(latest: string, current: string): boolean {
  const a = norm(latest).split(".").map((n) => parseInt(n, 10) || 0);
  const b = norm(current).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseJson {
  tag_name?: string;
  body?: string | null;
  html_url?: string;
  assets?: ReleaseAsset[];
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const unavailable: UpdateInfo = {
    hasUpdate: false,
    latestVersion: null,
    notes: null,
    downloadUrl: null,
    status: "unavailable",
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(RELEASES_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return unavailable; // 404 = chưa có Release / repo private
    const rel = (await res.json()) as ReleaseJson;
    const tag = rel.tag_name ?? "";
    if (!tag) return unavailable;
    const latest = norm(tag);
    const msi = rel.assets?.find((a) => a.name.toLowerCase().endsWith(".msi"));
    const exe = rel.assets?.find((a) => a.name.toLowerCase().endsWith(".exe"));
    return {
      hasUpdate: isNewer(latest, APP_VERSION),
      latestVersion: latest,
      notes: rel.body ?? null,
      downloadUrl: msi?.browser_download_url ?? exe?.browser_download_url ?? rel.html_url ?? null,
      status: "ok",
    };
  } catch {
    return unavailable;
  }
}

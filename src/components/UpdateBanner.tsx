import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { APP_VERSION, checkForUpdate, type UpdateInfo } from "../lib/update";

/** Banner + nút kiểm tra bản mới (OTA kiểu GitHub Releases).
 * Tự kiểm tra 1 lần khi mở app; có bản mới thì hiện banner để tải .msi
 * về cài đè. Mất mạng / chưa có Release thì im lặng, không làm phiền. */
export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const runCheck = useCallback(async (silent: boolean) => {
    setChecking(true);
    const r = await checkForUpdate();
    setChecking(false);
    setInfo(r);
    if (r.status === "unavailable") {
      if (!silent) setMsg("Không kiểm tra được lúc này — thử lại sau.");
    } else if (!r.hasUpdate) {
      if (!silent) setMsg(`Mày đang dùng bản mới nhất (v${APP_VERSION}).`);
    } else {
      setMsg("");
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    void runCheck(true);
  }, [runCheck]);

  const openDownload = async () => {
    if (!info?.downloadUrl) return;
    try {
      await openUrl(info.downloadUrl);
    } catch {
      window.open(info.downloadUrl, "_blank", "noopener");
    }
  };

  return (
    <div>
      {info?.hasUpdate && !dismissed && (
        <p className="update-banner">
          Có bản mới v{info.latestVersion} (mày đang dùng v{APP_VERSION}).
          <button onClick={() => void openDownload()}>Tải về</button>
          <button onClick={() => setDismissed(true)}>Để sau</button>
        </p>
      )}
      <p className="muted">
        <button onClick={() => void runCheck(false)} disabled={checking}>
          {checking ? "Đang kiểm tra…" : "Kiểm tra cập nhật"}
        </button>{" "}
        v{APP_VERSION}
        {msg && <span> — {msg}</span>}
      </p>
    </div>
  );
}

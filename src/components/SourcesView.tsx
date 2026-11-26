import { lazy, Suspense, useState } from "react";
import type { TelegramClient } from "telegram";
import type { TelegramFile } from "../types";
import OpdsPanel from "./OpdsPanel";

// Telegram (GramJS) KHÔNG import tĩnh: chỉ nạp khi mở thẻ Telegram
// (xem App.tsx — import tĩnh làm cả app trắng màn hình ở bản 0.1.0).
const TelegramPanel = lazy(() => import("./TelegramPanel"));

interface Props {
  localFolder: string | null;
  localCount: number;
  onPickFolder: () => void;
  onOpenTelegramBook: (f: TelegramFile, client: TelegramClient) => void;
  onOpenDownloaded: (path: string) => Promise<void>;
}

/** Màn Nguồn sách (v0.3.0): 3 thẻ nguồn theo thiết kế — Telegram, OPDS,
 *  thư mục trên máy. Bấm Mở/Duyệt thì mở panel ngay dưới lưới thẻ. */
export default function SourcesView({
  localFolder,
  localCount,
  onPickFolder,
  onOpenTelegramBook,
  onOpenDownloaded,
}: Props) {
  const [openPanel, setOpenPanel] = useState<"telegram" | "opds" | null>(null);
  const [tgConnected, setTgConnected] = useState(false);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Nguồn sách</h1>
        <span className="sub">Telegram · OPDS · thư mục trên máy — sách chỉ lưu đường dẫn, không nhân bản file.</span>
        <div className="spacer" />
        <button
          onClick={() => setOpenPanel(openPanel === "opds" ? null : "opds")}
        >
          + Thêm nguồn OPDS
        </button>
      </div>

      <div className="src-cards">
        <div className="src-card">
          <span className="src-ic" style={{ background: "#274156" }}>✈</span>
          <h3>Telegram</h3>
          <p>
            Kho truyện trong Saved Messages: không giới hạn tổng dung lượng,
            2 GB/file (free). Đọc theo đoạn byte, không cần tải cả file về.
          </p>
          <span className="src-status">
            <span className={`dot${tgConnected ? "" : " off"}`} />
            {tgConnected ? "Đã kết nối" : "Chưa kết nối"}
          </span>
          <div className="src-actions">
            <button
              className="primary"
              onClick={() => setOpenPanel(openPanel === "telegram" ? null : "telegram")}
            >
              {openPanel === "telegram" ? "Đóng" : "Mở"}
            </button>
          </div>
        </div>

        <div className="src-card">
          <span className="src-ic" style={{ background: "#bc3a17" }}>🌐</span>
          <h3>Catalogue OPDS</h3>
          <p>
            Duyệt thư viện sách online chuẩn OPDS (Kavita, Komga, Calibre…),
            tải về máy rồi đọc như sách local.
          </p>
          <span className="src-status">
            <span className="dot off" />
            Duyệt qua mạng, cần server hỗ trợ CORS
          </span>
          <div className="src-actions">
            <button
              className="primary"
              onClick={() => setOpenPanel(openPanel === "opds" ? null : "opds")}
            >
              {openPanel === "opds" ? "Đóng" : "Duyệt"}
            </button>
          </div>
        </div>

        <div className="src-card">
          <span className="src-ic" style={{ background: "#4a3a20" }}>📁</span>
          <h3>Thư mục trên máy</h3>
          <p>
            Sách đọc trực tiếp từ ổ cứng, không nhân bản. Đổi thư mục để quét
            lại kệ.
          </p>
          <span className="src-status">
            <span className="dot" />
            {localFolder ? `${localCount} cuốn` : "Chưa chọn thư mục"}
          </span>
          <div className="src-actions">
            <button onClick={onPickFolder}>Đổi thư mục</button>
          </div>
          {localFolder && (
            <p className="muted" style={{ wordBreak: "break-all" }}>{localFolder}</p>
          )}
        </div>

        {openPanel === "telegram" && (
          <div className="src-panel">
            <Suspense fallback={<p className="muted">Đang tải tab Telegram…</p>}>
              <TelegramPanel
                onOpenTelegramBook={onOpenTelegramBook}
                onConnectedChange={setTgConnected}
              />
            </Suspense>
          </div>
        )}
        {openPanel === "opds" && (
          <div className="src-panel">
            <OpdsPanel onOpenDownloaded={onOpenDownloaded} />
          </div>
        )}
      </div>
    </div>
  );
}

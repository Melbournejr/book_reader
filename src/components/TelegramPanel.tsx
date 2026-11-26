import { useState } from "react";
import type { TelegramClient } from "telegram";
import type { TelegramFile } from "../types";

// GramJS KHÔNG import tĩnh: nó cần Node (net/socket) mà WebView không có,
// import tĩnh làm cả app trắng màn hình (bản 0.1.0). Chỉ nạp khi bấm Kết nối,
// nạp lỗi thì chỉ tab Telegram báo lỗi, thư viện local vẫn chạy.
type TelegramLib = typeof import("../lib/telegram");
let tgLib: TelegramLib | null = null;
async function loadTelegram(): Promise<TelegramLib> {
  if (!tgLib) tgLib = await import("../lib/telegram");
  return tgLib;
}

function telegramLoadError(e: unknown): string {
  const msg = String(e);
  if (msg.includes("Failed to fetch dynamically imported module") || msg.includes("Loading chunk")) {
    return "Không tải được thư viện Telegram trong app (GramJS cần môi trường Node) — tab Telegram tạm chưa dùng được, thư viện sách local vẫn đọc bình thường.";
  }
  return `Lỗi: ${msg}`;
}

interface Props {
  onOpenTelegramBook: (f: TelegramFile, client: TelegramClient) => void;
  /** Báo cho màn Nguồn sách biết đã kết nối (để chấm xanh trên thẻ). */
  onConnectedChange?: (connected: boolean) => void;
}

/**
 * Nguồn Telegram (MTProto). Người dùng tự nhập api_id/api_hash lấy ở
 * my.telegram.org, đăng nhập bằng số điện thoại + mã + 2FA.
 * Credential lưu mã hóa AES-GCM bằng passphrase của họ, không hardcode,
 * không gửi lên GitHub, không gửi cho ai.
 */
export default function TelegramPanel({ onOpenTelegramBook, onConnectedChange }: Props) {
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [client, setClient] = useState<TelegramClient | null>(null);
  const [files, setFiles] = useState<TelegramFile[]>([]);
  const [status, setStatus] = useState("");
  const [needs2FA, setNeeds2FA] = useState(false);

  const connect = async () => {
    try {
      setStatus("Đang kết nối Telegram…");
      const tg = await loadTelegram();
      const saved = passphrase ? await tg.loadCredentials(passphrase) : null;
      const id = saved?.apiId ?? Number(apiId);
      const hash = saved?.apiHash ?? apiHash;
      const c = tg.createClient(id, hash, saved?.session ?? "");
      await c.connect();
      if (saved?.session) {
        setClient(c);
        setStatus("Đã đăng nhập bằng session đã lưu.");
        await refresh(c);
        return;
      }
      const hashCode = await tg.sendLoginCode(c, phone);
      setPhoneCodeHash(hashCode);
      setClient(c);
      setStatus("Đã gửi mã về điện thoại mày, nhập mã bên dưới.");
    } catch (e) {
      setStatus(telegramLoadError(e));
    }
  };

  const confirmCode = async () => {
    if (!client) return;
    try {
      const tg = await loadTelegram();
      const session = await tg.signInWithCode(client, phone, phoneCodeHash, code);
      await tg.saveCredentials(passphrase || "doc-sach", Number(apiId), apiHash, session);
      setStatus("Đăng nhập xong, session đã lưu mã hóa trên máy mày.");
      await refresh(client);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("SESSION_PASSWORD_NEEDED")) {
        setNeeds2FA(true);
        setStatus("Tài khoản bật 2FA — nhập mật khẩu Telegram.");
      } else {
        setStatus(telegramLoadError(e));
      }
    }
  };

  const confirmPassword = async () => {
    if (!client) return;
    try {
      const tg = await loadTelegram();
      const session = await tg.signInWithPassword(client, password);
      await tg.saveCredentials(passphrase || "doc-sach", Number(apiId), apiHash, session);
      setStatus("Đăng nhập xong (2FA).");
      await refresh(client);
    } catch (e) {
      setStatus(telegramLoadError(e));
    }
  };

  const refresh = async (c: TelegramClient) => {
    const tg = await loadTelegram();
    const list = await tg.listSavedMessages(c, 100);
    setFiles(list);
    setStatus(`Tìm thấy ${list.length} file sách trong Saved Messages.`);
    onConnectedChange?.(true);
  };

  return (
    <section className="telegram-panel">
      <h2>Telegram — Saved Messages</h2>
      <p className="muted">
        Kho truyện trên Telegram: không giới hạn tổng dung lượng, 2GB/file (free).
        App tải theo đoạn byte nên đọc CBZ 200MB không cần tải cả file về.
        Chỉ dùng cho cá nhân mày, đừng share công khai.
      </p>
      <div className="form-grid">
        <label>
          api_id (my.telegram.org)
          <input value={apiId} onChange={(e) => setApiId(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          api_hash
          <input value={apiHash} onChange={(e) => setApiHash(e.target.value)} type="password" />
        </label>
        <label>
          Passphrase mã hóa session (tự đặt, nhớ lấy)
          <input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} type="password" />
        </label>
        <label>
          Số điện thoại Telegram (+84…)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>
      <p>
        <button onClick={connect}>Kết nối / Gửi mã</button>{" "}
        {phoneCodeHash && (
          <>
            <input placeholder="Mã đăng nhập" value={code} onChange={(e) => setCode(e.target.value)} />
            <button onClick={confirmCode}>Xác nhận mã</button>
          </>
        )}
        {needs2FA && (
          <>
            <input
              placeholder="Mật khẩu 2FA"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={confirmPassword}>Xác nhận 2FA</button>
          </>
        )}
      </p>
      {status && <p>{status}</p>}
      <ul className="book-list">
        {files.map((f) => (
          <li key={f.msg_id} className="book-row">
            <div>
              <strong>{f.name}</strong>{" "}
              <span className="muted">{(f.size / 1024 / 1024).toFixed(1)} MB • Telegram</span>
            </div>
            <button disabled={!client} onClick={() => client && onOpenTelegramBook(f, client)}>
              Mở
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

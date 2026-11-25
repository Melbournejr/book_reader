/**
 * Nguồn Telegram — MTProto, đăng nhập bằng CHÍNH tài khoản của người dùng.
 *
 * KHÔNG dùng Bot API: Bot API chỉ tải được file tối đa 20MB, truyện của
 * Thiện toàn 200MB+ nên vô dụng. MTProto (GramJS) tải được tới 2GB/file
 * (free) / 4GB (Premium), và hỗ trợ tải theo đoạn byte (offset/limit)
 * nên đọc CBZ không cần tải cả file về.
 *
 * BẢO MẬT: api_id / api_hash / session KHÔNG BAO GIỜ hardcode.
 * Người dùng nhập trong app, lưu mã hóa AES-GCM (khóa từ passphrase
 * của chính họ) vào localStorage. Mất passphrase = phải đăng nhập lại.
 * Đây là phần rủi ro nhất của scaffold — CHƯA test trên file CBZ thật.
 */
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import bigInt from "big-integer";
import type { TelegramFile } from "../types";

const ENC_KEY = "tg_creds_v1";

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { hash: "SHA-256", iterations: 100_000, name: "PBKDF2", salt: enc.encode("doc-sach-tg") },
    base,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function saveCredentials(
  passphrase: string,
  apiId: number,
  apiHash: string,
  session: string,
): Promise<void> {
  const key = await deriveKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify({ apiId, apiHash, session }));
  const cipher = await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, key, data);
  localStorage.setItem(
    ENC_KEY,
    JSON.stringify({
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(cipher)),
    }),
  );
}

export async function loadCredentials(
  passphrase: string,
): Promise<{ apiId: number; apiHash: string; session: string } | null> {
  const raw = localStorage.getItem(ENC_KEY);
  if (!raw) return null;
  try {
    const { iv, data } = JSON.parse(raw);
    const key = await deriveKey(passphrase);
    const plain = await crypto.subtle.decrypt(
      { iv: new Uint8Array(iv), name: "AES-GCM" },
      key,
      new Uint8Array(data),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null; // sai passphrase
  }
}

export function createClient(
  apiId: number,
  apiHash: string,
  session = "",
): TelegramClient {
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  });
}

/** Bước 1 đăng nhập: gửi mã về số điện thoại. Trả về phoneCodeHash. */
export async function sendLoginCode(
  client: TelegramClient,
  phone: string,
): Promise<string> {
  const res = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: client.apiId as number,
      apiHash: client.apiHash as string,
      settings: new Api.CodeSettings({}),
    }),
  );
  return (res as Api.auth.SentCode).phoneCodeHash;
}

/** Bước 2: nhập mã. Nếu tài khoản bật 2FA thì bắt lỗi SESSION_PASSWORD_NEEDED
 *  rồi gọi signInWithPassword(password). */
export async function signInWithCode(
  client: TelegramClient,
  phone: string,
  phoneCodeHash: string,
  code: string,
): Promise<string> {
  await client.invoke(
    new Api.auth.SignIn({
      phoneNumber: phone,
      phoneCodeHash,
      phoneCode: code,
    }),
  );
  return (client.session as StringSession).save();
}

export async function signInWithPassword(
  client: TelegramClient,
  password: string,
): Promise<string> {
  // 2FA dùng SRP: lấy tham số mật khẩu rồi tính InputCheckPasswordSRP.
  const pwd = (await client.invoke(new Api.account.GetPassword())) as Api.account.Password;
  const srp = await computeCheck(pwd, password);
  await client.invoke(new Api.auth.CheckPassword({ password: srp }));
  return (client.session as StringSession).save();
}

// ---------- Liệt kê file trong Saved Messages ----------

/** Document của từng tin nhắn, giữ lại để tải theo đoạn byte sau này. */
const docCache = new Map<number, Api.Document>();

export async function listSavedMessages(
  client: TelegramClient,
  limit = 100,
): Promise<TelegramFile[]> {
  const history = await client.invoke(
    new Api.messages.GetHistory({
      peer: new Api.InputPeerSelf(),
      limit,
      offsetId: 0,
      offsetDate: 0,
      addOffset: 0,
      maxId: 0,
      minId: 0,
      hash: bigInt(0),
    }),
  );
  const out: TelegramFile[] = [];
  const msgs = (history as Api.messages.Messages).messages ?? [];
  for (const m of msgs) {
    const media = (m as Api.Message).media as Api.MessageMediaDocument | undefined;
    const doc = media?.document as Api.Document | undefined;
    if (!doc || !doc.id) continue;
    const attr = doc.attributes?.find(
      (a) => a instanceof Api.DocumentAttributeFilename,
    ) as Api.DocumentAttributeFilename | undefined;
    const name = attr?.fileName ?? `file-${doc.id}`;
    if (!/\.(cbz|zip|epub|pdf|mobi|azw3|cbr)$/i.test(name)) continue;
    docCache.set((m as Api.Message).id, doc);
    out.push({
      msg_id: (m as Api.Message).id,
      file_id: String(doc.id),
      name,
      size: Number(doc.size ?? 0),
      mime: doc.mimeType ?? "application/octet-stream",
      date: (m as Api.Message).date,
    });
  }
  return out;
}

// ---------- Tải theo đoạn byte (range) ----------

/**
 * Tải đúng [offset, offset+length) của 1 file Telegram, qua MTProto
 * upload.getFile. Đây là thứ làm Telegram đọc được như ổ đĩa: không cần
 * tải cả file 200MB về mới đọc được trang 1.
 */
export async function downloadRange(
  client: TelegramClient,
  msgId: number,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const doc = docCache.get(msgId);
  if (!doc) throw new Error("Chưa có document trong cache — liệt kê lại Saved Messages trước.");
  const location = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: "",
  });
  const res = await client.invoke(
    new Api.upload.GetFile({
      location,
      offset: bigInt(offset),
      limit: length,
      precise: true,
    }),
  );
  const file = res as Api.upload.File;
  return file.bytes as Uint8Array;
}

// ---------- CBZ trên Telegram: đọc chỉ mục ZIP từ đuôi file ----------

export interface ZipEntry {
  name: string;
  localHeaderOffset: number;
  compressedSize: number;
  method: number; // 0 = stored, 8 = deflate
}

/** Đọc đuôi ZIP (EOCD, tối đa 64KB cuối file) rồi parse central directory. */
export async function telegramCbzIndex(
  client: TelegramClient,
  file: TelegramFile,
): Promise<ZipEntry[]> {
  const tailLen = Math.min(65557, file.size);
  const tail = await downloadRange(client, file.msg_id, file.size - tailLen, tailLen);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  // Tìm EOCD: signature 0x06054b50
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Không tìm thấy End Of Central Directory — file có thể không phải ZIP/CBZ.");
  const cdCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cd = await downloadRange(client, file.msg_id, cdOffset, cdSize);
  const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < cdCount && p + 46 <= cd.length; i++) {
    if (cdView.getUint32(p, true) !== 0x02014b50) break;
    const method = cdView.getUint16(p + 10, true);
    const compressedSize = cdView.getUint32(p + 20, true);
    const nameLen = cdView.getUint16(p + 28, true);
    const extraLen = cdView.getUint16(p + 30, true);
    const commentLen = cdView.getUint16(p + 32, true);
    const localHeaderOffset = cdView.getUint32(p + 42, true);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));
    if (/\.(jpe?g|png|webp|gif|avif)$/i.test(name)) {
      entries.push({ name, localHeaderOffset, compressedSize, method });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return entries;
}

/** Tải đúng 1 trang ảnh của CBZ trên Telegram, giải nén trong RAM. */
export async function telegramCbzPage(
  client: TelegramClient,
  file: TelegramFile,
  entry: ZipEntry,
): Promise<string> {
  // Local header: 30 byte + tên + extra. Đọc 30 byte đầu + tên để tính offset dữ liệu.
  const head = await downloadRange(client, file.msg_id, entry.localHeaderOffset, 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const nameLen = hv.getUint16(26, true);
  const extraLen = hv.getUint16(28, true);
  const dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const raw = await downloadRange(client, file.msg_id, dataOffset, entry.compressedSize);
  let bytes: Uint8Array;
  if (entry.method === 0) {
    bytes = raw;
  } else if (entry.method === 8) {
    const stream = new DecompressionStream("deflate-raw");
    const out = await new Response(
      new Blob([raw as BlobPart]).stream().pipeThrough(stream),
    ).arrayBuffer();
    bytes = new Uint8Array(out);
  } else {
    throw new Error(`ZIP method ${entry.method} chưa hỗ trợ (chỉ stored/deflate).`);
  }
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const b64 = btoa(String.fromCharCode(...bytes.slice(0, 1_000_000)));
  // File lớn hơn 1MB/chunk: nối bằng FileReader cho an toàn (tránh stack overflow).
  if (bytes.length > 1_000_000) {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
  }
  return `data:${mime};base64,${b64}`;
}

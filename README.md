# Phần Mềm Đọc Sách — bản Desktop (Tauri v2)

App đọc sách/truyện trên PC, làm đúng 3 ý mày chốt:

1. **Chỉ đọc file trực tiếp trên máy, không clone file.** Mở file là đọc từ file
   gốc, app chỉ lưu đường dẫn + metadata. CBZ đọc lười từng trang (chỉ giải
   nén trang đang xem + nạp trước vài trang), EPUB giải nén trong RAM.
2. **Lịch sử đọc:** mục "Đang đọc dở" xếp theo lần đọc gần nhất, bấm vào là về
   đúng trang/chương hôm trước. Lưu trong SQLite local trên máy mày.
3. **Telegram làm kho truyện:** đọc CBZ/EPUB từ Saved Messages (hoặc channel
   riêng tư) qua MTProto, tải theo đoạn byte nên không cần tải cả file 200MB về.

> Đây là **scaffold đầu tiên, chưa phải app hoàn chỉnh**. Đọc mục "Chưa xong /
> chưa test" ở cuối trước khi dùng thật.

## Cách 1 — Build trên GitHub (khuyên dùng, không cần cài gì ở máy mày)

Mày chỉ cần 1 tài khoản GitHub (free) là build được .exe/.msi Windows mà không
cần cài Rust/Node/Visual Studio ở máy.

1. Tạo repo **riêng tư (Private)** trên GitHub, tên ví dụ
   `phan-mem-doc-sach-desktop`. Riêng tư để code + sách của mày không bị người
   ngoài thấy.
2. Push code trong thư mục này lên repo đó:
   ```bash
   git init
   git add .
   git commit -m "scaffold desktop reader"
   git branch -M main
   git remote add origin https://github.com/<ten-may>/phan-mem-doc-sach-desktop.git
   git push -u origin main
   ```
3. Vào repo trên GitHub → tab **Actions** → workflow **Build Windows** →
   **Run workflow** (chạy tay), hoặc cứ push lên nhánh `main` là nó tự chạy.
4. Chờ workflow chạy xong (thường 5–15 phút lần đầu). Vào lần chạy đó →
   mục **Artifacts** → tải `windows-installer` về, giải nén ra sẽ có file
   `.msi` (khuyên dùng) và `.exe`.
5. Muốn có bản Release gọn: tạo tag rồi push, ví dụ:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   Workflow sẽ đính kèm file cài đặt vào mục **Releases** của repo.
6. Chạy file `.msi`/`.exe` lần đầu: Windows SmartScreen sẽ hiện cảnh báo vì
   app **không ký code (unsigned)** — bấm **More info → Run anyway** là chạy
   bình thường. Đây là app của mày tự build, không phải virus.

**Giới hạn free của GitHub Actions (nói thẳng):** tài khoản free có
**2.000 phút chạy máy Windows/tháng** (Windows tốn gấp 2 lần Linux, tính
theo phút x2). Một lần build Windows khoảng 5–15 phút, tức là mày build được
hàng chục lần mỗi tháng thoải mái, nhưng đừng push liên tục vô tội vạ. Hết
phút free thì phải đợi sang tháng sau hoặc mua thêm. Artifact lưu tối đa
30 ngày (đã set trong workflow), Release thì lưu vĩnh viễn.

**Bảo mật:** workflow không chứa secret/credential nào. `GITHUB_TOKEN` là
token tự động của GitHub, chỉ dùng để tạo Release. api_id/api_hash Telegram
mày nhập trong app, lưu mã hóa trên máy mày, không bao giờ qua GitHub.

## Cách 2 — Build local trên máy Windows của mày

Cần cài trước:

- **Node.js LTS** (20 trở lên): https://nodejs.org — tải bản LTS, cài mặc định.
- **Rust** (stable): https://rustup.rs — chạy `rustup-init.exe`, chọn mặc định.
- **Visual Studio Build Tools** (C++): tải ở
  https://visualstudio.microsoft.com/downloads/ → mục "Build Tools for Visual
  Studio" → tick **Desktop development with C++**.
- **WebView2**: Win 10/11 có sẵn rồi, không cần cài thêm.

Build:

```bash
npm install
npm run tauri build
```

File ra ở:

- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*.exe`

Chạy lần đầu cũng **More info → Run anyway** như trên, vì không ký code.
Không cần khóa ký gì cho dùng cá nhân (xem lại: chứng chỉ ký code trả phí
chỉ cần khi phát hành cho người khác tải; khóa updater của Tauri thì miễn phí
và chỉ cần khi thêm tự cập nhật sau này).

Chạy thử bản dev (không cần build):

```bash
npm run tauri dev
```

## Dùng app

- **Thêm sách local:** bấm "Mở 1 file…" hoặc "Thêm cả thư mục…" — app liệt kê
  CBZ/CBR/EPUB/PDF/MOBI trong thư mục đó. Chỉ lưu đường dẫn, không copy file.
- **Đang đọc dở:** mở app lên là thấy, xếp theo mới đọc nhất. Bấm "Đọc tiếp"
  là về đúng trang. File nào bị đổi tên/dời chỗ thì app hiện "mất file, chỉ
  lại đường dẫn" — bấm đó rồi chọn lại file là lịch sử giữ nguyên.
- **Đọc:** 1/2 trang, kéo chuột từ mép trang để lật như tay cầm sách, phím
  ← → lật trang, F toàn màn hình, Esc thoát. Có nút bật/tắt hiệu ứng lật.
  Tick "Manga phải → trái" cho truyện đọc ngược.
- **Telegram:**
  1. Vào https://my.telegram.org, đăng nhập bằng số điện thoại, tạo 1 app
     (tên gì cũng được) để lấy **api_id** và **api_hash**. Giữ 2 cái này như
     mật khẩu, đừng đưa ai.
  2. Trong app, tab Telegram: nhập api_id, api_hash, tự đặt 1 passphrase để
     mã hóa session, nhập số điện thoại (+84…), bấm "Kết nối / Gửi mã".
  3. Nhập mã Telegram gửi về; nếu tài khoản bật 2FA thì nhập thêm mật khẩu 2FA.
  4. App liệt kê file sách trong Saved Messages — bấm "Mở" là đọc, tải theo
     đoạn byte, không tải cả file về.
  5. Muốn kho gọn hơn Saved Messages: tạo 1 **channel riêng tư chỉ có mình
     mày**, gửi file truyện vào đó rồi đổi nguồn trong code (xem
     `src/lib/telegram.ts`, hàm `listSavedMessages`).

## Cập nhật bản mới (OTA kiểu GitHub Releases)

Mỗi lần có bản mới, tao push tag `vX.Y.Z` lên repo là GitHub Actions
build xong đính kèm file `.msi` vào mục **Releases**. App tự kiểm tra
bản mới nhất khi mở lên (gọi API GitHub Releases, so tag với version
đang chạy); có bản mới thì hiện banner "Có bản mới vX.Y.Z — Tải về",
bấm là mở link tải `.msi` bằng trình duyệt hệ thống, tải về cài đè
lên bản cũ là xong. Nút "Kiểm tra cập nhật" ở đầu app để bấm tay khi
muốn kiểm tra ngay. Mất mạng hoặc chưa có Release nào thì app báo
"không kiểm tra được lúc này" rồi thôi, không crash.

**Nói thẳng:** đây là thông báo bản mới + tải về, KHÔNG phải tự cài
lặng lẽ trong nền như OTA trên điện thoại. Muốn tự tải + tự cài im
lặng thì phải dùng plugin `tauri-plugin-updater`: cần tạo cặp khóa ký
bằng lệnh `tauri signer generate` trên máy Windows, bỏ khóa công khai
vào `tauri.conf.json` và khóa riêng vào secret GitHub
`TAURI_SIGNING_PRIVATE_KEY`, rồi workflow ký file cập nhật mỗi lần
build. Bước đó chưa làm ở đây — làm sau khi bản đầu tiên build chạy
ổn đã.

## Chưa xong / chưa test — nói thẳng

- **Chưa test trên file CBZ 200MB+ thật (Bloody Monday 2028 trang).** Scaffold
  này mới nạp trước 3 trang đầu khi mở CBZ; lazy loader nạp từng trang khi
  lật tới cho cả CBZ local lẫn Telegram **cần hoàn thiện trước khi dùng thật**
  (xem ghi chú trong `src/App.tsx`). Đừng mang đi đọc bộ 200MB ngay.
- **Telegram range-download cho CBZ là phần rủi ro nhất.** Logic tải đuôi ZIP
  → central directory → từng trang đã viết trong `src/lib/telegram.ts`, nhưng
  chưa chạy thử với tài khoản Telegram thật, chưa test tốc độ/FLOOD_WAIT khi
  tải nhiều trang liên tục.
- **GramJS trong WebView chưa chắc chạy được.** Thư viện `telegram` (GramJS)
  viết cho Node.js; khi Vite build nó cảnh báo các module Node (`net`, `fs`,
  `stream`…) bị externalize. Trong WebView của Tauri không có Node, nên
  GramJS có thể lỗi lúc kết nối MTProto. Nếu build xong mà tab Telegram báo
  lỗi kết nối, hướng sửa là: chuyển Telegram sang backend Rust dùng thư viện
  MTProto `grammers`, hoặc chạy 1 Node sidecar nhỏ — đừng cố vá polyfill
  trong frontend.
- **Rust chưa được kiểm chứng trên VM này** (VM Linux không có cargo/Rust).
  Frontend đã build thử bằng Vite (xem dưới). Lần build Tauri đầu tiên phải
  là trên GitHub Actions hoặc máy Windows của mày — nếu Rust báo lỗi
  dependency thì gửi lỗi cho tao.
- **PDF/MOBI:** bản scaffold chỉ mở được metadata; PDF xem từng trang và
  MOBI không DRM sẽ thêm sau. CBR nén (RAR5) vẫn cần convert sang CBZ.
- **Không ký code:** .exe/.msi unsigned, SmartScreen hỏi lần đầu là bình
  thường.

## Cấu trúc code

```
src/                  Frontend React + TypeScript + Vite
  App.tsx             Thư viện + mở sách local/Telegram + lưu tiến độ
  components/Reader.tsx    Trình đọc 2 trang, page-curl (fold geometry,
                           mặt sau soi gương sẵn, rAF ghi thẳng DOM)
  components/Library.tsx   "Đang đọc dở" + sách trên máy
  components/TelegramPanel.tsx  Đăng nhập Telegram, liệt kê Saved Messages
  components/UpdateBanner.tsx   Banner + nút "Kiểm tra cập nhật" (OTA kiểu
                           GitHub Releases, xem src/lib/update.ts)
  lib/curl.ts         Hình học nếp gấp (đã chứng minh ở bản web)
  lib/telegram.ts     GramJS MTProto: login, list, tải theo byte-range,
                      đọc chỉ mục ZIP CBZ từ đuôi file
  lib/update.ts       So version hiện tại với Release mới nhất trên
                      GitHub, trả link tải .msi (không cần ký số)
  lib/api.ts          Gọi lệnh Rust qua Tauri invoke
src-tauri/            Backend Rust (Tauri v2)
  capabilities/default.json   Quyền: core, dialog, opener (mở link tải)
  src/main.rs         Lệnh: chọn file/thư mục, list sách, cbz_index,
                      cbz_page (chỉ 1 trang), read_range, epub_toc/chapter
  src/db.rs           Khởi tạo SQLite
  src/history.rs      Lịch sử đọc + bookmark + relink file bị dời
  src/epub.rs         Đọc EPUB trong RAM (container.xml + opf + ncx)
.github/workflows/build-windows.yml   Build .exe/.msi trên GitHub Actions
```

# Mio Reader — bản Desktop (Tauri v2)

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

### P1 (v0.1.4) — đã làm xong
- **Bookmark:** đánh dấu trang/chương (phím B hoặc nút ★), ghi nhãn, nhảy tới, xóa; lưu SQLite bảng `bookmarks` (đã có từ scaffold, P1 mới nối UI + lệnh liệt kê/xóa).
- **Tìm trong sách:** EPUB/MOBI tìm trong text các chương (tối đa 3 kết quả/chương, có tiến độ); PDF tìm qua pdf.js `getTextContent`, nhảy tới thì vẽ nền vàng lên đúng hộp chữ khớp. Truyện ảnh (CBZ/CBR/Telegram) không tìm được chữ — app báo thẳng trong panel, không giả vờ OCR.
- **Lưới trang:** thumbnail lười (IntersectionObserver + cache tối đa 60, hủy khi cuộn qua), CBZ/CBR/PDF render thumb nhỏ, EPUB/MOBI hiện danh sách chương thay vì ảnh.
- **Zoom + vừa trang:** nút +/−, Ctrl+lăn chuột, phím +/−/0, vừa trang/vừa rộng/vừa cao; zoom vượt vừa trang thì tắt lật cong, kéo chuột để rê trang. Nhớ theo từng cuốn (lưu JSON trong `history.settings`).
- **Cắt lề:** tự phát hiện lề trắng (quét pixel, ngưỡng 242) + kéo thanh trượt từng phía 0–40%, chỉ cắt lúc hiển thị trang ảnh, không sửa file gốc; nhớ theo từng cuốn.
- **Gạch chân:** EPUB/MOBI bôi đen chữ → lưu highlight (4 màu + ghi chú), vẽ lại `<mark>` khi mở chương, liệt kê/nhảy tới/xóa; lưu SQLite bảng `highlights`. PDF không có gạch chân chữ tự do (trang PDF render thành ảnh, không có lớp text để chọn) — chỉ có highlight vàng khi nhảy tới kết quả tìm.
- **Thư viện:** ô lọc theo tên sách (cả "Đang đọc dở" lẫn "Sách trên máy này").

### P2 (v0.1.5) — đã làm xong
- **Thống kê đọc:** mỗi lần đóng sách, app ghi 1 phiên vào SQLite bảng `reading_sessions` (giây đọc, số trang lật được, có đọc tới trang cuối không). Thư viện có mục "Thống kê đọc": tổng thời gian/trang/cuốn xong/ngày đã đọc/chuỗi ngày liên tiếp + từng cuốn (thanh tỉ lệ thời gian, nút Đọc tiếp). Toàn bộ local, không tài khoản, không cloud. Phiên dưới 3 giây + không lật trang nào thì không ghi. Lưu ý: ngày đọc tính theo ngày UTC nên chuỗi ngày có thể lệch 1 ngày quanh nửa đêm giờ Việt Nam.
- **TTS đọc thành tiếng:** giọng hệ thống của Windows qua `speechSynthesis` (WebView2) — không thư viện thêm, không API key. Nút 🔊 trong trình đọc, phím T: đọc từ trang đang xem, tự lật sang trang sau khi hết trang, tới cuối sách thì dừng; tạm dừng/tiếp tục, tốc độ 0.75–2×, chọn giọng (ưu tiên giọng Việt nếu máy đã cài, rồi giọng Anh). Sách chữ (EPUB/MOBI) tô cam câu đang đọc; PDF đọc tiếng từ text của pdf.js, không tô câu; truyện ảnh không có chữ nên không đọc được — app báo thẳng. Giới hạn: chất lượng giọng hoàn toàn theo giọng Windows đã cài (máy mặc định chỉ có giọng Anh; muốn giọng Việt phải cài thêm gói ngôn ngữ Vietnamese).
- **Tra từ điển:** bôi đen chữ trong sách chữ → nút "📖 Tra từ" (hoặc nút 📖 Từ điển trên thanh công cụ, nhập tay). Tiếng Anh tra qua dictionaryapi.dev (miễn phí, không key, cần mạng): nghĩa + ví dụ + phiên âm. Từ tiếng Việt hoặc từ không có trong API thì có link mở Wiktionary tiếng Việt/Anh trên trình duyệt. Mất mạng/API lỗi thì báo rõ, không crash. Không kèm file từ điển offline.
- **OPDS:** mục "OPDS — kéo sách từ server" trong thư viện: dán URL catalogue (Calibre/Kavita/Komga...), đăng nhập HTTP Basic nếu cần, duyệt mục, tìm kiếm nếu feed hỗ trợ (OpenSearch), tải sách về thư mục mày chọn rồi mở đọc như file local (không clone vào app). Hỗ trợ OPDS v1 (Atom XML) và v2 (JSON). Giới hạn: server nào không gửi CORS thì WebView không đọc được catalogue (app báo rõ); chỉ hỗ trợ auth HTTP Basic, không OAuth/token; không hỗ trợ mua sách có giá.

### v0.2.0 — đại tu trình đọc (theo đánh giá 0.1/10 của Thiện)
Thiện chấm bản 0.1.5 là 0.1/10: giao diện xấu, tính năng kể thì nhiều nhưng
3 thứ cốt lõi hỏng — đọc toàn màn hình không thật, lật trang bị ngược tranh,
không có đọc manga phải → trái. Bản này sửa cả 3 + làm lại giao diện.

- **Đọc toàn màn hình "chìm" (F):** ẩn HẾT chrome — header của App, thanh
  công cụ, bảng bên, thanh trượt — chỉ còn trang sách + thanh tiến độ mỏng
  ở đáy + cụm nút nổi hình viên thuốc ở trên (hiện khi cử động chuột, tự
  ẩn sau ~2.5s không cử động; menu đang mở thì không tự ẩn). Esc/F thoát.
  Quan trọng: chế độ này do state React + CSS điều khiển, KHÔNG phụ thuộc
  Fullscreen API — WebView chặn `requestFullscreen()` thì vẫn ẩn chrome
  như thường (bản cũ chỉ thêm class `.is-fullscreen` nhưng giữ nguyên các
  thanh công cụ nên đọc vẫn bị chiếm chỗ).
- **Lật trang hết ngược (nguyên nhân thật):** bản 0.1.5 soi gương mặt sau
  của lá 2 lần — vừa `scaleX(-1)` trong `renderFace(leafBack, mirrored=true)`
  (Reader.tsx), vừa `.leaf-back { rotateY(180deg) }` trong CSS (mô hình card
  3D chuẩn, phép xoay 180° này ĐÃ tự triệt tiêu soi gương). Kết quả: trang
  đích hiện ngược trong suốt nửa sau của cú lật. Sửa: mặt sau render
  `mirrored=false`. Đã chứng minh bằng test số học (`backFaceFactor` trong
  `src/lib/spread.ts`, 90 test Node): bản cũ hệ số ngang ÂM ở mọi tư thế
  nhìn thấy được, bản mới DƯƠNG (+1 đúng lúc lật xong). Kèm theo: lật 1
  trang trước đây hiện sai trang (mặt sau lấy `target + 1` thay vì
  `target`) — nay mặt sau luôn là đúng trang đích (xem `leafForFlip`).
- **Đọc manga phải → trái (thật):** trước đây chỉ đảo chiều lật + phím mũi
  tên, còn spread vẫn xếp trang trước bên trái — sai. Nay spread manga
  xếp đúng: bìa (trang 1) đứng một mình bên phải, rồi (2,3), (4,5)... với
  trang đọc trước nằm bên PHẢI, trang sau nằm bên TRÁI; lật tới thì lật
  trang trái (trang vừa đọc xong), lui thì lật trang phải; phím mũi tên,
  kéo chuột, thanh trượt, lưới trang (chảy phải → trái) đều theo chiều
  manga. Nút bật/tắt nằm trong menu ⋯ của trình đọc, nhớ theo từng cuốn
  (lưu `rtl` trong `history.settings`). Test Node assert đúng từng trang ở
  mỗi bên spread + đúng thứ tự đọc 0→5 của manga 6 trang.
- **Giao diện làm lại:** mọi tính năng phụ gom vào 1 menu ⋯ duy nhất trong
  trình đọc (đánh dấu, tìm, lưới trang, gạch chân, TTS, từ điển, cắt lề,
  zoom/vừa trang, 1/2 trang, manga, lật trang, toàn màn hình, phím tắt).
  Chrome mặc định chỉ còn: tiêu đề + số trang, thanh tiến độ mỏng, cụm
  nút nổi. Các thanh TTS/từ điển/cắt lề/gạch chân thành thẻ nổi ở đáy,
  chỉ hiện khi gọi ra. Thư viện: thẻ sách có bìa màu theo định dạng.
  Không bỏ tính năng nào — chỉ gom lại vào menu. TTS nay đọc đủ từng
  trang theo thứ tự đọc (trước đây ở chế độ 2 trang nó nhảy cóc, bỏ qua
  trang phải của mỗi spread).
- **Chưa test được ở đây:** không có cargo/WebView trên VM — cần build
  GitHub Actions + Thiện test trên máy thật: đọc chìm có ẩn hết chrome
  không, lật còn ngược không (nhất là truyện ảnh CBZ), manga lật đúng
  chiều + đúng trang chưa, menu mở/đóng có mượt không.

### v0.3.10 — lật mượt + đúng vật lý giấy thật: easing chữ S, cung dẹt, lookahead (28/11/2026)
Thiện test v0.3.9: "Đã có hiệu ứng lật trang. Nhưng cần chỉnh thêm mượt
hơn, không bị nhảy khung hình. Phần lật trang tao cần chuẩn theo hiệu
ứng vật lý ngoài đời thực. Fix được toàn bộ rồi hãy làm bản mới." Kèm 2
video (CBZ I Am A Hero, fullscreen + cửa sổ có sidebar).

**Chẩn đoán (đọc code thật + đo số, file:dòng):**

1. **Nhảy khung — easing easeOutQuart sai vật lý giấy.** `startFlip`
   dùng easeOutQuart 900ms (`src/lib/curl.ts`, `Reader.tsx` v0.3.9):
   đo thật — 100ms đầu đã đi 34% đường, 180ms đi 59%, 100ms cuối chỉ
   đi 0.2%. Khớp đúng frame video: t≈3.5s lá mới nhếch góc nhỏ,
   t≈3.9s (chỉ 0.4s sau) lá đã gập chéo gần hết trang, rồi bò chậm
   phần còn lại. Giấy thật ngược lại: nhấc chậm, quét nhanh giữa
   chừng, đáp nhẹ — đường cong chữ S. Bản web dùng cùng easeOutQuart
   nhưng web decode xong mới lật nên cú bật ít lộ; desktop v0.3.9
   mount lá ngay + decode nền nên cú bật + hình nền về muộn càng lộ.
2. **Nếp gấp xoắn chéo — đường lật quét lên cao.** `curlArcControl`
   (`src/lib/layout.ts:153`) đặt điểm điều khiển ở y = h\*0.22 (gần mép
   trên, copy y nguyên từ bản web): điểm cầm quét lên cao giữa chừng
   nên nếp gấp (đường trung trực grab→point) nghiêng chéo. Đo thật
   trên hình học `foldGeometry` thật: cung cũ nghiêng tối đa **46.7°**;
   cung dẹt y = h\*0.8 chỉ còn **15.5°** (lúc mount 14.8°), góc giấy
   vẫn nhấc lên 60px (~10% chiều cao trang) nên không thành tấm trượt
   phẳng. Đây là điểm bản desktop CHỦ Ý khác bản web — frame video
   chứng minh cung 0.22h xoắn, và bản web chưa bao giờ được kiểm chứng
   với giấy thật.
3. **Giật khung giữa chừng — decode + re-render trong lúc tween.**
   v0.3.9 `startFlip` vẫn bắn `ensure` + `decodeImages` nền TRONG lúc
   tween: `ensure` xong tăng `cacheVersion` → re-render cả Reader
   giữa chừng (CurlLeaf render lại rồi layout effect áp lại live
   point); `decodeImages` tạo `new Image()` + `img.decode()` cho tới
   4 trang vài MB; mặt sau lá có thể đang là placeholder "Đang tải
   trang…" rồi BẬT thành ảnh thật giữa chừng. Mỗi cái là 1 cú giật.
   `settleDrag` cũng có decode nền khi thả tay.
4. **Dải mỏng sót (video 2, spread 19–20 đã yên, mép phải còn ô đen
   số 8 + mảnh trang) — KHÔNG phải lá sót sau khi đáp.** Đối chiếu
   frame 10fps: f015/f016 là giữa chừng 1 cú lật (lá đang qua spread,
   mặt sau che gần hết ô phải, nếp gần thẳng đứng), f017 đã đáp sạch.
   `finishFlip`/`cancelFlip` đã dọn `setCurl(null)` từ v0.3.9, và
   `jumpTo`/`commitSlider` đã gọi `cancelFlip()`. Lỗi thật vẫn là
   (1)+(3): tư thế đầu của lá là dải chéo mỏng (cung 0.22h) nên giữa
   chừng trông như dải trang lạ sót lại.

**Sửa (giữ mô hình curl của bản web ở chỗ đã đúng, chỉ đổi chỗ sai
vật lý hoặc desktop khác web):**

1. **Easing chữ S:** `easeInOutCubic` mới (`src/lib/curl.ts`) thay
   easeOutQuart cho lật phím/chạm/nút, vẫn 900ms. Đo thật: 100ms đầu
   đi 0.4%, 100ms giữa (400–500ms) đi 24%, 100ms cuối đi 0.4% — vận
   tốc 0 ở cả 2 đầu, nhanh nhất giữa chừng. Drag settle giữ nguyên
   easeOutCubic (commit) / easeOutQuint (bật lại) — tiếp nối đà tay,
   không sai vật lý.
2. **Cung dẹt:** `curlArcControl` y = h\*0.8 (was h\*0.22). Nếp gấp
   quét gần thẳng đứng như giấy thật; góc giấy vẫn nhấc 60px.
3. **Mount không snap:** vì chữ S gần như phẳng lúc đầu, mount ở
   `path(ease(0.03))` sẽ gần trùng điểm nắm (hình học suy biến → lá
   tàng hình lại). Lá mount ở `path(FLIP_MOUNT_K)` với
   `FLIP_MOUNT_K = 0.05` (~40px từ điểm nắm, hình học hợp lệ, vẫn đọc
   là "vừa nhấc"), tween bắt đầu ở `FLIP_MOUNT_T = ∛(0.05/4) = 0.232`
   (nghịch đảo của easeInOutCubic) nên tween tiếp tục đúng từ tư thế
   mount, không bật ngược — còn lại ~691ms.
4. **Lookahead:** effect mới trong `Reader.tsx` — 300ms sau khi spread
   yên (và chỉ khi không lật), `ensure` + `decodeImages` trước spread
   kề cả 2 chiều (`lookaheadPages` mới trong `src/lib/spread.ts`).
   Timeout bị hủy mỗi lần đổi spread nên lật nhanh không tranh việc
   với tween. Lúc bấm lật, trang đích đã sẵn trong cache + đã giải mã.
   Nếu lật trước khi lookahead chạy thì lật vẫn chạy ngay như v0.3.9
   (placeholder thay vì đứng hình).
5. **Không decode lại trong tween:** `decodeImages` bỏ qua trang đã
   giải mã rồi (`decodedRef` Set) — với lookahead trúng, việc nền lúc
   lật là no-op thật (ensure không có job mới nên không tăng
   cacheVersion, không re-render). Mặt sau lá không bật placeholder→ảnh
   giữa chừng vì đã có ảnh từ lúc mount.
6. **Mặt lá đóng băng lúc mount:** `startFlip`/`beginDragFlip` chụp
   2 mặt lá vào `leafFacesRef` rồi mới `setCurl`; JSX render mặt đã
   chụp (chỉ fallback sang `renderFace` trực tiếp nếu đường mount nào
   quên chụp). `finishFlip`/`cancelFlip` dọn ref cùng `setCurl(null)`.
   Nếu trang đích chưa sẵn lúc mount thì giữ placeholder cho đúng 1 cú
   lật đó (hiếm khi có lookahead); spread đáp vẫn hiện trang thật.

**KHÔNG đổi:** pairing RTL (vẫn chờ Thiện đồng ý — bước 7 của v0.3.8),
MOBI lười v0.3.9, API Rust, easing settle của kéo-thả, mô hình spread,
bản web (web vẫn easeOutQuart + cung 0.22h — khác desktop từ bản này,
vì frame video chứng minh cung đó xoắn; nếu Thiện thấy web cũng xoắn
thì mới đổi web theo).

**Chưa kiểm được bằng mắt** (không có WebView trên máy build): cảm
nhận lật có mượt + đúng giấy thật trên máy Thiện không (đo bằng test:
easing chữ S, nếp ≤16°, lookahead bao phủ trang đích, tween không
snap-back, hủy giữa chừng không đáp nhầm — nhưng mắt trên WebView2
thật mới là cửa cuối), Rust không đổi nên không cần build lại Rust
(GitHub Actions vẫn là cửa kiểm cuối). Test số: 101 (v030) + 13 (v034)
+ 41 (v037 — test E3 cập nhật theo cung mới 0.8h) + 44 (v038) + 688
(v039) + 42 mới (v0310: easing cũ tái hiện cú bật 34%/100ms đầu vs
chữ S, nếp gấp theo thời gian từ `foldGeometry` thật, mount hợp lệ,
lookahead bao phủ, tween + dọn lá bằng fake rAF) — tất cả pass. File
test mới: `~/workspace/goals/pc-book-reading-software/hidden_files/v0310-flip-smooth-test.ts`.

### v0.3.9 — MOBI nạp lười + lá lật hiện thật + lật phản hồi ngay: theo mô hình trình xem video (28/11/2026)
Thiện test v0.3.8 (sidebar đã ghi v0.3.8): (a) mở Conde koma 1.mobi
(412MB) thì cả app đơ, kẹt ở toast "Đang mở Conde koma 1.mobi...";
(b) hiệu ứng lật trang "chưa hề thay đổi, vẫn như cũ" — kèm 2 video:
video 1 (MOBI sách chữ, Trang 4449/5870) cùng nhãn 4449 hiện 2 đoạn
truyện khác nhau; video 2 (CBZ I Am A Hero, 47s) trang truyện bên phải
biến thành ĐEN ĐẶC ~7 giây trong khi bìa sau vẫn hiện, rồi nhảy tới
trang 166-168, nhãn lúc đó đọc "Trang 1 / 605 · RTL" trong khi ảnh
đang là spread cuối. Hắn lật bằng PHÍM (mũi tên) và CHUỘT (chạm nhẹ),
KHÔNG dùng slider; và app nói chung "đơ lắm". Hắn đặt chuẩn: trình xem
video tua mượt với file vài chục GB — app đọc sách phải mượt như vậy,
không được đưa bản nửa vời.

**Chẩn đoán (đọc code thật, file:dòng):**

1. **Lá lật TÀNG HÌNH — gốc lỗi 100% chắc chắn.** `Reader.tsx`
   mount `CurlLeaf` với `point={curl.grab}` — điểm giữ trùng điểm nắm
   nên `foldGeometry` trả null (len < 2), `CurlLeaf` trả null, không có
   DOM nào cho imperative handle viết vào — lá không bao giờ hiện trong
   cả cú lật, cho MỌI đường lật (phím/chạm/nút/kéo). Bản web mount ở
   `point: path(easeOutQuart(0.03))` nên không gặp lỗi này; bản desktop
   port v0.3.7 đã làm rơi trường `point` khỏi `CurlState` (chỉ còn
   `grab`/`mirror`), dù comment trong `startFlip` vẫn ghi "mount lá hơi
   chếch vào trong cú lật". Không phải do `flipOn` (hardcode `true`),
   không phải CSS cắt, không phải tween không chạy — tween chạy đủ 900ms
   nhưng viết vào DOM trống.
2. **"Đơ lắm" khi lật — `startFlip` chờ decode xong mới mount lá.**
   v0.3.8 `await ensure(4 trang)` + `await decodeImages(4 trang)` rồi
   mới `setCurl`: mỗi lần bấm phím/chạm đều đứng hình ~0.2–1s (base64
   vài MB/trang qua JSON invoke, giải mã trên luồng chính) rồi trang
   nhảy tức thì (lá lại tàng hình) — cảm giác đơ rồi nhảy. Cùng nhịp
   chờ này có ở `beginDragFlip` và `settleDrag` (thả tay xong vẫn đứng
   hình một nhịp).
3. **Trang đen 7 giây (video 2) — trang lỗi thì kẹt, không thử lại.**
   `.page-img { background: #111 }`: `<img>` chưa decode xong thì slot
   đen. `ensure` nuốt lỗi nạp (không thử lại), `decodeImages` không có
   timeout, và không có gì kích hoạt nạp lại khi `cur` không đổi — trang
   lỗi kẹt đen cho tới khi đổi spread. Cộng thêm: `jumpTo`/`commitSlider`
   không gọi `cancelFlip()` — nhảy giữa lúc lật để lại `curl.base` cũ
   hiển thị trong khi `cur` đã đổi (đúng hiện tượng nhãn "Trang 1" mà
   ảnh là spread cuối ở t=7).
4. **Video 1 "lệch nhãn" — KHÔNG phải lỗi chia trang.** `splitPages`
   là hàm thuần túy (cùng HTML → cùng trang), và frame giữa có đường
   ranh thẳng chính là gáy của spread 2 trang bình thường (4449, 4450)
   — máy quay lia nên khung hình cắt khác nhau. Lỗi thật trong video 1:
   (a) không thấy lá cong (lỗi 1), (b) chạm nhẹ vào trang chữ KHÔNG lật
   được (`onPointerDown` return sớm với slot chữ, không ghi
   `pendingDragRef` — chỉ phím và nút ‹ › lật được).
5. **MOBI lag — đã xác định từ trước, không cần điều tra lại.**
   `App.tsx` đọc CẢ file 412MB (`readFileBytes`) + `parseMobi` giải nén
   TẤT CẢ record + build TẤT CẢ trang + chuyển MỌI ảnh nhúng sang base64
   TRƯỚC khi mở reader (`initialPages: book.pages` — mảng đầy).
6. **Đường nạp trang cũ là nghi phạm cấu trúc gây đơ.** Rust `cbz_page`
   trả base64 qua invoke → `<img src="data:...">` vài MB: chuỗi base64
   khổng lồ đi qua JSON invoke, trình duyệt giải mã trên luồng chính.
   Đo trên JPEG thật (fixture CBZ 200 trang): 4 trang raw 4,144,616
   byte → base64 data URL 5,526,252 byte (x1.333, thừa 1,381,636
   byte/lần lật). Bản web dùng File API + blob URL nên mượt — desktop
   phải có đường tương đương.

**Sửa (theo mô hình trình xem video: chỉ đọc index rồi seek, không bao
giờ chặn UI chờ decode, chỉ giữ buffer nhỏ vài trang):**

1. **Lá hiện thật:** `CurlState` thêm `point: Pt`; `startFlip` mount
   với `point: path(easeOutQuart(0.03))`, `beginDragFlip` mount với
   `point` = điểm tay hiện tại đã kẹp theo cung lật; JSX truyền
   `point={curl.point}` (trước đây `point={curl.grab}`). Thêm
   `ensureFoldPoint` (`src/lib/curl.ts`) + dùng trong `CurlLeaf.tsx`
   (render/`update`/`applyPoint`) làm lưới an toàn: điểm suy biến được
   đẩy ra vài px tới khi hình học hợp lệ, lá không bao giờ biến mất vì
   một tư thế suy biến.
2. **Lật phản hồi ngay:** `startFlip`/`beginDragFlip`/`settleDrag` mount
   lá + chạy tween NGAY LẬP TỨC, không await gì trước đó; `ensure` +
   `decodeImages` chạy NỀN (fire-and-forget). Effect nạp trước thường
   đã có sẵn trang đích; nếu chưa có, mặt sau lá hiện placeholder "Đang
   tải trang…" rồi tự đổi thành trang thật khi nạp xong (ensure tăng
   cacheVersion → render lại). Nhãn vẫn chỉ đổi ở `finishFlip` (cuối
   tween) — không lệch nhãn/ảnh. Bỏ `flipSeqRef` (không còn khoảng chờ
   async nào cần vô hiệu hóa).
3. **Trang ảnh qua custom protocol `mio-page://`** (thay base64 qua
   invoke): Rust `main.rs` thêm `scan_cbz_entries` /
   `read_cbz_entry` (dùng chung cho lệnh `cbz_index`/`cbz_page` và
   protocol — cùng thứ tự trang), `page_response` (CBZ only, MIME theo
   đuôi file, `cache-control: public, max-age=86400`,
   `access-control-allow-origin: *`, 404 khi sách/trang không còn),
   đăng ký `.register_uri_scheme_protocol("mio-page", ...)`; thêm dep
   `http = "1"` vào `Cargo.toml`; CSP thêm `mio-page:` vào `img-src`
   và `connect-src`. Ảnh nạp như ảnh web bình thường (bất đồng bộ, cache
   theo URL, giải mã ngoài luồng chính); lật tới-lui không giải mã lại.
   An toàn: `ReaderPage.fallback` + `<img onError>` trong `renderFace`
   thử 1 lần base64 qua `cbz_page` khi protocol lỗi (vd file đã đổi/xóa
   sau khi mở) — trang vẫn hiện, chỉ chậm hơn. Thumbnail lưới trang vẫn
   dùng base64 riêng (downscale qua fetch).
4. **MOBI nạp lười** (`src/lib/mobiLazy.ts` mới, `src/lib/mobi.ts`
   refactor + tối ưu `palmdocDecompress` bằng bộ đệm tăng trưởng):
   mở chỉ đọc 78 byte đầu → bảng offsets → record 0 (header) → VÙNG
   text records (liên tục, vài MB) → giải nén → tách trang; ảnh nhúng
   (`<img recindex>`) chỉ chuyển base64 khi trang đó được render
   (`loadPage`, cache LRU 16 ảnh). Đo thật trên fixture MOBI tổng hợp
   399.8MB (text 26.9MB, 3,467 trang, 8,576 record): **mở trong 660ms,
   chỉ đọc 26,972,083 byte (6.4% cỡ file)** — so với bản cũ đọc cả
   419MB. Tìm kiếm vẫn quét toàn bộ text (đã có sẵn trong RAM) nên
   không chậm hơn. **Đổi hành vi (ghi rõ):** số trang có thể lệch nhẹ so
   với bản cũ vì ảnh không còn ăn vào ngân sách 6000 ký tự của trang
   (placeholder ~20 ký tự thay cho base64 hàng MB) — trang chứa nhiều
   chữ hơn, tổng số trang ít hơn, vị trí đọc đã lưu có thể lệch vài
   trang khi mở lại sách cũ.
5. **Hết trang đen kẹt:** effect thử lại trang lỗi sau 1.5s, tối đa 2
   lần mỗi spread (reset khi đổi spread); `jumpTo`/`commitSlider` gọi
   `cancelFlip()` trước (hủy cả tween đang chạy — không còn lá cũ kẹt
   hiển thị sai spread) và chờ nạp tối đa 8s (`withTimeout`) rồi nhảy
   tiếp với placeholder thay vì treo mãi.
6. **Chạm nhẹ lật được trên sách chữ:** `onPointerDown` ghi nhận cả
   slot chữ (`PendingDrag.isImage`); kéo trên trang chữ vẫn là bôi đen
   chữ (không kéo lật, không capture con trỏ), chạm nhẹ <8px thì lật.

**KHÔNG đổi:** hình học curl (`curl.ts` ngoài `ensureFoldPoint`,
`CurlLeaf.tsx` ngoài lưới an toàn), pairing RTL (vẫn chờ Thiện đồng
ý), mô hình spread, số liệu flip (900ms easeOutQuart, settle
170–560ms, ngưỡng commit), fullscreen `immersive`, thư viện/cây thư
mục/Telegram/OPDS/stats, PDF (không ai báo lag), CBR (vẫn đọc cả file
vào RAM — giới hạn cũ, chưa ai báo lag với CBR).

**Chưa kiểm được bằng mắt** (không có WebView trên máy build): lá cong
có hiện đúng như video mẫu không, lật có mượt thật trên máy Thiện
không (đo bằng test: mount lá <20ms, mở MOBI 660ms — nhưng cảm nhận
trên WebView2 thật mới là cửa cuối), Rust có biên dịch được không
(không có cargo/rustc trên VM — **GitHub Actions là cửa kiểm cuối cho
Rust**: nếu protocol sai, app vẫn chạy nhờ fallback base64, chỉ chậm
hơn). Test số: 101 (v030) + 13 (v034) + 41 (v037) + 44 (v038) + 688 mới
(v039: hình học mount lá LTR/RTL × tới/lui + spread cuối, MOBI lười
trên fixture 400MB thật, mô phỏng 200 lần lật nhanh tới-lui + nhảy giữa
chừng, URL protocol, palmdocDecompress, đo base64 vs protocol) — tất
cả pass. Fixture + generator lưu ở
`~/workspace/goals/pc-book-reading-software/hidden_files/` (mobi/cbz
tổng hợp + script sinh + file test v039).

### v0.3.8 — hết lệch nhãn/ảnh khi lật nhanh: port cơ chế chống lệch của bản web (27/11/2026)
Thiện gửi video test v0.3.7 (cài sạch, sidebar đã ghi v0.3.7): nhãn
"Trang 72–73" rồi "Trang 70–71" nhưng 2 trang hiện ra giống hệt nhau
— lật đổi số trang mà ảnh không đổi. Lần thứ 2 mẫu này xuất hiện (lần
trước spread 58–59 vs 60–61 cùng ảnh tháp). Điều tra kỹ thì không phải
"ảnh đứng yên" mà là **nhãn và ảnh BỊ TÁCH RỜI**: cùng nhãn 72–73 hiện
3 spread khác nhau, cùng 1 spread xuất hiện dưới 2 nhãn (72–73 và
76–77).

**Gốc lỗi (đã kiểm chứng bằng code):** `<img>` trang không có `key`
nên React tái dùng cùng node DOM, chỉ đổi `src` sang data-URL base64
mới (vài MB/trang); trình duyệt giữ ảnh cũ tới khi ảnh mới giải mã
xong, trong khi nhãn commit tức thì trong `finishFlip`. Lật nhanh thì
các lần giải mã hoàn thành không theo thứ tự, ảnh hiện ra có thể là
bất kỳ spread nào vừa lật qua. Bản web tránh được bằng cell có key
theo chỉ số trang + `ensurePage` trả về pending promise + flip chờ
giải mã xong mới commit — v0.3.8 port đúng 3 cơ chế đó sang desktop,
không viết lại:

1. **Cell có key theo chỉ số trang** (Reader.tsx `renderFace` +
   slot trái/phải + mặt trước/sau của `CurlLeaf`): đổi trang thì
   mount node DOM mới cho đúng trang đó; trang chưa nạp xong hiện
   "Đang tải trang…" (chuỗi này đã có sẵn) thay vì ảnh sai.
2. **`ensure` trả về pending promise** (`src/lib/pending.ts` mới —
   `PendingMap`, như `pendingRef` của bản web): trang đang inflight
   thì caller chờ đúng promise đó thay vì tiến hành với trang trống.
   Trước đây `ensure` bỏ qua trang inflight rồi trả về ngay. `jumpTo`
   và `commitSlider` (thanh trượt dưới) giờ cũng `await ensure` +
   `await decodeImages` trước khi đổi spread — trước đây nhảy ngay
   nên nhãn đổi trước, ảnh về sau.
3. **Lật chỉ commit sau khi trang đích đã giải mã xong:**
   `startFlip` và `beginDragFlip` đều `await ensure(dest)` +
   `await decodeImages(dest)` TRƯỚC khi mount lá và TRƯỚC
   `finishFlip`; không commit nhãn sớm.
4. **Bỏ `curlTarget` toàn cục, nền tính theo từng flip**
   (`src/lib/spread.ts` mới — `flipBaseSides`, như `baseIdxs` của bản
   web): bên lật lấy trang đích của nó, bên còn lại giữ trang hiện
   tại (trừ khi đang trống — vd bìa RTL đứng một mình — thì lấy trang
   đích để không bị trống trong lúc lật); nền dọn cùng lúc với lá.
   Kích thước slot và hình học lá theo spread HIỆN TẠI (không theo
   nền đang lật) để slot không đổi rộng giữa chừng làm lá rách.
5. **Kéo:** `onPointerDown` chỉ ghi nhận `pendingDragRef` (chưa mount
   lá, chưa khóa lật); mount lá + build flip chỉ sau khi di chuyển
   >9px (`beginDragFlip`, sau khi decode xong); thả tay giữa lúc
   đang chờ decode thì hủy mount, không lật. Thêm `onPointerCancel`
   để dọn `dragRef`/`curl`/`busyRef` khi pointer bị hủy (cửa sổ mất
   focus...). Slot có key nên node đã capture bị remount khi lá
   mount — khẳng định lại capture trên node hiện tại mỗi lần di
   chuyển để thả tay ngoài cửa sổ vẫn nhận.
6. **Chặn phím lặp:** đã có sẵn từ v0.3.7 (`if (e.repeat) return;`
   trong handler keydown) — kiểm tra lại, không sửa.

**KHÔNG đổi:** mô hình spread RTL (`spread.ts` giữ nguyên: bìa 0
đứng một mình bên phải rồi (1,2), (3,4)…) — đổi pairing sẽ lệch vị
trí đọc đã lưu, cần Thiện đồng ý trước (bước 7, chưa làm). Không đụng
`curl.ts`, `CurlLeaf.tsx` (hình học lật đã port đúng ở v0.3.7),
`layout.ts`, số liệu flip (900ms easeOutQuart, settle 170–560ms,
ngưỡng commit), thứ tự preload, API Rust, fullscreen `immersive`,
thư viện/cây thư mục/Telegram/OPDS/stats. Toàn bộ tính năng P0–P2
giữ nguyên.

**Chưa kiểm được bằng mắt** (không có WebView trên máy build): lật
nhanh qua lại nhiều trang (nhãn và ảnh phải khớp nhau), nghỉ yên 3
giây sau khi lật (ảnh không được tự đổi), chạm/kéo/phím lật — test
trên máy Thiện mới là cửa cuối. Test số: 101 (v030) + 13 (v034) + 41
(v037) + 44 mới (v038: PendingMap dedup/join/lỗi/dọn entry, nền
từng flip LTR/RTL × 1/2 trang × tới/lui + bìa RTL + gần cuối cuốn
605 trang, hợp đồng cổng commit) — tất cả pass. Rust không thay đổi
trong v0.3.8 (chỉ `Cargo.toml` version) — GitHub Actions là cửa kiểm
cuối cho Rust.

### v0.3.7 — rà soát toàn bộ + lá lật cong thật + sửa hiển thị full màn (27/11/2026)
Thiện gửi video test mới: lật trang hiệu ứng cực kém, lật bị lỗi; full
màn thì spread lệch (trang trái cụt, bên phải đen lớn); cửa sổ thường
thì trang phải bị cắt. Rà soát toàn bộ, map từng hiện tượng sang đúng
cơ chế trong code:

**Hiển thị / căn giữa — gốc lỗi là `transformOrigin: "top center"`**
(Reader.tsx, style của `.spread`): spread dùng `transform: scale(...)`
với origin ở giữa, nên visual của spread lệch khỏi khung
`.spread-scaler` một đoạn `naturalW*(1-scale)/2` — full màn scale ≈
1.93 thì lệch trái ~375px: trang trái cụt ở mép trái, bên phải đen
~550px, đúng y frame f25/f42 trong video. Sửa: origin `"top left"`
(visual khớp đúng scaler) + `.spread-scaler { margin: auto; }` thay cho
`justify-content: center` trên viewport (bẫy tràn flexbox: scaler rộng
hơn viewport thì phần tràn bên trái không cuộn tới được vì scrollLeft
không âm) + reset scroll viewport khi vào/ra full màn và sau mỗi lần
lật đáp (scroll cũ còn sót cũng làm spread lệch). Công thức fit
(naturalW/fitScale/slot ôm tỉ lệ ảnh) đúng, đã tách ra `src/lib/layout.ts`
(`computeSpreadLayout`, `spreadVisualRect`) để test số được.

**Hiệu ứng lật — nói thẳng: lá cũ KHÔNG THỂ đẹp được.** Lá cũ là một
tấm phẳng `rotateY` quanh gáy + dải bóng/nếp giả chỉ đổi opacity — cứng
như bìa, không cong như giấy. v0.3.7 port đúng cơ chế curl của bản web
mà Thiện từng khen ("đọc thấy ngon"): `src/lib/curl.ts` (nếp gấp =
đường trung trực của đoạn điểm nắm → điểm nắm phản chiếu qua gáy, mặt
sau phản chiếu qua nếp gấp, depth cong nhất giữa chừng) +
`src/components/CurlLeaf.tsx` mới (5 lớp: bóng đổ mờ, dải bóng nếp gấp,
mặt trước cắt theo vùng chưa gấp + bóng cong, mặt sau phản chiếu với
nội dung soi gương sẵn, vệt sáng dọc nếp gấp; điểm giữ ghi thẳng vào
DOM từng frame qua imperative handle). Kéo lật bám tay: điểm nắm là
đúng chỗ tay bấm (kẹp trong cell), điểm giữ kẹp không lùi quá điểm nắm
(khỏi lộn nếp), vận tốc làm mượt để flick-to-turn khi thả (quá ~1/3
quãng hoặc flick nhanh thì lật hẳn, không thì nảy về), thời gian theo
quãng còn lại 170–560ms thay vì lúc nào cũng 900ms; lật bằng phím/nút/
chạm chạy cùng một lá cong theo cung quadBezier ~900ms easeOutQuart;
nạp + giải mã spread đích TRƯỚC khi lật để mặt sau không nháy đen;
đổi bố cục giữa chừng (1/2 trang, RTL, fit, zoom) thì hủy cú lật đang
chạy (lá khỏi rách vì cell/gáy cũ).

**Nội dung lặp ở spread 58–59 vs 60–61: KHÔNG PHẢI lỗi code.** Đã kiểm
hết đường hiển thị trang (`spreadSides`/`spreadStartForPage`/
`leafForFlip` đúng chỉ số, 101 test cũ vẫn pass; cache key theo chỉ số
trang; label lấy từ `cur`) — không có đường nào trong code TS khiến
cùng 1 ảnh hiện 2 lần. Logic ghép trang để nguyên. Thiện kiểm tra bằng
cách mở đúng 2 trang đó trong một app đọc CBZ khác: nếu vẫn lặp thì
file CBZ gốc lặp ảnh; nếu không lặp thì báo lại để rà tiếp phía Rust
(`cbz_page`, không biên dịch được trên máy này).

**Chưa kiểm được bằng mắt** (không có WebView trên máy build): hiệu ứng
cong thật, cảm giác kéo/chạm, và spread căn giữa trên màn hình thật —
test trên máy Thiện mới là cửa cuối. Test số: 101 (v030) + 13 (v034) +
41 mới (v037: fit cửa sổ/full màn, ảnh ngang, căn giữa/không tràn,
đổi kích thước khi vào/ra full màn, hình học curl, tweenPoint,
kéo-thả) — tất cả pass. Rust không biên dịch được trên máy này (không
có cargo) — GitHub Actions là cửa kiểm cuối cho Rust.

### v0.3.6 — rà soát lại toàn bộ đường lật/bôi đen + hiện số phiên bản (27/11/2026)
Thiện báo v0.3.5 vẫn lỗi y như v0.3.4 (trang vẫn xanh lè khi kéo lật).
Rà soát lại toàn bộ thì code v0.3.5 đúng trên lý thuyết (CBZ thì `isComic`
đúng, class `img-book` có, CSS `user-select: none` có, `removeAllRanges`
có ở 4 chỗ) — khả năng lớn nhất là máy Thiện vẫn đang chạy bản cũ (cài
đè trong lúc app đang mở thì file không thay được, hoặc tải về mà chưa
chạy file cài) nên lỗi y hệt. Để chặn cả 2 khả năng: (1) chặn bôi đen
thêm 3 lớp nữa — từng slot ảnh có class `img` riêng với `user-select:
none`, chặn ngay sự kiện `selectstart`/`dragstart` trên spread truyện
tranh, xóa bôi đen ngay khi bắt đầu kéo (trước đây chỉ xóa sau khi lật
xong) và cả khi kéo rê lúc zoom; sách chữ vẫn bôi đen được như thường.
(2) Hiện số phiên bản luôn ở cuối sidebar ("Mio Reader v0.3.6") để Thiện
nhìn 1 cái là biết máy đang chạy bản nào — trước đây số bản chỉ nằm
trong sheet Cài đặt, khó kiểm. Chưa kiểm bằng mắt trên máy thật (không
có WebView ở máy này): lần này Thiện tắt hẳn app rồi mới cài, xong kiểm
tra sidebar ghi v0.3.6 rồi mới thử kéo lật.

### v0.3.5 — hết trang xanh lè khi kéo lật + chạm để lật trang (27/11/2026)
Thiện gửi video: lật truyện thì trang 42 bị nhuộm xanh lè cả trang, kéo
lật thì nặng, "không thể trải nghiệm nổi". Nguyên nhân: (1) kéo chuột trên
trang ảnh thì trình duyệt bôi đen cả trang ảnh (ảnh bị nhuộm xanh như khi
bôi đen chữ), mà bôi đen không tự hết sau khi lật. (2) chạm nhẹ vào trang
không lật được — phải kéo đủ dài hoặc bấm nút hẹp ở mép. Sửa: (1) spread
truyện tranh (trang ảnh) cấm bôi đen hoàn toàn (`user-select: none`, chỉ
áp cho trang ảnh — sách chữ vẫn bôi đen làm gạch chân / tra từ được) và
xóa mọi bôi đen còn sót sau mỗi lần lật. (2) chạm nhẹ vào trang (< 8px)
giờ lật trang luôn theo đúng chiều của nửa trang chạm vào. Chưa kiểm bằng
mắt trên máy thật (không có WebView ở máy này): còn cảm giác kéo/chạm trên
file thật vẫn cần Thiện thử.

### v0.3.4 — sửa hiển thị spread truyện tranh + kéo trượt trang mượt (26/11/2026)
Thiện báo v0.3.3 hiển thị vẫn lỗi: 2 trang truyện có khe đen lớn ở gáy,
trang nhỏ lọt thỏm giữa nền đen, đáy cửa sổ còn 1 thanh cuộn ngang thừa;
kéo thanh trượt trang thì thô, cứng. Nguyên nhân: (1) spread rộng cố định
1200px, mỗi slot chia đôi đúng 600px, ảnh truyện cao (tỉ lệ ~0.7) thì
`object-fit: contain` để lại 2 dải đen to 2 bên mỗi trang — gộp lại thành
khe đen ở gáy; spread 1200px * scale còn tràn ngang cửa sổ. (2) mỗi tick
kéo thanh trượt đều nạp trang + ghi lịch sử SQLite + nạp lại toàn bộ lịch
sử nên kéo giật. Sửa: (1) mỗi slot ôm đúng tỉ lệ thật của trang ảnh (đo
từ ảnh đã giải mã / sự kiện onLoad, chưa biết thì tạm 0.72), 2 trang khít
nhau ở gáy, lá lật + bóng đổ cũng lấy đúng bề rộng slot thật; sách chữ
giữ chia đôi như cũ; lá lật thêm `will-change: transform`. (2) kéo thanh
trượt chỉ đổi vị trí hiển thị, thả ra mới nhảy trang. (3) `html, body`
`overflow-x: hidden` để không còn thanh cuộn ngang ở cấp cửa sổ (cuộn khi
zoom vẫn nằm trong vùng đọc). Chưa kiểm bằng mắt trên máy thật (không có
WebView ở máy này): phép tính bề rộng đã kiểm bằng test số, còn cảm giác
lật/kéo trên file thật vẫn cần Thiện thử.

### v0.3.3 — màn "Thư mục": duyệt cây thư mục như Explorer (26/11/2026)
Thiện cần duyệt thư mục truyện theo từng tầng (Truyện tranh → Hesman →
Hesman.2 → từng file PDF...) chứ không phải thêm thư mục to là app đổ
tất cả sách vào 1 danh sách phẳng. Mới: mục "Thư mục" ở sidebar; lệnh Rust
`list_folder` liệt kê con trực tiếp của 1 thư mục (thư mục con trước rồi
tới file sách, mỗi nhóm sắp theo tên, không đệ quy); màn FolderTree hiển
thị breadcrumb + nút "Lên", bấm thư mục để đi vào, bấm sách để mở đọc.
Thư viện phẳng cũ vẫn giữ nguyên. Màn này dùng chung thư mục gốc đã chọn
ở Nguồn sách; chưa chọn thì có nút chọn thư mục.

### v0.3.2 — CBZ lớn (~300MB) hết đơ + lật trang mượt (26/11/2026)
Thiện báo: mở file CBZ tầm 300MB thì app đơ cứng, Windows hiện "Mio Reader
is not responding"; lật trang lag giật. Nguyên nhân chính ở backend Rust:
mỗi lần nạp 1 trang (`cbz_page`) đều chạy lại toàn bộ `cbz_index` — mở file,
`by_index` từng entry, sắp xếp lại — rồi mới giải nén trang đó; mở sách là
4 lần quét, mỗi lần lật lại quét thêm, bìa/lưới cũng quét ké. Trên ổ chậm
là đơ cứng. Sửa: cache chỉ mục CBZ theo (đường dẫn, kích thước, thời gian
sửa) trong AppState (tối đa 8 file), `cbz_page` dùng cache + `by_index`
thẳng tới entry — mỗi trang chỉ còn 1 lần mở file + 1 lần giải nén. Ngoài
ra `downscaleDataUrl` (thumbnail lưới trang) chuyển sang createImageBitmap
resize ngoài luồng chính, có fallback về img+canvas nếu không hỗ trợ.
Không đổi hành vi đọc sách nào khác; lật trang vẫn chờ nạp + giải mã spread
đích trước khi lật (giờ đã nhanh vì hết quét lại file).

### v0.3.1 — sửa lỗi bìa "Tiếp tục đọc" nuốt cả app (26/11/2026)
Thiện cài v0.3.0, mở app lên thấy 1 trang truyện (bìa Bloody Monday) chiếm
hết cửa sổ, không bấm được gì, không thoát được. Nguyên nhân: ảnh bìa trong
thẻ "Tiếp tục đọc" (`.cc-cover img`) dùng `position: absolute; inset: 0`
nhưng `.cc-cover` thiếu `position: relative` — nên ảnh không nằm gọn trong
khung 118×158 mà bung ra đúng bằng cửa sổ, đè lên toàn bộ sidebar, nút bấm,
thư viện (cả huy hiệu CBZ cũng trôi lên góc phải cửa sổ). Chỉ xảy ra khi có
cuốn CBZ local đang đọc dở (bìa tải từ trang đầu của file); bìa gradient
(EPUB/PDF/MOBI, Telegram) không bị. Sửa 1 dòng: thêm `position: relative`
cho `.cc-cover`. Đã rà toàn bộ các phần tử `position: absolute` khác trong
styles.css — chỉ chỗ này thiếu khung chứa.

### v0.3.0 — làm lại giao diện theo thiết kế đã duyệt
Thiện xem bản 0.2.0: "có cải tiến, cơ mà giao diện ứng dụng tao vẫn không
thể thẩm nổi" — nhờ lên 1 thiết kế UI, duyệt rồi bảo "làm lại theo đúng
giao diện này". Bản này làm lại giao diện theo đúng artifact "Thiết kế UI
Mio Reader" (mực–giấy–đỏ đèn lồng, Noto Serif + Be Vietnam Pro), không bỏ
tính năng nào, chỉ sắp xếp lại.

- **Khung app mới:** sidebar tối 212px (Thư viện / Đang đọc / Thống kê /
  Nguồn sách, "Kệ của tôi": Đã đánh dấu, Đã tải xuống, dung lượng kệ,
  Cài đặt) + màn hình chính. Không còn thanh topbar cũ.
- **Thư viện (kệ sách):** thẻ "Tiếp tục đọc" (cuốn đang đọc dở, tiến độ,
  nút Đọc tiếp), lưới bìa sách (gradient theo định dạng + gáy sách; bìa
  CBZ dùng ảnh trang đầu tải lười), chip lọc: Tất cả / Máy này / Telegram
  / OPDS / Truyện tranh / Đang đọc dở, ô tìm tên sách. Thư mục đã chọn
  được nhớ lại (mở app lên là kệ có sẵn sách, không cần chọn lại).
- **Trình đọc (giấy):** nền sân khấu tối #262019, thanh trên là viên thuốc
  (tiêu đề + 5 nút hàng ngày: đánh dấu, tìm, Aa, đọc thành tiếng, toàn
  màn hình + nút ⋯), thanh dưới có thanh trượt vị trí, tag truyện tranh
  "Trang 98 / 214 · RTL", vùng bấm lật ở 2 mép (dải hẹp, không che vùng
  kéo lật giữa trang), toast báo xác nhận thao tác.
- **Menu ⋯ thành sheet trượt phải** (thay menu thả xuống + panel bên):
  nhóm Đọc (toàn màn hình, kiểu trang 2/1, manga RTL, tự cắt lề trắng +
  chỉnh tay 4 phía, thu phóng + vừa trang/rộng/cao), Trang này (đánh dấu,
  danh sách đánh dấu, gạch chân đã lưu, lưới trang, tìm, chữ & nền trang),
  Nghe & tra cứu (đọc thành tiếng + chọn giọng/tốc độ, tra từ điển),
  Cuốn sách (thông tin sách, thống kê đọc). Sheet riêng cho Chữ & nền
  trang (cỡ chữ 13.5–19, giãn dòng 1.5–2.1, Serif/Sans, nền Sáng/Giấy/Đêm
  — nhớ theo từng cuốn), Tìm trong sách (kết quả bôi vàng từ khóa),
  Lưới trang, Đánh dấu, Gạch chân.
- **Truyện tranh auto-RTL:** mở CBZ/CBR chưa có cài đặt riêng thì RTL
  mặc định BẬT (bìa lẻ bên phải, spread (1,2), (3,4)... theo mô hình
  `spread.ts` đã chứng minh ở v0.2.0 — bản thiết kế ghi "(2,3), (4,5)"
  theo cách đếm trang từ 1, cùng 1 thứ). Tắt trong menu thì nhớ theo
  từng cuốn. Sách chữ/PDF vẫn theo mặc định chung trong Cài đặt.
- **Màn Thống kê mới:** 4 thẻ (thời gian tuần này, trang tuần này, chuỗi
  ngày, trung bình/ngày — kèm % so với tuần trước), biểu đồ cột 7 ngày
  gần nhất (phút đọc/ngày, cột cao nhất tô đỏ), từng cuốn (tiến độ, nút
  Đọc tiếp). Dữ liệu tuần lấy từ `per_day` mới trong `stats_summary`
  (Rust trả tổng 14 ngày gần nhất; lệnh mới `bookmarks_book_count` cho
  số đếm "Đã đánh dấu" ở sidebar).
- **Màn Nguồn sách mới:** 3 thẻ (Telegram / OPDS / thư mục trên máy) +
  panel mở ngay dưới: TelegramPanel (đăng nhập MTProto như cũ, chỉ nạp
  GramJS khi mở thẻ), OPDS (duyệt + tải về, file tải qua OPDS được nhớ
  để lọc chip OPDS trong thư viện), đổi thư mục quét kệ.
- **Cài đặt** (sidebar): công tắc manga RTL mặc định, kiểm tra cập nhật
  (banner cũ), phiên bản. Font Noto Serif / Be Vietnam Pro tải từ Google
  Fonts khi có mạng, không có mạng thì fallback Georgia/system-ui.
- **Thay đổi nhỏ so với thiết kế (ghi rõ):** (1) không làm thanh
  titlebar giả có 3 chấm tròn — cửa sổ thật của Tauri đã có titlebar của
  Windows; (2) vùng bấm lật 2 bên chỉ rộng tối đa 72px (thiết kế ghi 22%)
  để không che vùng kéo-lật giữa trang; (3) công tắc "Hiệu ứng lật trang"
  bỏ khỏi menu — lật cong luôn bật; (4) "Đã đánh dấu" trong sidebar chỉ
  hiện số đếm (bấm vào thì về thư viện, chưa có màn riêng liệt kê mọi
  bookmark của mọi cuốn); (5) tag "Trang X / N · RTL" chỉ hiện với truyện
  tranh; (6) số trang nhỏ dưới trang chữ chỉ hiện với sách chữ, không
  hiện trên trang ảnh.
- **Giữ nguyên, đã test lại bằng Node (102 test, xem /tmp/v03-test/test.ts
  — file test không đưa vào repo):** thứ tự đọc 0→5 đủ trang ở cả 4 chế
  độ (1/2 trang × LTR/RTL), spread manga + lá lật đúng trang, mặt sau
  không ngược khi nhìn thấy được (pre-mirror cho hệ số âm — lỗi cũ),
  auto-RTL, tổng tuần + nhãn thứ + % thay đổi tuần.
- **Chưa test được ở đây:** như các bản trước (không cargo/WebView) —
  cần Thiện test trên máy thật: sidebar/màn hình mới, sheet menu, cỡ chữ
  + nền trang có áp dụng đúng không, manga auto-RTL khi mở CBZ mới,
  biểu đồ tuần có đúng số liệu không, Telegram/OPDS trong màn Nguồn sách.

### Còn lại sau P2
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
  dependency thì gửi lỗi cho tao. Riêng lệnh Rust mới của P1/P2 (liệt kê/xóa
  bookmark, highlight, settings, thống kê đọc, ghi file OPDS) cũng chưa biên
  dịch được ở đây — code viết theo đúng mẫu lệnh cũ đã chạy, nhưng vẫn cần
  build thật để chốt.
- **Gạch chân PDF chưa có.** Trang PDF render thành ảnh JPEG nên không
  chọn được chữ để gạch; chỉ có nền vàng khi nhảy tới kết quả tìm. Muốn
  gạch tự do trên PDF phải thêm text layer của pdf.js (việc lớn, để P2
  hoặc sau).
- **Lưới trang 2000 trang render đủ 2000 ô DOM** (chỉ thumbnail là lười).
  Với truyện rất dài, lúc mở lưới lần đầu có thể khựng nhẹ; chưa ảo hóa
  danh sách (virtualization) ở P1.
- **Tìm trong PDF dày sẽ chậm:** phải đọc text từng trang (getTextContent),
  PDF vài trăm trang mất vài giây tới vài chục giây; đã có tiến độ + nút
  Hủy. Tìm EPUB/MOBI thì nhanh (text đã nằm trong RAM).
- **CBZ 200MB+ (P0 đã test bằng file giả lập, xem dưới).** Từ v0.1.2 Reader
  đã nạp lười từng trang khi lật tới (local + Telegram) và giải mã spread
  đích trước khi lật. P0 đã kiểm chứng trên CBZ giả lập ~200MB / 2000 trang
  (xem "Kiểm chứng P0" dưới) — nhưng chưa ai đọc thử bộ Bloody Monday
  200MB thật tới cuối trên máy mày.
- **PDF (v0.1.3): đã đọc được thật, nhưng có giới hạn.** pdf.js 6.5.438
  render từng trang qua range transport (xin theo đoạn 64KB qua lệnh Rust
  `read_range`, cache tối đa 12 trang đã render). Đã đo: lúc mở, pdf.js
  vẫn kéo hết các chunk của file (nó duyệt cây tài liệu lúc setup) và
  `ChunkedStream` cấp sẵn buffer dài bằng file — nên file PDF 200MB lúc
  mở sẽ đọc ~200MB và giữ buffer ~200MB trong RAM; cái "lười" thật sự là
  ở khâu render từng trang (chỉ render trang đang xem). File PDF có mật
  khẩu chỉ báo "file có mật khẩu, chưa mở được" (chưa có chỗ nhập mật khẩu
  ở P0). PDF dùng font lạ/CJK có thể thiếu glyph (chưa kèm CMap).
- **MOBI/AZW3 (v0.1.3): đã đọc được thật, nhưng có giới hạn.** Parser
  PalmDB/MOBI viết tay (`src/lib/mobi.ts`), đã test trên file MOBI tự tạo:
  PalmDOC nén/không nén, chia trang theo `<mbp:pagebreak>`, ảnh nhúng trong
  sách hiện được. Chưa test trên MOBI thật mua từ Kindle/Calibre (cấu trúc
  EXTH/Huffman có thể khác). File nén Huffman/CDIC (compression 17480) và
  file chỉ có KF8 (AZW3 không còn phần Mobi7) báo lỗi rõ, chưa đọc được.
  File DRM báo rõ "có DRM, không mở được".
- **CBR (v0.1.3): đã mở được thật, nhưng có giới hạn.** Dùng node-unrar-js
  (WASM từ lib unrar chính thức), đọc lười từng trang như CBZ, không cần
  cài gì thêm trên Windows. Đã test RAR5 thường/solid/stored + file có mật
  khẩu (báo rõ). Giới hạn: toàn bộ file RAR phải nạp vào RAM trước khi mở
  (RAR 200MB+ sẽ nặng máy — truyện lớn nên dùng CBZ); không mở được RAR
  nhiều tập và RAR mã hóa header; RAR4 chưa test bằng file thật (chỉ biết
  lib unrar 6.1.7 hỗ trợ RAR4); file solid lật trang cuối chậm hơn vì lib
  phải giải nén phần trước.
- **Không ký code:** .exe/.msi unsigned, SmartScreen hỏi lần đầu là bình
  thường.

## Kiểm chứng P0 (v0.1.3) — chạy trên VM Linux, không có cargo/WebView

Test tự động (`/tmp/p0-test/test.mjs`, bundle bằng esbuild rồi chạy Node):
24/24 PASS — PalmDOC decode ví dụ chuẩn của spec; MOBI nén/không nén
(tiêu đề, 3 trang, ảnh nhúng, lỗi DRM); PDF 3 trang render ra JPEG,
PDF 3000 trang (~1.1MB) render trang cuối, transport xin theo đoạn
64KB; CBR RAR5 thường/solid/stored (byte trang trùng file gốc theo
SHA256), RAR có mật khẩu → lỗi rõ, file rác → lỗi rõ.

CBZ ~200MB giả lập: đã kiểm chứng ngày 2026-11-25 trên file tự tạo
424.2 MB / 2000 trang JPEG (~224KB/trang, to hơn mục tiêu 200MB nên
càng nặng hơn file thật cần test). Mở file: đọc đuôi ZIP + central
directory hết 12 ms, liệt kê đủ 2000 trang. Lật tới trang đầu/giữa/
cuối: 7 ms / 4 ms / 3 ms, mỗi lần chỉ giải nén đúng 1 trang (~224KB),
RAM tăng thêm 2.8 MB trong lúc test 3 trang — tức là đường đọc lười
không nạp cả file vào RAM. Lưu ý: đây là kiểm chứng cấu trúc file ZIP
+ cùng kiểu truy cập như lệnh Rust `cbz_index`/`cbz_page` (đọc đuôi
file rồi giải nén từng trang), chạy bằng Node trên VM — lệnh Rust thật
và app thật trên WebView chưa chạy được ở đây (không có cargo), nên
vẫn cần Thiện đọc bộ Bloody Monday thật tới cuối trên máy để chốt.

Chưa kiểm chứng được ở đây (cần máy Windows của mày): mở PDF/MOBI/CBR
thật trong app (WebView2), đọc CBZ Bloody Monday 200MB thật tới trang
cuối, Telegram range-download với tài khoản thật.

## Kiểm chứng P2 (v0.1.5) — chạy trên VM Linux, không có cargo/WebView

Test tự động (`/tmp/test-p2.mjs`, bundle bằng esbuild rồi chạy Node):
55/55 PASS — thống kê (số ngày, streak, định dạng thời gian); TTS tách
câu (dấu `. ! ? …`, ngoặc kép) + tìm câu bỏ qua khoảng trắng; từ điển
(bóc JSON dictionaryapi.dev, lỗi 404/mất mạng/từ tiếng Việt, link
Wiktionary); OPDS (nối URL, nhận link sách theo type/đuôi file, đoán
đuôi file, tên file an toàn, bóc feed OPDS v2 JSON: tiêu đề, mục duyệt,
template tìm kiếm, tác giả dạng object/mảng, lọc link không phải sách).

Chưa kiểm chứng được ở đây (cần máy Windows của mày): giọng TTS thật
trên WebView2 (danh sách giọng + chất lượng giọng Việt), tra từ điển
qua mạng thật, duyệt + tải OPDS từ server thật (Kavita/Komga/Calibre —
đặc biệt là CORS), thống kê đọc sau vài ngày đọc thật (streak), lệnh
Rust mới biên dịch trên GitHub Actions.

## Kiểm chứng v0.2.0 — chạy trên VM Linux, không có cargo/WebView

Test tự động (`/tmp/v02-test/test.mjs`, bundle bằng esbuild rồi chạy Node):
90/90 PASS — spread LTR/RTL (bìa manga đứng một mình bên phải, rồi
(2,3), (4,5)...; trang đọc trước bên phải), thứ tự đọc manga 6 trang
đúng 0→5 không sót không lặp, lá lật đúng trang trước/sau + đúng phía
gáy cho cả 4 chế độ (1/2 trang × LTR/RTL, tới/lui), lật 1 trang hiện
đúng trang đích (không phải đích+1 như bản cũ), trường hợp biên (sách
lẻ trang, sách 1 trang, trang ngoài khoảng), và hệ số ngang mặt sau
của lá ở tiến độ 0.6/0.75/0.9/1.0 cho cả 2 phía gáy: bản cũ (soi gương
sẵn) ÂM = hiện ngược, bản mới (không soi gương sẵn) DƯƠNG = hiện đúng
chiều, đúng +1 lúc lật xong.

Chưa kiểm chứng được ở đây (cần máy Windows của mày): nhìn bằng mắt
xem lật còn ngược không (nhất là truyện ảnh CBZ — test trên chỉ chứng
minh bằng số học, chưa render khung hình giữa cú lật), đọc chìm có ẩn
hết chrome không (kể cả khi WebView chặn fullscreen thật), manga lật
đúng chiều + đúng trang chưa, menu mở/đóng + các thẻ nổi có mượt không,
lệnh Rust không đổi nên build Actions chủ yếu để chốt frontend mới.

## Cấu trúc code

```
src/                  Frontend React + TypeScript + Vite
  App.tsx             Thư viện + mở sách local/Telegram + lưu tiến độ
  components/Reader.tsx    Trình đọc 2 trang, page-curl (fold geometry,
                           mặt sau KHÔNG soi gương — CSS rotateY(180°)
                           đã triệt tiêu, rAF ghi thẳng DOM); menu ⋯ duy
                           nhất; đọc chìm toàn màn hình; manga RTL
  components/Library.tsx   "Đang đọc dở" + sách trên máy
  components/TelegramPanel.tsx  Đăng nhập Telegram, liệt kê Saved Messages
  components/UpdateBanner.tsx   Banner + nút "Kiểm tra cập nhật" (OTA kiểu
                           GitHub Releases, xem src/lib/update.ts)
  lib/spread.ts       Mô hình spread/lá lật thuần (LTR/RTL, 1/2 trang,
                      hệ số ngang mặt sau để chứng minh lỗi ngược ảnh)
  lib/curl.ts         Hình học nếp gấp (đã chứng minh ở bản web)
  lib/telegram.ts     GramJS MTProto: login, list, tải theo byte-range,
                      đọc chỉ mục ZIP CBZ từ đuôi file
  lib/update.ts       So version hiện tại với Release mới nhất trên
                      GitHub, trả link tải .msi (không cần ký số)
  lib/api.ts          Gọi lệnh Rust qua Tauri invoke
  lib/files.ts      Đọc file local theo đoạn (read_range), base64, nhận
                    dạng ảnh theo magic bytes
  lib/pdf.ts        pdf.js 6.5.438: mở PDF qua range transport 64KB,
                    render từng trang ra JPEG (cache 12 trang),
                    polyfill ES2025 (toHex/toBase64/Map upsert/
                    Math.sumPrecise) cho WebView2 cũ; font chuẩn
                    trong public/standard_fonts/
  lib/mobi.ts       Parser PalmDB/MOBI viết tay: PalmDOC, EXTH, ảnh
                    nhúng, chia trang theo pagebreak (không DRM,
                    không Huffman, không KF8-only)
  lib/cbr.ts        node-unrar-js (WASM): mở RAR/RAR5, đọc lười
                    từng trang như CBZ
  lib/stats.ts      (P2) Hàm thuần thống kê đọc: số ngày, streak, định
                    dạng thời gian — test được bằng Node
  lib/tts.ts        (P2) TTS qua speechSynthesis: tách câu, engine đọc
                    từng câu, tô câu đang đọc (mark.tts-current)
  lib/dictionary.ts (P2) Tra từ dictionaryapi.dev + link Wiktionary
  lib/opds.ts       (P2) OPDS v1 (Atom XML) + v2 (JSON): bóc feed, tìm
                    kiếm OpenSearch, đoán đuôi file, tên file an toàn
  components/StatsView.tsx   (P2) Mục thống kê đọc trong thư viện
  components/OpdsPanel.tsx   (P2) Duyệt catalogue OPDS + tải sách về
  components/DictionaryBox.tsx (P2) Ô tra từ trong trình đọc
public/standard_fonts/  Font chuẩn của pdf.js (Foxit .pfb + Liberation
                    .ttf) — copy từ node_modules/pdfjs-dist/standard_fonts/
src-tauri/            Backend Rust (Tauri v2)
  capabilities/default.json   Quyền: core, dialog, opener (mở link tải)
  src/main.rs         Lệnh: chọn file/thư mục, list sách, cbz_index,
                      cbz_page (chỉ 1 trang), read_range, epub_toc/chapter,
                      thống kê đọc (P2: stats_session/summary/per_book),
                      write_file_bytes (P2: ghi sách tải từ OPDS)
  src/db.rs           Khởi tạo SQLite
  src/history.rs      Lịch sử đọc + bookmark + relink file bị dời
                      + highlight + thống kê đọc (P2: reading_sessions)
  src/epub.rs         Đọc EPUB trong RAM (container.xml + opf + ncx)
.github/workflows/build-windows.yml   Build .exe/.msi trên GitHub Actions
```

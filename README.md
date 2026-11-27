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

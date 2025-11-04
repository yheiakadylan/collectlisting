Etsy Userscripts — 1-Click Install

Hai tiện ích Tampermonkey giúp thu thập URL listing từ Etsy theo Shop + Keyword và xuất CSV kèm đường dẫn ảnh để chạy tự động (UI.Vision) khi đăng sản phẩm lên Temu.

<p align="center"> <a href="https://github.com/yheiakadylan/collectlisting/raw/refs/heads/main/etsy-collect-url-listing.user.js"> <img alt="Install Collect URL Listing" src="https://camo.githubusercontent.com/6a472c25989fc986b8eb91d1b3b7354f651560a16778fc8884ead6811ae87a0f/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f4325433325413069253230254334253931254531254241254237742d5363726970742d626c75653f7374796c653d666f722d7468652d6261646765"> </a>  <a href="https://github.com/yheiakadylan/collectlisting/raw/refs/heads/main/etsy-txt-to-csv.user.js"> <img alt="Install TXT → CSV" src="https://camo.githubusercontent.com/6a472c25989fc986b8eb91d1b3b7354f651560a16778fc8884ead6811ae87a0f/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f4325433325413069253230254334253931254531254241254237742d5363726970742d626c75653f7374796c653d666f722d7468652d6261646765"> </a> </p>

🧰 Các script có gì?
Script	Chức năng chính	Dùng khi…
Etsy Collect URL Listing	Vào shop → nhập keyword 1 lần → quét URL listing trong grid → chuyển trang bằng nút trong .wt-action-group (ổn định kể cả Etsy ẩn ?page).	Bạn cần danh sách URL listing chuẩn, để đưa vào file TXT đầu vào cho script CSV.
Etsy TXT → CSV	Đọc TXT (mỗi dòng là URL listing hoặc URL shop). Với shop: tự gom URL từ tab Items. Vào từng listing → đợi Tags/Images → bấm Download all images → đợi tải ảnh xong → xuất CSV: title,img1..img7.	Bạn muốn có file CSV + đường dẫn ảnh để nhập vào UI.Vision khi listing lên Temu.
🚀 Cài đặt (1-Click)

Bấm nút Install là Tampermonkey sẽ bật popup cài đặt → chọn Install.

A) Etsy Collect URL Listing

Cài đặt:
https://github.com/yheiakadylan/collectlisting/raw/refs/heads/main/etsy-collect-url-listing.user.js


B) Etsy TXT → CSV

Cài đặt:
https://github.com/yheiakadylan/collectlisting/raw/refs/heads/main/etsy-txt-to-csv.user.js
🧩 Yêu cầu trước khi dùng

Cài Tampermonkey

Chrome/Edge: https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo

Bật quyền cần thiết

Mở chrome://extensions → bật Developer mode

Vào Tampermonkey → Details:

Bật Allow User Scripts

Bật Allow access to file URLs

Cho phép tải nhiều file (multi-download)

Lần đầu chạy Etsy TXT → CSV, trình duyệt sẽ hỏi Allow multiple downloads → chọn Allow để tải ảnh tự động.

🧭 Quy trình sử dụng (đề xuất)

B1. Dùng Etsy Collect URL Listing
→ Chọn Shop + Keyword → Lấy danh sách URL listing mong muốn (để list lên Temu).

B2. Dùng Etsy TXT → CSV
→ Nạp file TXT từ B1 → Script sẽ vào từng listing, đợi Tags/Images, bấm Download all images, rồi xuất CSV (nhớ nhập path lưu ảnh cho đúng).

B3. Giải nén ảnh Etsy
→ Chọn tất cả file ảnh tải về từ Etsy → Right-click → Extract each archive to separate folder.

B4. Vào Temu + UI.Vision
→ Mở UI.Vision (tab CSV) → Paste file CSV từ B2 (xóa CSV cũ nếu có).

B5. Chạy tự động
→ Chọn … → Play loop → Nhập số vòng lặp tương ứng số sản phẩm cần list.

💡 Lưu ý & Mẹo nhỏ

Path ảnh Windows: trong CSV là các cột img1..img7. Hãy đặt thư mục tải ảnh phù hợp (ví dụ: C:\Users\<YOU>\Downloads\…) để UI.Vision đọc đúng.

Khớp phiên bản: file .user.js đã gắn @version và link CDN theo tag (v3.0.5, v1.2.0). Khi có bản mới, chỉ cần tạo tag mới (xem bên dưới).

Hiệu năng Etsy: nếu page grid không đủ 36 item, script vẫn chạy ổn (có cảnh báo nhẹ trong log).

🔧 Troubleshooting nhanh

Không thấy popup cài khi bấm Install:
Kiểm tra đã cài Tampermonkey chưa.

Không tải ảnh được / treo chờ ảnh:

Đảm bảo đã Allow multiple downloads khi Chrome hỏi.

CSV không có đủ đường dẫn ảnh:

Kiểm tra lại path thư mục ảnh trong panel script.

Đảm bảo file ảnh đã giải nén đúng cấu trúc.



Nhập TXT gồm URL listing hoặc URL shop → tự gom link từ tab Items.

Vào listing → đợi Tags/Images, bấm Download all images → chờ network idle thông minh → xuất CSV title,img1..img7.

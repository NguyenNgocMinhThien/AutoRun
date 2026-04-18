🚀 Indeed Vancouver Job Scraper (Automated)
Công cụ tự động quét tin tuyển dụng từ Indeed Canada (khu vực Vancouver) cho các vị trí tài chính và dữ liệu, sau đó gửi báo cáo trực tiếp qua Telegram. Dự án được tối ưu hóa để chạy miễn phí trên GitHub Actions.

✨ Tính năng nổi bật
Quét đa từ khóa: Tự động tìm kiếm các vị trí hot: Analyst, CFA, CEO, Data Science, FP&A.

Vượt rào cản Indeed: Sử dụng ScraperAPI với Residential Proxy giúp tránh bị chặn bởi hệ thống chống bot của Indeed.

Cơ chế Tự động thử lại (Retry): Tự động xử lý các lỗi kết nối hoặc lỗi 500 từ server để đảm bảo không bỏ sót dữ liệu.

Báo cáo tức thì:

Gửi tin nhắn tổng kết số lượng job qua Telegram.

Gửi trực tiếp file Excel (.xlsx) đính kèm vào chat Telegram.

Lưu trữ file trên GitHub Artifacts để tải về bất cứ lúc nào.

🛠 Hướng dẫn thiết lập
1. Chuẩn bị tài khoản
ScraperAPI: Đăng ký tài khoản tại ScraperAPI để lấy API Key.

Telegram Bot:

Chat với @BotFather để tạo bot và lấy API Token.

Lấy Chat ID của bạn (dùng bot @userinfobot).

2. Cấu hình GitHub Secrets
Vào Repo của bạn > Settings > Secrets and variables > Actions. Thêm 3 biến sau:

SCRAPER_API_KEY: Key từ ScraperAPI.

TELEGRAM_TOKEN: Token của bot Telegram.

TELEGRAM_CHAT_ID: ID chat nhận thông báo.

3. Cách thức vận hành
Chạy tự động: Hệ thống được cài đặt sẵn để chạy vào 07:00 - 08:00 AM (Giờ Việt Nam) hàng ngày.

Chạy thủ công:

Vào tab Actions trong GitHub.

Chọn workflow Daily Job Scraper.

Nhấn Run workflow.

📂 Cấu trúc dự án
scraper.js: Luồng xử lý chính (Scraping, Data Processing, Telegram API).

.github/workflows/cron.yml: Cấu hình lịch trình chạy tự động trên Cloud.

README.md: Hướng dẫn sử dụng dự án.

⚠️ Lưu ý kỹ thuật
Nếu gặp lỗi Status Code 500, hệ thống sẽ tự động chờ và thử lại tối đa 3 lần.

Đảm bảo gói ScraperAPI của bạn còn đủ Credit (mỗi lần quét tốn khoảng 10-25 credits cho chế độ Premium).

Dự án được phát triển nhằm hỗ trợ cộng đồng tìm kiếm việc làm tự động và hiệu quả.

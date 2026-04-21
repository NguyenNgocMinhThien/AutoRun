const axios = require('axios');
const XLSX = require('xlsx');
const cheerio = require('cheerio');
const fs = require('fs');
const FormData = require('form-data');
const { chromium } = require('playwright'); // Import Playwright
require('isomorphic-fetch');

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM GỬI TELEGRAM ---
async function sendTelegramAlert(message) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML'
        });
    } catch (e) { console.error("❌ Telegram Message Error:", e.message); }
}

async function sendTelegramFile(filePath) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId || !fs.existsSync(filePath)) return;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', fs.createReadStream(filePath));
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendDocument`, form, {
            headers: form.getHeaders()
        });
        console.log("✅ Đã gửi file Excel qua Telegram!");
    } catch (e) { console.error("❌ Telegram File Error:", e.message); }
}

// --- HÀM GỬI TEAMS QUA TRÌNH DUYỆT (FIX LỖI PERMISSION) ---
async function sendToTeamsViaBrowser(jobCount, filePath) {
    if (!process.env.TEAMS_COOKIES) {
        console.error("❌ Thiếu TEAMS_COOKIES trong Environment Secrets!");
        return;
    }

    const browser = await chromium.launch({ headless: true });
    // Tạo context trước để xử lý cookie
    const context = await browser.newContext();
    let page; // Khai báo biến page ở đây để khối catch có thể dùng được

    try {
        // 1. Lấy và chuẩn hóa Cookies
        let cookies = JSON.parse(process.env.TEAMS_COOKIES);
        
        // Fix lỗi SameSite: Chuyển các giá trị không hợp lệ về 'Lax' hoặc đúng định dạng
        const validatedCookies = cookies.map(cookie => ({
            ...cookie,
            sameSite: (cookie.sameSite === 'no_restriction' || !cookie.sameSite) ? 'None' : 
                      (cookie.sameSite.charAt(0).toUpperCase() + cookie.sameSite.slice(1).toLowerCase())
        }));

        await context.addCookies(validatedCookies);
        
        // 2. Tạo trang mới sau khi nạp cookie
        page = await context.newPage();
        
        const chatId = "19:3ANSdc3795cx7bUUlxFnh51auWa7tdyWN2KXZmKQiQEMg1@thread.v2";
        await page.goto(`https://teams.live.com/v2/?chatId=${chatId}`, { waitUntil: 'networkidle' });

        // 3. Đợi và gửi tin nhắn
        await page.waitForSelector('[data-tid="ckeditor-contentarea"]', { timeout: 60000 });
        
        const message = `🚀 CẬP NHẬT JOB MỚI\n- Tìm thấy: ${jobCount} jobs.\n- Ngày quét: ${new Date().toLocaleDateString()}`;
        
        await page.fill('[data-tid="ckeditor-contentarea"]', message);
        await page.keyboard.press('Enter');
        
        // Đợi 2 giây để đảm bảo tin nhắn đã bay đi trước khi đóng trình duyệt
        await page.waitForTimeout(2000);
        console.log("✅ Đã gửi báo cáo vào MS Teams thành công!");

    } catch (e) {
        console.error("❌ Lỗi Playwright Teams:", e.message);
        // Chỉ chụp ảnh màn hình nếu page đã thực sự được khởi tạo thành công
        if (page) {
            await page.screenshot({ path: 'teams_error.png' });
        }
    } finally {
        await browser.close();
    }
}

// --- HÀM CHẠY CHÍNH (GIỮ NGUYÊN LOGIC CỦA BẠN) ---
async function runScraper() {
    console.log("🚀 Khởi động Scraper siêu bền bỉ (Quét tối thiểu 3 lần/từ khóa)...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;
        const maxAttempts = 5;

        while (attempts < maxAttempts && !success) {
            attempts++;
            console.log(`🔍 Đang quét: ${kw} (Lần thử ${attempts}/${maxAttempts})...`);
            try {
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        proxy_type: 'residential',
                        render: 'true',
                        country_code: 'us',
                        session_number: Math.floor(Math.random() * 100000)
                    },
                    timeout: 120000
                });

                const $ = cheerio.load(response.data);
                let count = 0;
                $('.job_seen_beacon, .resultContent, [class*="jobCard"]').each((i, el) => {
                    const title = $(el).find('h2.jobTitle, a[id^="job_"]').text().trim().replace(/new/g, '');
                    const salary = $(el).find('.salary-snippet-container, .estimated-salary-container, [class*="salary"]').text().trim() || "N/A";
                    const linkSuffix = $(el).find('a[data-jk], h2.jobTitle a').attr('href');

                    if (title && title !== "N/A") {
                        allJobs.push({
                            Title: title,
                            Salary: salary,
                            Link: linkSuffix ? (linkSuffix.startsWith('http') ? linkSuffix : 'https://ca.indeed.com' + linkSuffix) : "N/A"
                        });
                        count++;
                    }
                });

                if (count > 0) {
                    console.log(`✅ Thành công: Lấy được ${count} jobs cho ${kw}`);
                    success = true;
                } else {
                    console.log(`⚠️ Trang trống tại ${kw}, đang ép thử lại...`);
                    throw new Error("Empty Page");
                }
            } catch (err) {
                console.log(`⚠️ Lần ${attempts} lỗi. Thử lại...`);
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    if (allJobs.length > 0) {
        const fileName = `Indeed_Jobs_${Math.floor(Math.random() * 1000)}.xlsx`;
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        // --- ĐOẠN FIX LỖI GỌI HÀM ---
        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs!`),
            sendTelegramFile(fileName),
            sendToTeamsViaBrowser(allJobs.length, fileName) // ĐỔI TÊN HÀM Ở ĐÂY ĐỂ KHỚP VỚI PLAYWRIGHT
        ]);
        console.log("🏁 Hoàn tất báo cáo qua tài khoản Browser/Cookies.");
    } else {
        await sendTelegramAlert("⚠️ Không lấy được dữ liệu job nào.");
    }
}

runScraper();
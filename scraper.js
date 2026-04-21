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
    if (!process.env.TEAMS_COOKIES) return console.error("❌ Thiếu TEAMS_COOKIES!");

    const browser = await chromium.launch({ headless: true });
    // Thiết lập cấu hình chuẩn để Teams không nhận diện là bot
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });
    let page;

    try {
        const cookies = JSON.parse(process.env.TEAMS_COOKIES).map(c => {
            const cookie = { ...c };
            if (cookie.sameSite) {
                const ss = cookie.sameSite.toLowerCase();
                cookie.sameSite = ss === 'lax' ? 'Lax' : ss === 'strict' ? 'Strict' : ss === 'none' ? 'None' : 'Lax';
            }
            return cookie;
        });

        await context.addCookies(cookies);
        page = await context.newPage();
        
        const chatId = "19:3ANSdc3795cx7bUUlxFnh51auWa7tdyWN2KXZmKQiQEMg1@thread.v2";
        console.log("⏳ Đang tải Teams và đợi giao diện ổn định...");
        
        // Truy cập và đợi mạng nghỉ (networkidle)
        await page.goto(`https://teams.live.com/v2/?chatId=${chatId}`, { 
            waitUntil: 'networkidle', 
            timeout: 90000 
        });

        // --- BƯỚC 1: QUÉT VÀ DỌN DẸP POP-UP ---
        const cleanUp = async () => {
            const overlays = [
                'button:has-text("Use the web app")',
                'button:has-text("Stay on web")',
                'button:has-text("Got it")',
                '.use-web-app',
                '[aria-label="Close"]'
            ];
            for (const selector of overlays) {
                if (await page.locator(selector).isVisible()) {
                    console.log(`🧹 Đang đóng overlay: ${selector}`);
                    await page.click(selector).catch(() => {});
                    await page.waitForTimeout(2000);
                }
            }
        };
        await cleanUp();

        // --- BƯỚC 2: TÌM Ô CHAT VỚI RETRY LOGIC (THỬ 3 LẦN) ---
        let chatInput = null;
        const selectors = [
            'div[contenteditable="true"]',
            '[role="textbox"]',
            '[aria-label="Type a message"]',
            '.ck-content'
        ];

        for (let i = 0; i < 3; i++) {
            console.log(`🔍 Thử tìm ô chat lần ${i + 1}...`);
            for (const selector of selectors) {
                chatInput = await page.$(selector);
                if (chatInput && await chatInput.isVisible()) {
                    console.log(`✅ Đã tìm thấy ô chat bằng: ${selector}`);
                    break;
                }
            }
            if (chatInput) break;
            
            // Nếu chưa thấy, thử dọn dẹp lại pop-up và đợi thêm
            await cleanUp();
            await page.waitForTimeout(5000);
        }

        if (!chatInput) throw new Error("Không tìm thấy ô chat sau 3 lần thử.");

        // --- BƯỚC 3: GỬI TIN NHẮN ---
        const message = `🤖 [AUTO-REPORT]\n🚀 Tìm thấy: ${jobCount} jobs mới.\n📅 Cập nhật: ${new Date().toLocaleDateString()}\n🔗 Chi tiết xem file đính kèm trên Telegram.`;
        
        await chatInput.click();
        await page.waitForTimeout(1000);
        await page.keyboard.type(message, { delay: 50 }); // Gõ chậm để kích hoạt nút gửi
        await page.keyboard.press('Enter');
        
        console.log("✅ Đã gửi báo cáo thành công!");
        await page.waitForTimeout(5000); // Chờ tin nhắn thực sự được gửi đi

    } catch (e) {
        console.error("❌ Lỗi Playwright:", e.message);
        if (page) {
            await page.screenshot({ path: 'teams_error_debug.png' });
            console.log("📸 Đã chụp ảnh màn hình debug.");
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
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
        console.error("❌ Thiếu TEAMS_COOKIES!");
        return;
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 } // Giả lập màn hình chuẩn
    });
    let page;

    try {
        let rawCookies = JSON.parse(process.env.TEAMS_COOKIES);
        const validatedCookies = rawCookies.map(cookie => {
            const c = { ...cookie };
            if (c.sameSite) {
                const ss = c.sameSite.toLowerCase();
                if (ss === 'lax') c.sameSite = 'Lax';
                else if (ss === 'strict') c.sameSite = 'Strict';
                else if (ss === 'none') c.sameSite = 'None';
                else delete c.sameSite;
            }
            delete c.id;
            return c;
        });

        await context.addCookies(validatedCookies);
        page = await context.newPage();
        
        const chatId = "19:3ANSdc3795cx7bUUlxFnh51auWa7tdyWN2KXZmKQiQEMg1@thread.v2";
        console.log("⏳ Đang tải trang Teams Chat...");
        await page.goto(`https://teams.live.com/v2/?chatId=${chatId}`, { 
            waitUntil: 'networkidle', 
            timeout: 90000 
        });

        // THỬ NHIỀU SELECTOR KHÁC NHAU (CHO CẢ BẢN CŨ VÀ MỚI)
        const selectors = [
            '[data-tid="ckeditor-contentarea"]',
            '[role="textbox"]',
            '.ck-content',
            '[aria-label="Type a message"]'
        ];

        let messageBox = null;
        for (const selector of selectors) {
            try {
                messageBox = await page.waitForSelector(selector, { timeout: 15000 });
                if (messageBox) {
                    console.log(`✅ Tìm thấy ô chat bằng selector: ${selector}`);
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        if (!messageBox) throw new Error("Không tìm thấy ô nhập liệu tin nhắn sau khi thử mọi cách.");

        const message = `🚀 CẬP NHẬT JOB MỚI\n- Tìm thấy: ${jobCount} jobs.\n- Ngày quét: ${new Date().toLocaleDateString()}`;
        
        // Click vào trước khi gõ để đảm bảo focus
        await messageBox.click();
        await page.keyboard.type(message);
        await page.keyboard.press('Enter');
        
        await page.waitForTimeout(5000); // Đợi tin nhắn bay đi
        console.log("✅ Đã gửi báo cáo thành công!");

    } catch (e) {
        console.error("❌ Lỗi Playwright Teams:", e.message);
        if (page) {
            await page.screenshot({ path: 'teams_error_debug.png' });
            // Ghi lại toàn bộ HTML lúc lỗi để soi selector mới
            const html = await page.content();
            fs.writeFileSync('page_source.html', html);
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
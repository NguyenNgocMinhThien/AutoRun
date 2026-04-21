const axios = require('axios');
const XLSX = require('xlsx');
const cheerio = require('cheerio');
const fs = require('fs');
const FormData = require('form-data');
const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
require('isomorphic-fetch'); // Cần thiết cho Graph Client

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



const { chromium } = require('playwright');

async function sendToTeamsViaBrowser(jobCount, googleSheetLink) {
    const browser = await chromium.launch({ headless: true }); // Chạy ngầm không hiện cửa sổ
    const context = await browser.newContext();
    
    // Nạp Cookies để không phải đăng nhập lại và vượt OTP
    const cookies = JSON.parse(process.env.TEAMS_COOKIES);
    await context.addCookies(cookies);
    
    const page = await context.newPage();
    
    // Truy cập thẳng vào Chat ID mà bạn đã soi được trong Network
    const chatId = "19:3ANSdc3795cx7bUUlxFnh51auWa7tdyWN2KXZmKQiQEMg1@thread.v2";
    await page.goto(`https://teams.live.com/v2/?chatId=${chatId}`);

    try {
        // Đợi ô soạn thảo văn bản xuất hiện (Selector này dành cho Teams v2)
        await page.waitForSelector('[data-tid="ckeditor-contentarea"]', { timeout: 30000 });
        
        const message = `🚀 CẬP NHẬT JOB MỚI\n- Tìm thấy: ${jobCount} jobs.\n- Link Google Sheet: ${googleSheetLink}\n(Crawl ngày: ${new Date().toLocaleDateString()})`;
        
        await page.fill('[data-tid="ckeditor-contentarea"]', message);
        await page.keyboard.press('Enter');
        
        console.log("✅ Đã gửi báo cáo vào Group Chat qua trình duyệt!");
    } catch (e) {
        console.error("❌ Lỗi thao tác trình duyệt:", e.message);
        // Chụp ảnh màn hình lỗi để debug nếu cần
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
    }
}

// --- HÀM CHẠY CHÍNH (GIỮ NGUYÊN LOGIC QUÉT CỦA BẠN) ---
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

        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs!`),
            sendTelegramFile(fileName),
            sendToTeamsGraph(allJobs.length, fileName) // Sử dụng hàm Graph API mới
        ]);
        console.log("🏁 Hoàn tất báo cáo qua tài khoản Bot riêng.");
    } else {
        await sendTelegramAlert("⚠️ Không lấy được dữ liệu job nào.");
    }
}

runScraper();
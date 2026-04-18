const puppeteer = require('puppeteer');
const axios = require('axios');
const XLSX = require('xlsx'); // Giữ nguyên xlsx như bạn muốn

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

async function sendTelegramAlert(message) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML'
        });
    } catch (e) { console.error("Telegram Error"); }
}

async function runScraper() {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    let allJobs = [];

    for (const kw of KEYWORDS) {
        // Đổi URL sang www.indeed.com để giảm khả năng bị chặn
        // Sửa dòng URL bên trong vòng lặp for:
        const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=Vancouver+BC`;

        try {
            console.log(`🔍 Đang quét: ${kw}`);
            // Tăng timeout lên 90s vì mạng GitHub đôi khi chậm
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

            // Đợi ngẫu nhiên từ 5s đến 10s
            const waitTime = Math.floor(Math.random() * 5000) + 5000;
            await new Promise(r => setTimeout(r, waitTime));

            // Kiểm tra xem có bị dính Captcha không
            const content = await page.content();
            if (content.includes("hCaptcha") || content.includes("ddos")) {
                console.log(`⚠️ Bị chặn bởi Captcha tại từ khóa: ${kw}`);
            }
            // ... tiếp tục phần page.evaluate cũ ...
            allJobs.push(...jobs);
        } catch (err) { console.log(`❌ Lỗi keyword: ${kw}`); }
    }

    await browser.close();

    if (allJobs.length > 0) {
        // Ghi file Excel
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, "Indeed_Jobs.xlsx"); // Tên file phải khớp với cron.yml

        console.log("📊 Đã tạo xong file Indeed_Jobs.xlsx");
    }
}
runScraper();
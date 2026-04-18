const puppeteer = require('puppeteer');
const axios = require('axios');
const XLSX = require('xlsx');

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

async function sendTelegramAlert(message) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML'
        });
    } catch (e) { console.error("❌ Telegram Error:", e.message); }
}

async function runScraper() {
    console.log("🚀 Đang khởi động cấu hình tối ưu cho Cloud...");

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/google-chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080'
        ]
    });

    const page = await browser.newPage();
    
    // ĐÂY LÀ DÒNG QUAN TRỌNG NHẤT: Xóa dấu vết "Headless"
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        // Sử dụng Premium Proxy và Render từ ScraperAPI
        const proxyUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=true&premium=true&country_code=ca`;

        try {
            console.log(`🔍 Đang quét: ${kw}`);
            await page.goto(proxyUrl, { waitUntil: 'networkidle2', timeout: 120000 });
            
            // Chờ lâu hơn một chút để ScraperAPI render xong HTML
            await new Promise(r => setTimeout(r, 15000));

            const jobs = await page.evaluate(() => {
                let results = [];
                // Cập nhật Selector mới nhất của Indeed năm 2026
                const cards = document.querySelectorAll('.job_seen_beacon, [class*="jobCardShelfContainer"], .result');

                cards.forEach(card => {
                    const title = card.querySelector('h2.jobTitle, [id^="job_"], a[data-jk]')?.innerText || "";
                    const salary = card.querySelector('.salary-snippet-container, .estimated-salary-container, [class*="salary-snippet"]')?.innerText || "N/A";
                    let link = card.querySelector('h2.jobTitle a, a[data-jk]')?.href || "";

                    if (title && title !== "N/A") {
                        results.push({ Title: title.replace("\nnew", ""), Salary: salary, Link: link });
                    }
                });
                return results;
            });

            console.log(`✅ Thành công: ${jobs.length} jobs cho ${kw}`);
            allJobs.push(...jobs);
        } catch (err) { 
            console.log(`❌ Lỗi tại ${kw}: ${err.message}`); 
        }
    }

    await browser.close();

    // Lưu file và gửi Telegram
    if (allJobs.length > 0) {
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, "Indeed_Jobs.xlsx");
        await sendTelegramAlert(`✅ <b>QUÉT THÀNH CÔNG!</b>\nTìm thấy <b>${allJobs.length}</b> jobs mới.\nFile đã được lưu trên GitHub.`);
    } else {
        await sendTelegramAlert(`⚠️ <b>CẢNH BÁO:</b> Vẫn chưa lấy được dữ liệu (0 jobs).\nHãy kiểm tra lại quota còn lại của ScraperAPI.`);
    }
}

runScraper();
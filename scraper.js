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
    console.log("🚀 Đang khởi động chế độ Tàng Hình tối ưu...");

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/google-chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Ẩn cờ trình duyệt tự động
            '--window-size=1920,1080'
        ]
    });

    const page = await browser.newPage();
    
    // Giả lập User-Agent của máy tính thật
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    // Ghi đè thông số webdriver để Indeed không phát hiện bot
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        // Chèn trực tiếp các tham số Premium mạnh nhất
        const proxyUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=true&premium=true&country_code=ca&wait_for_selector=.job_seen_beacon`;

        try {
            console.log(`🔍 Đang quét: ${kw}`);
            await page.goto(proxyUrl, { waitUntil: 'networkidle2', timeout: 120000 });
            
            // Cuộn trang để kích hoạt các phần tử ẩn
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await new Promise(r => setTimeout(r, 10000));

            const jobs = await page.evaluate(() => {
                let results = [];
                // Selector rộng hơn để tránh Indeed đổi tên class
                const cards = document.querySelectorAll('.job_seen_beacon, [data-testid="jobListingShell"], .result');

                cards.forEach(card => {
                    const titleEl = card.querySelector('h2.jobTitle, [id^="job_"], a[data-jk]');
                    const salaryEl = card.querySelector('.salary-snippet-container, .estimated-salary-container, [class*="salary"]');
                    
                    if (titleEl) {
                        results.push({ 
                            Title: titleEl.innerText.replace("new", "").trim(), 
                            Salary: salaryEl ? salaryEl.innerText.trim() : "N/A", 
                            Link: titleEl.querySelector('a')?.href || titleEl.href || ""
                        });
                    }
                });
                return results;
            });

            console.log(`✅ Thành công: ${jobs.length} jobs cho ${kw}`);
            allJobs.push(...jobs);
        } catch (err) { 
            console.log(`❌ Lỗi tại ${kw}: Indeed chặn hoặc quá tải.`); 
        }
    }

    await browser.close();

    // Xuất file và thông báo
    if (allJobs.length > 0) {
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, "Indeed_Jobs.xlsx");
        await sendTelegramAlert(`✅ <b>QUÉT THÀNH CÔNG!</b>\nTìm thấy <b>${allJobs.length}</b> jobs.`);
    } else {
        await sendTelegramAlert(`⚠️ <b>THẤT BẠI:</b> Indeed vẫn đang chặn Cloud. Hãy thử giảm tần suất quét.`);
    }
}

runScraper();
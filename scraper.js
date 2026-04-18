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
    console.log("🚀 Đang khởi động với cấu hình GitHub Actions...");

    const browser = await puppeteer.launch({
        headless: true,
        // Chỉ định đường dẫn Chrome có sẵn trên Linux của GitHub
        executablePath: '/usr/bin/google-chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });

    const page = await browser.newPage();
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        // Thêm &premium=true và &country_code=ca để lấy IP thật tại Canada
        const proxyUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=true&premium=true&country_code=ca`;

        try {
            console.log(`🔍 Đang quét: ${kw}`);
            await page.goto(proxyUrl, { waitUntil: 'networkidle0', timeout: 80000 });
            // Chờ thêm 10 giây để chắc chắn các thẻ job đã hiển thị
            await new Promise(r => setTimeout(r, 10000));

            const jobs = await page.evaluate(() => {
                let results = [];
                // Quét tất cả các thẻ chứa thông tin việc làm
                const cards = document.querySelectorAll('.job_seen_beacon, [data-testid="jobListingShell"]');

                cards.forEach(card => {
                    const title = card.querySelector('h2.jobTitle, [id^="job_"]')?.innerText || "";
                    const salary = card.querySelector('.salary-snippet-container, .estimated-salary-container')?.innerText || "N/A";
                    let link = card.querySelector('h2.jobTitle a, a[id^="job_"]')?.href || "";

                    if (title) {
                        results.push({ Title: title, Salary: salary, Link: link });
                    }
                });
                return results;
            });

            console.log(`✅ Tìm thấy ${jobs.length} jobs cho ${kw}`);
            allJobs.push(...jobs);
        } catch (err) { console.log(`❌ Lỗi tại ${kw}: ${err.message}`); }
    }

    await browser.close();

    // Xuất file Excel
    const dataToExport = allJobs.length > 0 ? allJobs : [{ Title: "No jobs found", Salary: "N/A", Link: "N/A" }];
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
    XLSX.writeFile(workbook, "Indeed_Jobs.xlsx");

    await sendTelegramAlert(`🚀 <b>KẾT QUẢ TỪ CLOUD:</b>\nTìm thấy <b>${allJobs.length}</b> jobs.`);
}

runScraper();
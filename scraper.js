const puppeteer = require('puppeteer');
const axios = require('axios');

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"]; // Rút gọn để test nhanh
const LOCATIONS = ["Vancouver, BC"];

async function sendTelegramAlert(message) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true
        });
    } catch (e) { console.error("Telegram Error"); }
}

async function runScraper() {
    console.log("🚀 Đang khởi động trình duyệt tàng hình...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Ẩn cờ báo hiệu là robot
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });

    const page = await browser.newPage();
    // Giả lập như người dùng thật đang dùng máy Windows
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let allJobs = [];

    for (const kw of KEYWORDS) {
        const url = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=Vancouver%2C+BC&fromage=3`;
        try {
            console.log(`🔍 Đang thử truy cập: ${kw}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Chờ ngẫu nhiên từ 3-7 giây để giống người đọc bài
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 4000) + 3000));

            const jobs = await page.evaluate(() => {
                let results = [];
                document.querySelectorAll('.job_seen_beacon').forEach(card => {
                    const title = card.querySelector('h2.jobTitle')?.innerText || "";
                    const salaryText = card.querySelector('.salary-snippet-container')?.innerText ||
                        card.querySelector('.estimated-salary-container')?.innerText || "";

                    // Logic lọc: Min $60k/năm hoặc $30/giờ
                    let isValidSalary = false;
                    if (salaryText) {
                        const s = salaryText.toLowerCase().replace(/,/g, '');
                        const num = parseInt(s.match(/\d+/));
                        if (s.includes('year') && num >= 60000) isValidSalary = true;
                        if (s.includes('hour') && num >= 30) isValidSalary = true;
                    } else {
                        isValidSalary = true; // Giữ lại các job không ghi lương để sếp check
                    }

                    if (isValidSalary) {
                        results.push({
                            title,
                            salary: salaryText,
                            link: card.querySelector('h2.jobTitle a')?.href
                        });
                    }
                });
                return results;
            });
            allJobs.push(...jobs);
        } catch (err) {
            console.log(`❌ Không thể vào trang ${kw}. Có thể bị Indeed chặn.`);
        }
    }

    await browser.close();

    if (allJobs.length > 0) {
        let msg = `<b>✅ ĐÃ TÌM THẤY ${allJobs.length} JOB PHÙ HỢP</b>\n\n`;
        allJobs.slice(0, 10).forEach((j, i) => {
            msg += `${i + 1}. <b>${j.title}</b>\n💰 ${j.salary || 'Thỏa thuận'}\n🔗 <a href="${j.link}">Link</a>\n\n`;
        });
        await sendTelegramAlert(msg);
    } else {
        await sendTelegramAlert("⚠️ Chạy thành công nhưng không tìm thấy job hoặc bị Indeed chặn truy cập.");
    }
}

runScraper();
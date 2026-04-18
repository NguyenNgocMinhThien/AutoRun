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
    } catch (e) { console.error("Telegram Error: Kiểm tra lại Secret Chat ID (phải là số)"); }
}

async function runScraper() {
    console.log("🚀 Đang khởi động trình duyệt tàng hình...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-blink-features=AutomationControlled'
        ]
    });
    const page = await browser.newPage();
    
    // Giả lập User Agent để tránh bị chặn
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let allJobs = [];

    for (const kw of KEYWORDS) {
        const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=Vancouver+BC&fromage=3`;
        try {
            console.log(`🔍 Đang quét: ${kw}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

            // Đợi ngẫu nhiên từ 5-10 giây để giống người thật
            const waitTime = Math.floor(Math.random() * 5000) + 5000;
            await new Promise(r => setTimeout(r, waitTime));

            const content = await page.content();
            if (content.includes("hCaptcha") || content.includes("ddos")) {
                console.log(`⚠️ Bị chặn bởi Captcha tại: ${kw}`);
                continue;
            }

            const jobs = await page.evaluate(() => {
                let results = [];
                document.querySelectorAll('.job_seen_beacon').forEach(card => {
                    const title = card.querySelector('h2.jobTitle')?.innerText || "";
                    const salary = card.querySelector('.salary-snippet-container')?.innerText || 
                                   card.querySelector('.estimated-salary-container')?.innerText || "";
                    const link = card.querySelector('h2.jobTitle a')?.href || "";
                    if (title) results.push({ Title: title, Salary: salary, Link: link });
                });
                return results;
            });

            console.log(`✅ Tìm thấy ${jobs.length} jobs cho ${kw}`);
            allJobs.push(...jobs);

        } catch (err) { 
            console.log(`❌ Lỗi tại từ khóa ${kw}: ${err.message}`); 
        }
    }

    await browser.close();

    // LOGIC QUAN TRỌNG: Luôn tạo file Excel để không lỗi bước Upload Artifact
    const dataToExport = allJobs.length > 0 ? allJobs : [{ Title: "No jobs found", Salary: "N/A", Link: "N/A" }];
    
    try {
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, "Indeed_Jobs.xlsx");
        console.log("📊 Đã tạo xong file Indeed_Jobs.xlsx");
    } catch (excelErr) {
        console.error("❌ Lỗi khi ghi file Excel:", excelErr);
    }

    if (allJobs.length > 0) {
        await sendTelegramAlert(`✅ Đã quét xong! Tìm thấy <b>${allJobs.length}</b> jobs.\nLink tải Excel trong tab Actions.`);
    } else {
        await sendTelegramAlert("⚠️ Đã chạy nhưng không tìm thấy job nào hoặc bị Indeed chặn.");
    }
}

runScraper();
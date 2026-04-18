const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const XLSX = require('xlsx');

// Kích hoạt chế độ tàng hình
puppeteer.use(StealthPlugin());

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// 1. HÀM GỬI TELEGRAM
async function sendTelegramAlert(message) {
    const botToken = "8737421178:AAH2ju-ExXxNeBAWf_r6nl34bJkvg5QBqHw"; 
    const chatId = "6131324160"; 
    if (!botToken || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML'
        });
        console.log("📱 Đã gửi tin nhắn Telegram thành công!");
    } catch (e) { 
        console.error("❌ Telegram Error:", e.message); 
    }
}

// ... các phần khai báo bên trên giữ nguyên ...

async function runScraper() {
    console.log("🚀 Đang chạy trên GitHub với ScraperAPI...");
    
    const browser = await puppeteer.launch({
        headless: true, // Phải là true trên GitHub
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const searchKw = `${kw} $60,000`;
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(searchKw)}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        
        // CẤU TRÚC URL MỚI QUA SCRAPERAPI
        const proxyUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=true`;

        try {
            console.log(`🔍 Đang quét qua Proxy: ${kw}`);
            await page.goto(proxyUrl, { waitUntil: 'networkidle2', timeout: 120000 });
            
            // Đợi thêm một chút để dữ liệu kịp load
            await new Promise(r => setTimeout(r, 5000));

            const jobs = await page.evaluate(() => {
                let results = [];
                document.querySelectorAll('.job_seen_beacon').forEach(card => {
                    const title = card.querySelector('h2.jobTitle')?.innerText || "";
                    const salary = card.querySelector('.salary-snippet-container')?.innerText || "";
                    const link = card.querySelector('h2.jobTitle a')?.href || "";
                    if (title) results.push({ Title: title, Salary: salary, Link: link });
                });
                return results;
            });

            console.log(`✅ Tìm thấy ${jobs.length} jobs cho ${kw}`);
            allJobs.push(...jobs);

        } catch (err) { 
            console.log(`❌ Lỗi tại ${kw}: ${err.message}`); 
        }
    }

    // 4. XUẤT FILE EXCEL
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

    // 5. GỬI THÔNG BÁO TỔNG KẾT QUA TELEGRAM
    if (allJobs.length > 0) {
        await sendTelegramAlert(`✅ <b>CHẠY TRÊN MÁY TÍNH THÀNH CÔNG!</b>\nĐã quét xong! Tìm thấy <b>${allJobs.length}</b> jobs.\nFile Excel đã được lưu tại máy tính của bạn.`);
    } else {
        await sendTelegramAlert("⚠️ Đã chạy nhưng không tìm thấy job nào hoặc bị Indeed chặn.");
    }
} // <-- Ngoặc nhọn này cực kỳ quan trọng để đóng hàm runScraper

// Bắt đầu chạy
runScraper();
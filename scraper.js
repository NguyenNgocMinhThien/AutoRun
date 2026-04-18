const axios = require('axios');
const XLSX = require('xlsx');
const cheerio = require('cheerio');
const fs = require('fs');
const FormData = require('form-data');

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// Hàm gửi tin nhắn văn bản
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

// Hàm gửi file Excel đính kèm
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

async function runScraper() {
    console.log("🚀 Khởi động Scraper với cơ chế tự động thử lại (Anti-500)...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;
        const maxAttempts = 3;

        while (attempts < maxAttempts && !success) {
            attempts++;
            console.log(`🔍 Đang quét: ${kw} (Lần thử ${attempts}/${maxAttempts})...`);

            try {
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        render: 'true',       // Ép render JS cho Indeed
                        premium: 'true',      // Dùng IP dân cư Canada
                        country_code: 'ca'    
                    },
                    timeout: 120000 // Tăng timeout lên 120s để tránh lỗi mạng
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
                    console.log(`⚠️ Trang trống cho ${kw}, có thể cần thử lại...`);
                    throw new Error("Empty Page");
                }

            } catch (err) {
                const status = err.response ? err.response.status : "Timeout";
                console.log(`⚠️ Lỗi ${status} tại ${kw}.`);
                
                if (attempts < maxAttempts) {
                    console.log(`⏳ Đang đợi 15 giây để thử lại lần nữa...`);
                    await new Promise(r => setTimeout(r, 15000)); // Đợi lâu hơn để ScraperAPI nhả luồng
                } else {
                    console.log(`❌ Đã thử ${maxAttempts} lần nhưng vẫn thất bại cho ${kw}`);
                }
            }
        }
        
        // Nghỉ 5 giây giữa các từ khóa để không làm quá tải API
        await new Promise(r => setTimeout(r, 5000));
    }

    // Xuất kết quả cuối cùng
    if (allJobs.length > 0) {
        const fileName = "Indeed_Jobs.xlsx";
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);
        
        await sendTelegramAlert(`✅ <b>QUÉT THÀNH CÔNG!</b>\nTìm thấy <b>${allJobs.length}</b> jobs mới tại Vancouver.`);
        await sendTelegramFile(fileName);
        console.log("🚀 Hoàn tất! Đã gửi file qua Telegram.");
    } else {
        await sendTelegramAlert("⚠️ <b>THÔNG BÁO:</b> Sau nhiều lần thử, vẫn không lấy được dữ liệu job nào.");
    }
}

runScraper();
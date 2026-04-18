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
    console.log("🚀 Đang khởi động phương án HTTP Request tàng hình...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        // Indeed Canada URL
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        
        console.log(`🔍 Đang lấy dữ liệu cho: ${kw}`);

        try {
            const response = await axios.get('http://api.scraperapi.com', {
                params: {
                    api_key: process.env.SCRAPER_API_KEY, //
                    url: targetUrl,
                    render: 'true',       
                    premium: 'true',      
                    country_code: 'ca'    
                },
                timeout: 90000
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

            console.log(`✅ Thành công: Lấy được ${count} jobs cho ${kw}`);

        } catch (err) {
            console.log(`❌ Lỗi tại ${kw}: ${err.message}`);
        }
        
        await new Promise(r => setTimeout(r, 4000));
    }

    if (allJobs.length > 0) {
        // 1. Tạo file Excel
        const fileName = "Indeed_Jobs.xlsx";
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);
        
        // 2. Gửi thông báo và file qua Telegram
        await sendTelegramAlert(`✅ <b>QUÉT THÀNH CÔNG!</b>\nTìm thấy <b>${allJobs.length}</b> jobs mới tại Vancouver.`);
        await sendTelegramFile(fileName);
        
        console.log("🚀 Hoàn tất mọi công việc!");
    } else {
        await sendTelegramAlert("⚠️ <b>THÔNG BÁO:</b> Đã quét nhưng không lấy được dữ liệu. Kiểm tra lại ScraperAPI.");
    }
}

runScraper();
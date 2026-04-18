const axios = require('axios');
const XLSX = require('xlsx');
const cheerio = require('cheerio');

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
    console.log("🚀 Đang khởi động phương án HTTP Request tàng hình...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        // Indeed Canada URL
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        
        console.log(`🔍 Đang lấy dữ liệu cho: ${kw}`);

        try {
            const response = await axios.get('http://api.scraperapi.com', {
                params: {
                    api_key: process.env.SCRAPER_API_KEY, // Lấy từ Secrets
                    url: targetUrl,
                    render: 'true',       // Ép ScraperAPI render Javascript
                    premium: 'true',      // Dùng IP dân cư cao cấp
                    country_code: 'ca',   // Định vị tại Canada
                    keep_headers: 'true'  // Giữ nguyên headers để tàng hình tốt hơn
                },
                timeout: 60000
            });

            const $ = cheerio.load(response.data);
            let count = 0;

            // Selector này quét sâu vào cấu trúc thẻ của Indeed
            $('.job_seen_beacon, .resultContent, [class*="jobCard"]').each((i, el) => {
                const title = $(el).find('h2.jobTitle, a[id^="job_"]').text().trim().replace(/new/g, '');
                const salary = $(el).find('.salary-snippet-container, .estimated-salary-container, [class*="salary"]').text().trim() || "N/A";
                const link = $(el).find('a[data-jk], h2.jobTitle a').attr('href');

                if (title && title !== "N/A") {
                    allJobs.push({
                        Title: title,
                        Salary: salary,
                        Link: link ? (link.startsWith('http') ? link : 'https://ca.indeed.com' + link) : "N/A"
                    });
                    count++;
                }
            });

            console.log(`✅ Thành công: Lấy được ${count} jobs cho ${kw}`);

        } catch (err) {
            console.log(`❌ Lỗi tại ${kw}: ${err.message}`);
        }
        
        // Nghỉ 3 giây để tránh bị hệ thống quét của Indeed nghi ngờ
        await new Promise(r => setTimeout(r, 3000));
    }

    // Xuất kết quả
    if (allJobs.length > 0) {
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, "Indeed_Jobs.xlsx");
        
        await sendTelegramAlert(`✅ <b>CLOUD REPORT:</b>\nTìm thấy <b>${allJobs.length}</b> jobs mới tại Vancouver.\nFile Excel đã sẵn sàng trên GitHub!`);
    } else {
        await sendTelegramAlert("⚠️ <b>THÔNG BÁO:</b> Đã quét nhưng Indeed trả về trang trống. Có thể cần thay đổi IP của Proxy.");
    }
}

runScraper();
import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM GỬI THẺ TRỰC TIẾP LÊN TEAMS ---
async function sendToTeams(jobCounts) {
    // URL này nhận dữ liệu và tự động hiển thị thành thẻ tin nhắn
    const webhookUrl = "https://default623b73c907ff40a09b5f9530629ae2.dc.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/e73e4f2f5ee4408fae5d8a0f00d8a25d/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=aHvqwoqmo9julzI0hBW0mBVlKN7wA2C0Q6UtNKmPjUU";
    
    const totalJobs = Object.values(jobCounts).reduce((a, b) => a + b, 0);

    // Cấu trúc MessageCard để hiển thị giao diện chuyên nghiệp
    const cardPayload = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": "0076D7",
        "summary": "Cập nhật Job mới tại Vancouver",
        "sections": [{
            "activityTitle": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER",
            "activitySubtitle": `Nguồn: Indeed Canada | Ngày: ${new Date().toLocaleDateString('vi-VN')}`,
            "facts": [
                { "name": "Số lượng:", "value": `**${totalJobs} jobs**` },
                { "name": "Trạng thái:", "value": "Tải về trực tiếp ✅" },
                { "name": "Chi tiết:", "value": Object.entries(jobCounts).map(([k, v]) => `${k}: ${v}`).join(", ") }
            ],
            "markdown": true
        }],
        "potentialAction": [{
            "@type": "OpenUri",
            "name": "💾 TẢI FILE EXCEL VỀ MÁY",
            "targets": [{
                "os": "default",
                "uri": "https://github.com/YourUsername/AutoRun/actions" 
            }]
        }]
    };

    try {
        await axios.post(webhookUrl, cardPayload);
        console.log("✅ [Teams] Thẻ thông báo đã nổ trên Group Chat!");
    } catch (error) {
        console.error("❌ [Teams] Lỗi gửi thẻ:", error.message);
    }
}

// --- CÁC HÀM PHỤ TRỢ TELEGRAM ---
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
    } catch (e) { console.error("❌ Telegram File Error:", e.message); }
}

// --- HÀM CHẠY CHÍNH ---
async function runScraper() {
    console.log("🚀 Khởi động Scraper...");
    let allJobs = [];
    let jobCounts = {};

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;

        while (attempts < 3 && !success) {
            try {
                attempts++;
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        country_code: 'ca'
                    },
                    timeout: 60000
                });

                const $ = cheerio.load(response.data);
                let count = 0;
                $('.job_seen_beacon, .resultContent').each((i, el) => {
                    const title = $(el).find('h2').text().trim();
                    if (title) {
                        allJobs.push({ Title: title, Keyword: kw });
                        count++;
                    }
                });

                if (count > 0) {
                    jobCounts[kw] = count;
                    success = true;
                }
            } catch (err) {
                console.log(`⚠️ Lỗi quét ${kw}: ${err.message}`);
            }
        }
    }

    if (allJobs.length > 0) {
        const fileName = `Indeed_Jobs.xlsx`;
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        await Promise.all([
            sendTelegramAlert(`✅ Đã quét xong! Tìm thấy ${allJobs.length} jobs.`),
            sendTelegramFile(fileName),
            sendToTeams(jobCounts)
        ]);
        console.log("🏁 Hoàn tất.");
    }
}

runScraper();
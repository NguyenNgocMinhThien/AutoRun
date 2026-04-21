import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM GỬI TELEGRAM ---
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
        console.log("✅ Đã gửi file Excel qua Telegram!");
    } catch (e) { console.error("❌ Telegram File Error:", e.message); }
}
async function sendToTeamsViaAPI(jobCount) {
    const skypeToken = process.env.TEAMS_TOKEN; 
    if (!skypeToken) return;

    try {
        const pureToken = skypeToken.includes('skypetoken=') ? skypeToken.split('skypetoken=')[1] : skypeToken;

        // ID lấy từ link bạn cung cấp: 19:NSdc3795cx7bU0lxFnh51auWa7tdyWN2KXzmKQlQEMg1@thread.v2
        const chatId = "19:NSdc3795cx7bU0lxFnh51auWa7tdyWN2KXzmKQlQEMg1@thread.v2";
        
        // Cấu trúc Endpoint chuẩn cho Teams Cloud mới nhất
        const endpoint = `https://teams.cloud.microsoft/api/chatsvc/v1/users/ME/conversations/${chatId}/messages`;

        const messageBody = {
            "content": `🚀 <b>CẬP NHẬT JOB MỚI</b><br/>- Tìm thấy: <b>${jobCount}</b> jobs.<br/>- Ngày quét: ${new Date().toLocaleDateString()}<br/>- File chi tiết: Đã gửi qua Telegram.`,
            "messagetype": "RichText/Html",
            "contenttype": "text"
        };

        const response = await axios.post(endpoint, messageBody, {
            headers: {
                'Authorization': `skypetoken=${pureToken}`,
                'Authentication': `skypetoken=${pureToken}`,
                'Content-Type': 'application/json',
                'X-Client-Version': '20/24020401405',
                'ScenarioId': 'S_Messaging_Chat_V2' // Thêm định danh kịch bản gửi tin
            }
        });

        if (response.status === 201 || response.status === 200) {
            console.log("✅ [API] Tin nhắn đã được gửi thành công!");
        }
    } catch (e) {
        // Ghi log chi tiết hơn để bắt được lỗi ""
        const errorDetail = e.response ? (e.response.data.message || JSON.stringify(e.response.data)) : e.message;
        console.error(`❌ Lỗi API Teams (${e.response?.status || 'Unknown'}):`, errorDetail);
    }
}

// --- HÀM CHẠY CHÍNH (GIỮ NGUYÊN LOGIC CỦA BẠN) ---
async function runScraper() {
    console.log("🚀 Khởi động Scraper siêu bền bỉ (Quét tối thiểu 3 lần/từ khóa)...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;
        const maxAttempts = 5;

        while (attempts < maxAttempts && !success) {
            attempts++;
            console.log(`🔍 Đang quét: ${kw} (Lần thử ${attempts}/${maxAttempts})...`);
            try {
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        proxy_type: 'residential',
                        render: 'true',
                        country_code: 'us',
                        session_number: Math.floor(Math.random() * 100000)
                    },
                    timeout: 120000
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
                    console.log(`⚠️ Trang trống tại ${kw}, đang ép thử lại...`);
                    throw new Error("Empty Page");
                }
            } catch (err) {
                console.log(`⚠️ Lần ${attempts} lỗi. Thử lại...`);
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    if (allJobs.length > 0) {
        const fileName = `Indeed_Jobs.xlsx`; // Bỏ random để dễ quản lý trong workflow
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        // Gửi báo cáo đồng thời
        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs!`),
            sendTelegramFile(fileName),
            sendToTeamsViaAPI(allJobs.length) // Gọi hàm API mới tại đây
        ]);
        console.log("🏁 Hoàn tất tất cả báo cáo.");
    } else {
        await sendTelegramAlert("⚠️ Không lấy được dữ liệu job nào.");
    }
}

runScraper();
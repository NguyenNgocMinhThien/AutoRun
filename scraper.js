import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM GỬI TEAMS QUA WORKFLOW URL (DÙNG LINK BẠN GỬI) ---
async function sendToTeams(jobCounts) {
    const flowUrl = "https://default623b73c907ff40a09b5f9530629ae2.dc.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/e73e4f2f5ee4408fae5d8a0f00d8a25d/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=aHvqwoqmo9julzI0hBW0mBVlKN7wA2C0Q6UtNKmPjUU";

    const totalJobs = Object.values(jobCounts).reduce((a, b) => a + b, 0);

    const messagePayload = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "type": "AdaptiveCard",
                    "body": [
                        { "type": "TextBlock", "text": "🚀 CẬP NHẬT JOB MỚI", "weight": "Bolder", "size": "Large", "color": "Accent" },
                        { "type": "TextBlock", "text": `Ngày cập nhật: ${new Date().toLocaleDateString('vi-VN')}`, "isSubtle": true, "spacing": "None" },
                        {
                            "type": "FactSet",
                            "facts": [
                                { "title": "Analyst:", "value": `${jobCounts.Analyst || 0}` },
                                { "title": "Data Science:", "value": `${jobCounts.DataScience || 0}` },
                                { "title": "CEO:", "value": `${jobCounts.CEO || 0}` },
                                { "title": "Tổng cộng:", "value": `**${totalJobs} jobs**` }
                            ]
                        },
                        { "type": "TextBlock", "text": "📂 File báo cáo: Đã được đính kèm trong mục Artifacts trên GitHub.", "wrap": true, "color": "Attention" }
                    ],
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "version": "1.4"
                }
            }
        ]
    };

    try {
        await axios.post(flowUrl, messagePayload);
        console.log("✅ [Teams] Đã nổ popup tin nhắn thành công!");
    } catch (error) {
        console.error("❌ [Teams] Lỗi gửi tin nhắn:", error.response ? error.response.data : error.message);
    }
}

// --- CÁC HÀM PHỤ TRỢ ---
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
    console.log("🚀 Khởi động Scraper siêu bền bỉ...");
    let allJobs = [];
    let jobCounts = {};

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;
        const maxAttempts = 5;

        while (attempts < maxAttempts && !success) {
            try {
                attempts++;
                console.log(`🔍 Đang quét: ${kw} (Lần thử ${attempts}/${maxAttempts})...`);

                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        // Bỏ proxy_type: 'residential' nếu bạn dùng gói miễn phí (gói Free thường bị lỗi 500 khi bật cái này)
                        // proxy_type: 'residential', 
                        render: 'false',
                        country_code: 'ca'
                    },
                    timeout: 60000 // Tăng timeout lên 60s để chờ server phản hồi
                });

                const $ = cheerio.load(response.data);
                let count = 0;

                $('.job_seen_beacon, .resultContent, [class*="jobsearch-SerpJobCard"]').each((i, el) => {
                    const title = $(el).find('h2.jobTitle, a.jcs-JobTitle').text().trim();
                    if (title) {
                        allJobs.push({ Title: title, Keyword: kw });
                        count++;
                    }
                });

                if (count > 0) {
                    console.log(`✅ Thành công: Lấy được ${count} jobs cho ${kw}`);
                    jobCounts[kw] = count;
                    success = true;
                }
            } catch (err) {
                console.log(`⚠️ Lần ${attempts} lỗi: ${err.message}`);
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    if (allJobs.length > 0) {
        const fileName = `Indeed_Jobs.xlsx`;
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        console.log("📤 Đang gửi dữ liệu báo cáo qua Webhook Teams...");
        await Promise.all([
            sendTelegramAlert(`✅ Đã quét xong! Tìm thấy ${allJobs.length} jobs.`),
            sendTelegramFile(fileName),
            sendToTeams(jobCounts) // PHẢI LÀ HÀM NÀY ĐỂ NỔ POPUP TEAMS
        ]);
        console.log("🏁 Hoàn tất tất cả báo cáo.");
    }
}

runScraper();
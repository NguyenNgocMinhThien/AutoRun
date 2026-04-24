import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';
import { google } from 'googleapis';

const require = createRequire(import.meta.url);
const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM UPLOAD GOOGLE DRIVE ---
async function uploadToDriveAndGetLink(fileName) {
    try {
        const credentials = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT_JSON);
        
        // Khai báo kiểu này Google sẽ nhận diện tốt hơn
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });

        const drive = google.drive({ version: 'v3', auth });

        const fileMetadata = { 
            'name': fileName,
            'parents': ['1Yy...your_folder_id_here...'] // (Tùy chọn) ID thư mục bạn đã share
        };
        
        const media = {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            body: fs.createReadStream(fileName),
        };

        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink',
        });

        // Lệnh này quan trọng để nút bấm không bị báo lỗi "Cần quyền truy cập"
        await drive.permissions.create({
            fileId: file.data.id,
            requestBody: { role: 'reader', type: 'anyone' },
        });

        return file.data.webViewLink;
    } catch (error) {
        console.error("❌ Lỗi Drive:", error.message);
        // Chỉ khi lỗi thật sự mới trả về link GitHub
        return "https://github.com/thiennnm22/AutoRun/actions"; 
    }
}

// --- HÀM GỬI TEAMS (DÙNG BIẾN ĐỘNG) ---
async function sendToTeams(totalJobs, driveLink) {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!webhookUrl) return;

    // Tự dựng cấu trúc Adaptive Card ngay tại đây
    const adaptiveCard = {
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
            {
                "type": "TextBlock",
                "text": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER",
                "weight": "Bolder",
                "size": "Medium"
            },
            {
                "type": "FactSet",
                "facts": [
                    { "title": "Nguồn:", "value": "Indeed Canada" },
                    { "title": "Số lượng:", "value": `${totalJobs} jobs` },
                    { "title": "Trạng thái:", "value": "Tải về trực tiếp ✅" }
                ]
            },
            {
                "type": "TextBlock",
                "text": "Nguyễn Ngọc Minh Thiện used a Workflow template to send this card.",
                "isSubtle": true,
                "size": "Small",
                "wrap": true
            }
        ],
        "actions": [
            {
                "type": "Action.OpenUrl",
                "title": "📥 TẢI FILE EXCEL VỀ MÁY",
                "url": driveLink // Link Drive xịn sẽ nằm ở đây
            }
        ],
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json"
    };

    try {
        // Gửi bọc trong thẻ "attachments" để Teams nhận diện đúng Card
        await axios.post(webhookUrl, {
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "content": adaptiveCard
                }
            ]
        });
        console.log("✅ [Teams] Đã bắn Card xịn sang thành công!");
    } catch (error) {
        console.error("❌ [Teams] Lỗi gửi:", error.message);
    }
}

// --- CÁC HÀM PHỤ TRỢ KHÁC ---
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

// --- HÀM CHẠY CHÍNH (GIỮ NGUYÊN LOGIC CỦA BẠN) ---
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
                        render: 'false',
                        country_code: 'ca'
                    },
                    timeout: 60000
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

        console.log("📤 Đang xử lý upload và gửi báo cáo...");
        
        // BƯỚC QUAN TRỌNG: Upload Drive trước để lấy link
        const driveLink = await uploadToDriveAndGetLink(fileName);
        
        // Gửi tất cả báo cáo
        await Promise.all([
            sendTelegramAlert(`✅ Đã quét xong! Tìm thấy ${allJobs.length} jobs.`),
            sendTelegramFile(fileName),
            sendToTeams(allJobs.length, driveLink) // Gửi link Drive và số lượng thật sang Teams
        ]);
        console.log("🏁 Hoàn tất tất cả báo cáo.");
    }
}

runScraper();
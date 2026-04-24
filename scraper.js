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
    const folderId = '1EUAo7fNuhagyh3J41DM-shaMP0MaU-F2'; // Khai báo ở đầu hàm để dùng được bên dưới
    try {
        const credentials = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT_JSON);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });
        const drive = google.drive({ version: 'v3', auth });

        const fileMetadata = { 
            'name': fileName,
            'parents': [folderId] // BẮT BUỘC có dòng này để dùng dung lượng của Thiện
        };
        
        const media = {
            mimeType: 'application/vnd.officedocument.spreadsheetml.sheet',
            body: fs.createReadStream(fileName),
        };

        console.log("📤 Đang đẩy file vào thư mục Drive...");
        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink',
        });

        // Cấp quyền xem cho mọi người (để nút trên Teams bấm là mở được)
        await drive.permissions.create({
            fileId: file.data.id,
            requestBody: { role: 'reader', type: 'anyone' },
        });

        console.log("✅ Thành công! File ID:", file.data.id);
        return file.data.webViewLink;
    } catch (error) {
        console.error("❌ Lỗi Drive:", error.message);
        // Trả về link thư mục dự phòng nếu không upload được file lẻ
        return `https://drive.google.com/drive/folders/${folderId}`;
    }
}

async function sendToTeams(totalJobs, driveLink) {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!webhookUrl) return;

    // Payload chuẩn gửi trực tiếp qua Power Automate
    const adaptiveCard = {
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
            { "type": "TextBlock", "text": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER", "weight": "Bolder", "size": "Medium", "color": "Accent" },
            {
                "type": "FactSet",
                "facts": [
                    { "title": "Nguồn:", "value": "Indeed Canada" },
                    { "title": "Số lượng:", "value": `${totalJobs} jobs` },
                    { "title": "Trạng thái:", "value": "Đã lưu vào Drive ✅" }
                ]
            }
        ],
        "actions": [
            { "type": "Action.OpenUrl", "title": "📥 TẢI FILE EXCEL VỀ MÁY", "url": driveLink }
        ],
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json"
    };

    try {
        await axios.post(webhookUrl, adaptiveCard);
        console.log("✅ [Teams] Đã gửi thông báo thành công!");
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
                $('.job_seen_beacon, .resultContent').each((i, el) => {
    const titleEl = $(el).find('h2.jobTitle, a.jcs-JobTitle');
    const title = titleEl.text().trim();
    
    // Lấy Link Indeed
    const relativeLink = titleEl.find('a').attr('href') || titleEl.attr('href');
    const fullLink = relativeLink ? `https://ca.indeed.com${relativeLink}` : 'N/A';

    // Lấy Tên công ty
    const company = $(el).find('[data-testid="company-name"], .companyName').text().trim();

    if (title) {
        allJobs.push({ 
            Title: title, 
            Company: company || "N/A", 
            Link: fullLink, 
            Keyword: kw 
        });
        count++;
    }
});
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
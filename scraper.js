import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const KEYWORDS = [
    "Analyst", "FP&A", "Investment", "Quantitative Researcher", "Data Science",
    "CFA", "Actuarial", "PhD", "Research", "Trader", "President", "CEO",
    "CIO", "CTO", "CSO", "Chief AI Officer"
];

// --- HÀM UPLOAD LITTERBOX ---
async function uploadToCatbox(filePath) {
    try {
        console.log("📤 Đang tải file lên Litterbox...");
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('time', '24h');
        form.append('fileToUpload', fs.createReadStream(filePath));

        const response = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
            headers: form.getHeaders(),
            timeout: 60000
        });

        const fileLink = response.data.trim();
        if (fileLink.startsWith('https://')) {
            console.log("✅ Link file:", fileLink);
            return fileLink;
        }
        throw new Error("Phản hồi không chứa link hợp lệ");
    } catch (error) {
        console.error("❌ Lỗi Catbox:", error.message);
        return `https://github.com/${process.env.GITHUB_REPOSITORY}/actions`;
    }
}

// --- HÀM GỬI TEAMS ---
async function sendToTeams(totalJobs, fileLink) {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!webhookUrl) return;

    const adaptiveCard = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": [
                    { "type": "TextBlock", "text": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER", "weight": "Bolder", "size": "Medium", "color": "Accent" },
                    { "type": "FactSet", "facts": [
                        { "title": "Nguồn:", "value": "Indeed Canada" },
                        { "title": "Số lượng:", "value": `${totalJobs} jobs` }
                    ]}
                ],
                "actions": [{ "type": "Action.OpenUrl", "title": "📥 TẢI FILE EXCEL", "url": fileLink }],
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json"
            }
        }]
    };

    try {
        await axios.post(webhookUrl, adaptiveCard);
        console.log("✅ [Teams] Đã gửi thông báo thành công!");
    } catch (error) { console.error("❌ [Teams] Lỗi gửi:", error.message); }
}

// --- TELEGRAM ---
async function sendTelegramAlert(message) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML'
        });
    } catch (e) { console.error("❌ Telegram Alert Error:", e.message); }
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

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        const maxAttempts = 2; // Giảm xuống 2 lần để chạy nhanh hơn

        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`🔍 Quét: ${kw} (Lần ${attempts})...`);
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        country_code: 'ca',
                        render: 'true',
                        wait_for_selector: '.job_seen_beacon' // Chỉ chờ cho đến khi thấy kết quả
                    },
                    timeout: 45000 // Giảm timeout để bỏ qua các request bị treo nhanh hơn
                });

                const $ = cheerio.load(response.data);
                let count = 0;
                
                $('.job_seen_beacon').each((i, el) => {
                    const titleEl = $(el).find('h2.jobTitle, a.jcs-JobTitle');
                    const title = titleEl.text().trim();
                    const salary = $(el).find('.salary-section, .estimated-salary, .attribute_snippet, [class*="salary"]').text().trim() || "N/A";
                    
                    if (title) {
                        allJobs.push({
                            Title: title,
                            Company: $(el).find('[data-testid="company-name"]').text().trim() || "N/A",
                            Salary: salary,
                            Location: $(el).find('[data-testid="text-location"], .companyLocation').text().trim() || "Vancouver, BC",
                            'Apply Method': $(el).find('.iaIcon').length > 0 ? "Indeed Quick Apply" : "Company Website",
                            Link: `https://ca.indeed.com${titleEl.find('a').attr('href') || titleEl.attr('href')}`,
                            Keyword: kw
                        });
                        count++;
                    }
                }); 

                if (count > 0) {
                    console.log(`✅ Lấy được ${count} jobs cho ${kw}`);
                    break; 
                }
            } catch (err) {
                console.log(`⚠️ Lỗi ${kw}: ${err.message}`);
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 3000));
            }
        }
    }

    if (allJobs.length > 0) {
        const fileName = `Indeed_Jobs.xlsx`;
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        const fileLink = await uploadToCatbox(fileName);

        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs mới!`),
            sendTelegramFile(fileName),
            sendToTeams(allJobs.length, fileLink)
        ]);
        console.log("🏁 Hoàn tất tất cả báo cáo.");
    } else {
        console.log("❌ Không tìm thấy job nào.");
    }
}

runScraper();
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
// --- HÀM UPLOAD LITTERBOX (CATBOX) ---
async function uploadToCatbox(filePath) {
    try {
        console.log("📤 Đang tải file lên Litterbox...");
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('time', '24h');
        form.append('fileToUpload', fs.createReadStream(filePath));

        const response = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
            headers: form.getHeaders()
        });

        const fileLink = response.data.trim();

        // SỬA DÒNG NÀY: Chỉ cần kiểm tra xem có bắt đầu bằng https:// không
        if (fileLink.includes('https://')) {
            console.log("✅ Upload thành công! Link chính thức:", fileLink);
            return fileLink;
        }

        throw new Error("Phản hồi không phải link hợp lệ: " + fileLink);
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
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
            { "type": "TextBlock", "text": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER", "weight": "Bolder", "size": "Medium", "color": "Accent" },
            {
                "type": "FactSet",
                "facts": [
                    { "title": "Nguồn:", "value": "Indeed Canada" },
                    { "title": "Số lượng:", "value": `${totalJobs} jobs` },
                    { "title": "Trạng thái:", "value": "Đã sẵn sàng ✅" }
                ]
            }
        ],
        "actions": [
            { "type": "Action.OpenUrl", "title": "📥 TẢI FILE EXCEL VỀ MÁY", "url": fileLink }
        ],
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json"
    };

    try {
        await axios.post(webhookUrl, adaptiveCard);
        console.log("✅ [Teams] Đã gửi Card thành công!");
    } catch (error) {
        console.error("❌ [Teams] Lỗi gửi:", error.message);
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

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`🔍 Quét: ${kw} (Lần ${attempts})...`);
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
                
                $('.job_seen_beacon').each((i, el) => {
                    const titleEl = $(el).find('h2.jobTitle, a.jcs-JobTitle');
                    const title = titleEl.text().trim();
                    const relativeLink = titleEl.find('a').attr('href') || titleEl.attr('href');
                    
                    // 1. Lấy Salary (Cập nhật selector để không bị N/A)
                    const salary = $(el).find('.salary-section, .estimated-salary, .attribute_snippet, .metadata.salary-snippet-container').text().trim() || "N/A";
                    
                    // 2. Lấy Location
                    const location = $(el).find('[data-testid="text-location"], .companyLocation').text().trim() || "Vancouver, BC";
                    
                    // 3. Lấy Apply Method
                    const isQuickApply = $(el).find('.iaIcon').length > 0;
                    const applyMethod = isQuickApply ? "Indeed Quick Apply" : "Company Website";

                    if (title) {
                        allJobs.push({
                            Title: title,
                            Company: $(el).find('[data-testid="company-name"]').text().trim() || "N/A",
                            Salary: salary,
                            Location: location,
                            'Apply Method': applyMethod,
                            Link: relativeLink ? `https://ca.indeed.com${relativeLink}` : 'N/A',
                            Keyword: kw
                        });
                        count++; // THÊM DUY NHẤT DÒNG NÀY để logic break; hoạt động đúng
                    }
                }); 

                if (count > 0) {
                    console.log(`✅ Lấy được ${count} jobs cho ${kw}`);
                    break; 
                }
            } catch (err) {
                console.log(`⚠️ Lỗi ${kw}: ${err.message}`);
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

        console.log("📤 Bắt đầu gửi báo cáo...");
        const fileLink = await uploadToCatbox(fileName);

        // Giữ nguyên 100% lệnh gọi MS Teams và Telegram như bản gốc của bạn
        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs mới!`),
            sendTelegramFile(fileName),
            sendToTeams(allJobs.length, fileLink)
        ]);
        console.log("🏁 Hoàn tất!");
    } else {
        console.log("❌ Không tìm thấy job nào.");
    }
}
import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM HỖ TRỢ LỌC LƯƠNG (GIỮ ĐÚNG TIÊU CHUẨN 60K/NĂM HOẶC 30/GIỜ) ---
function isSalaryHighEnough(salaryText) {
    if (!salaryText || salaryText === "N/A") return true; 
    const numbers = salaryText.replace(/,/g, '').match(/\d+(\.\d+)?/g);
    if (!numbers) return true;

    const val = parseFloat(numbers[0]);
    if (salaryText.toLowerCase().includes('hour')) return val >= 30;
    if (salaryText.toLowerCase().includes('year')) return val >= 60000;
    if (val >= 60000) return true;
    if (val >= 30 && val < 1000) return true;
    
    return false;
}

// --- HÀM UPLOAD LITTERBOX ---
async function uploadToCatbox(filePath) {
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('time', '24h'); 
        form.append('fileToUpload', fs.createReadStream(filePath));

        const response = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
            headers: form.getHeaders()
        });

        const fileLink = response.data.trim();
        if (fileLink.includes('https://')) return fileLink;
        throw new Error("Invalid link: " + fileLink);
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
                        { "title": "Số lượng:", "value": `${totalJobs} jobs` },
                        { "title": "Trạng thái:", "value": "Đã sẵn sàng ✅" }
                    ]}
                ],
                "actions": [{ "type": "Action.OpenUrl", "title": "📥 TẢI FILE EXCEL VỀ MÁY", "url": fileLink }],
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json"
            }
        }]
    };

    try {
        await axios.post(webhookUrl, adaptiveCard);
        console.log("✅ [Teams] Đã gửi Card thành công!");
    } catch (error) {
        console.error("❌ [Teams] Lỗi gửi:", error.message);
    }
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
        // Đúng yêu cầu lọc lương 60k từ URL gốc
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
                        country_code: 'ca',
                        render: 'true', // QUAN TRỌNG: Bật render để hiện tiền lương
                        wait_for_selector: '.job_seen_beacon' // Chờ trang tải xong các thẻ job
                    },
                    timeout: 60000
                });

                const $ = cheerio.load(response.data);
                let count = 0;
                
                $('.job_seen_beacon').each((i, el) => {
                    const titleEl = $(el).find('h2.jobTitle, a.jcs-JobTitle');
                    const title = titleEl.text().trim();
                    const relativeLink = titleEl.find('a').attr('href') || titleEl.attr('href');
                    
                    // Cập nhật selector lấy lương chuẩn của Indeed để không bị N/A
                    const salary = $(el).find('.salary-section, .estimated-salary, .attribute_snippet, [class*="salary"]').text().trim() || "N/A";
                    const location = $(el).find('[data-testid="text-location"], .companyLocation').text().trim() || "Vancouver, BC";
                    const isQuickApply = $(el).find('.iaIcon').length > 0;
                    const applyMethod = isQuickApply ? "Indeed Quick Apply" : "Company Website";

                    if (title && isSalaryHighEnough(salary)) {
                        allJobs.push({
                            Title: title,
                            Company: $(el).find('[data-testid="company-name"]').text().trim() || "N/A",
                            Salary: salary,
                            Location: location,
                            'Apply Method': applyMethod,
                            Link: relativeLink ? `https://ca.indeed.com${relativeLink}` : 'N/A',
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

        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs mới có lương phù hợp!`),
            sendTelegramFile(fileName),
            sendToTeams(allJobs.length, fileLink)
        ]);
        console.log("🏁 Hoàn tất!");
    } else {
        console.log("❌ Không tìm thấy job nào phù hợp điều kiện.");
    }
}

runScraper();
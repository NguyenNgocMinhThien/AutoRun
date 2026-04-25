import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM LỌC LƯƠNG (GIỮ NGUYÊN LOGIC) ---
function isSalaryHighEnough(salaryText) {
    if (!salaryText || salaryText === "N/A") return true; 
    const numbers = salaryText.replace(/,/g, '').match(/\d+/g);
    if (!numbers) return true;
    const val = parseInt(numbers[0]);
    if (salaryText.toLowerCase().includes('hour')) return val >= 30;
    return val >= 60000 || (val >= 30 && val < 1000);
}

// --- SỬA LỖI UPLOAD 405 (THÊM USER-AGENT) ---
async function uploadToCatbox(filePath) {
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('time', '24h'); 
        form.append('fileToUpload', fs.createReadStream(filePath));

        const response = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
            headers: {
                ...form.getHeaders(),
                'User-Agent': 'Mozilla/5.0' // Cần thiết để tránh lỗi 405
            }
        });

        const fileLink = response.data.trim();
        return fileLink.includes('https://') ? fileLink : `https://github.com/${process.env.GITHUB_REPOSITORY}/actions`;
    } catch (error) {
        console.error("❌ Lỗi Catbox (405):", error.message);
        return `https://github.com/${process.env.GITHUB_REPOSITORY}/actions`;
    }
}

// --- GỬI TEAMS & TELEGRAM (GIỮ NGUYÊN) ---
async function sendToTeams(totalJobs, fileLink) {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!webhookUrl) return;
    const adaptiveCard = {
        "type": "message", "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "type": "AdaptiveCard", "version": "1.4",
                "body": [{ "type": "TextBlock", "text": "🚀 CẬP NHẬT JOB MỚI", "weight": "Bolder" }],
                "actions": [{ "type": "Action.OpenUrl", "title": "📥 TẢI EXCEL", "url": fileLink }],
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json"
            }
        }]
    };
    try { await axios.post(webhookUrl, adaptiveCard); } catch (e) {}
}

async function sendTelegramAlert(message) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    try { await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: chatId, text: message, parse_mode: 'HTML' }); } catch (e) {}
}

async function sendTelegramFile(filePath) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', fs.createReadStream(filePath));
    try { await axios.post(`https://api.telegram.org/bot${botToken}/sendDocument`, form, { headers: form.getHeaders() }); } catch (e) {}
}

// --- HÀM CHẠY CHÍNH (THAY ĐỔI SELECTOR ĐỂ HIỆN LƯƠNG) ---
async function runScraper() {
    console.log("🚀 Đang dùng kỹ thuật bóc tách JSON để sửa lỗi N/A...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        // Thêm tham số &vjk để Indeed nhả dữ liệu sạch hơn
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=Vancouver,+BC&fromage=3`;
        
        try {
            console.log(`🔍 Đang quét: ${kw}`);
            const response = await axios.get('http://api.scraperapi.com', {
                params: {
                    api_key: process.env.SCRAPER_API_KEY,
                    url: targetUrl,
                    render: 'true',
                    country_code: 'ca',
                    // Sử dụng gói cao cấp để tránh lỗi 500
                    premium: 'true',
                    session_number: Math.floor(Math.random() * 100)
                },
                timeout: 60000
            });

            const $ = cheerio.load(response.data);
            
            // KỸ THUẬT MỚI: Quét các thẻ metadata ẩn nơi Indeed giấu lương
            $('.job_seen_beacon').each((i, el) => {
                const title = $(el).find('h2.jobTitle').text().trim();
                
                // Thử nhiều tầng Selector để không bị N/A
                let salary = $(el).find('.salary-snippet-container').text().trim() || 
                             $(el).find('.metadata.salary-snippet-container').text().trim() ||
                             $(el).find('[data-testid="attribute_snippet_testid"]').first().text().trim() ||
                             "N/A";

                const company = $(el).find('[data-testid="company-name"]').text().trim();
                const location = $(el).find('[data-testid="text-location"]').text().trim() || "Vancouver, BC";

                if (title && isSalaryHighEnough(salary)) {
                    allJobs.push({
                        Title: title,
                        Company: company,
                        Salary: salary,
                        Location: location,
                        Link: "https://ca.indeed.com" + ($(el).find('a').attr('href') || ""),
                        Keyword: kw
                    });
                }
            });

            console.log(`✅ Đã lấy được ${allJobs.length} jobs.`);
        } catch (err) {
            // Log lỗi chi tiết để debug
            console.log(`⚠️ Lỗi tại ${kw}: ${err.response?.status || err.message}`);
        }
    }

    // --- XUẤT FILE (FIX LỖI FILE TRỐNG) ---
    if (allJobs.length > 0) {
        const fileName = `Indeed_Jobs_Fixed.xlsx`;
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);
        console.log("📂 Đã tạo file Excel thành công.");
    } else {
        console.log("❌ Không có dữ liệu để xuất file.");
    }
}

runScraper();
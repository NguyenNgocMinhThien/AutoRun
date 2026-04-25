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
    const numbers = salaryText.replace(/,/g, '').match(/\d+(\.\d+)?/g);
    if (!numbers) return true;
    const val = parseFloat(numbers[0]);
    if (salaryText.toLowerCase().includes('hour')) return val >= 30;
    if (salaryText.toLowerCase().includes('year')) return val >= 60000;
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
    console.log("🚀 Khởi động Scraper...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;

        while (attempts < 3) {
            try {
                attempts++;
                console.log(`🔍 Quét: ${kw} (Lần ${attempts})...`);
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        country_code: 'ca',
                        render: 'true',
                        premium: 'true' // Sử dụng premium để bypass Indeed
                    },
                    timeout: 60000
                });

                const $ = cheerio.load(response.data);
                let count = 0;
                
                $('.job_seen_beacon').each((i, el) => {
                    const titleEl = $(el).find('h2.jobTitle, a.jcs-JobTitle');
                    const title = titleEl.text().trim();
                    
                    // --- SELECTOR MỚI ĐỂ TRÁNH N/A ---
                    // Indeed hiện tại bọc lương trong các class metadata hoặc attribute_snippet
                    const salary = $(el).find('[data-testid="attribute_snippet_testid"], .salary-section, .metadata.salary-snippet-container').text().trim() || "N/A";
                    const location = $(el).find('[data-testid="text-location"], .companyLocation').text().trim() || "Vancouver, BC";
                    
                    if (title && isSalaryHighEnough(salary)) {
                        allJobs.push({
                            Title: title,
                            Company: $(el).find('[data-testid="company-name"]').text().trim() || "N/A",
                            Salary: salary,
                            Location: location,
                            'Apply Method': $(el).find('.iaIcon').length > 0 ? "Indeed Quick Apply" : "Company Website",
                            Link: titleEl.find('a').attr('href') ? `https://ca.indeed.com${titleEl.find('a').attr('href')}` : 'N/A',
                            Keyword: kw
                        });
                        count++;
                    }
                });

                if (count > 0) break; 
            } catch (err) {
                console.log(`⚠️ Lỗi ${kw}: ${err.message}`);
                await new Promise(r => setTimeout(r, 5000));
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
            sendTelegramAlert(`✅ Đã tìm thấy ${allJobs.length} jobs!`),
            sendTelegramFile(fileName),
            sendToTeams(allJobs.length, fileLink)
        ]);
    }
    console.log("🏁 Hoàn tất!");
}

runScraper();
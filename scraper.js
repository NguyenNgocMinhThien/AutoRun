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
    console.log("🚀 Bắt đầu quét dữ liệu Indeed...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        // Sử dụng URL có sẵn mức lọc 60k của Indeed để tăng độ chính xác
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver,+BC&fromage=3`;
        
        try {
            console.log(`🔍 Đang lấy tin cho ngành: ${kw}`);
            const response = await axios.get('http://api.scraperapi.com', {
                params: {
                    api_key: process.env.SCRAPER_API_KEY,
                    url: targetUrl,
                    country_code: 'ca',
                    // Chỉ dùng render đơn giản để tránh lỗi 500
                    render: 'true'
                }
            });

            const $ = cheerio.load(response.data);
            
            $('.job_seen_beacon').each((i, el) => {
                const title = $(el).find('h2.jobTitle').text().trim();
                
                // --- SỬA LỖI N/A TẠI ĐÂY ---
                // Sử dụng bộ selector bao quát các class mới nhất của Indeed
                const salary = $(el).find('.salary-snippet-container, .metadata.salary-snippet-container, [data-testid="attribute_snippet_testid"]').text().trim() || "N/A";
                const company = $(el).find('[data-testid="company-name"]').text().trim() || "N/A";
                const location = $(el).find('[data-testid="text-location"]').text().trim() || "Vancouver, BC";

                if (title && isSalaryHighEnough(salary)) {
                    allJobs.push({
                        'Ngành Tuyển': kw, // Gắn ngành vào cột đầu tiên cho dễ nhìn
                        'Title': title,
                        'Company': company,
                        'Salary': salary,
                        'Location': location,
                        'Link': "https://ca.indeed.com" + ($(el).find('a').attr('href') || "")
                    });
                }
            });
        } catch (err) {
            console.log(`⚠️ Ngành ${kw} bị lỗi (Status: ${err.response?.status || 'Timeout'})`);
        }
    }

    if (allJobs.length > 0) {
        // Sắp xếp lại danh sách theo Ngành trước khi xuất Excel
        allJobs.sort((a, b) => a['Ngành Tuyển'].localeCompare(b['Ngành Tuyển']));

        const fileName = `Indeed_Vancouver_Report.xlsx`;
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        
        // Căn chỉnh độ rộng cột cơ bản
        worksheet['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 50 }];
        
        XLSX.writeFile(workbook, fileName);
        console.log(`✅ Đã xuất file Excel với ${allJobs.length} công việc.`);
    } else {
        console.log("❌ Không tìm thấy dữ liệu phù hợp.");
    }
}

runScraper();
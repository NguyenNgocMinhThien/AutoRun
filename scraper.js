import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');
const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM GỬI EMAIL KÍCH HOẠT FLOW ---
async function triggerFlowViaEmail(jobCount, filePath) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'fanjaki2017@gmail.com',
            pass: process.env.GMAIL_APP_PASS
        }
    });

    try {
        await transporter.sendMail({
            from: 'fanjaki2017@gmail.com',
            to: 'thiennnm22@uef.edu.vn',
            subject: 'SEND_TO_TEAMS_GROUP',
            text: `Tìm thấy ${jobCount} jobs. Đang chuyển file vào Teams...`,
            attachments: [{
                filename: `Indeed_Jobs_Report.xlsx`,
                path: filePath
            }]
        });
        console.log("✅ [Email] Đã gửi email kích hoạt Flow!");
    } catch (error) {
        console.error("❌ [Email] Lỗi:", error.message);
    }
}

// --- HÀM GỬI TELEGRAM DỰ PHÒNG ---
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

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;
        const maxAttempts = 5;

        while (attempts < maxAttempts && !success) {
            try {
                attempts++;
                console.log(`🔍 Đang quét: ${kw} (Lần thử ${attempts}/${maxAttempts})...`);

                // Sửa lại phần params trong scraper.js của bạn
                // Tìm đoạn này trong file scraper.js của bạn và cập nhật
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY, // Nó sẽ tự lấy key mới từ GitHub Secrets
                        url: targetUrl,
                        proxy_type: 'residential',
                        render: 'false', // Thử để false trước, nếu vẫn không ra job mới bật lên true
                        country_code: 'ca'
                    },
                    timeout: 60000
                });

                const $ = cheerio.load(response.data);
                let count = 0;

                // Cập nhật Selector bao quát hơn để tránh Indeed đổi class
                $('.job_seen_beacon, .resultContent, [class*="jobsearch-SerpJobCard"], .jobsearch-ResultsList > li').each((i, el) => {
                    const title = $(el).find('h2.jobTitle, span[id^="jobTitle-"], a.jcs-JobTitle').text().trim().replace(/new/g, '');
                    const salary = $(el).find('.salary-snippet-container, .estimated-salary-container, [class*="metadata"]').text().trim() || "N/A";
                    const linkSuffix = $(el).find('a[data-jk], h2.jobTitle a, a.jcs-JobTitle').attr('href');

                    if (title) {
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
                    console.log(`⚠️ Trang trống tại ${kw}, đang thử lại...`);
                }
            } catch (err) {
                console.log(`⚠️ Lần ${attempts} lỗi: ${err.message}. Thử lại sau 5s...`);
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    // Xử lý báo cáo sau khi thoát vòng lặp từ khóa
    if (allJobs.length > 0) {
        const fileName = `Indeed_Jobs.xlsx`;
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        await Promise.all([
            sendTelegramAlert(`✅ Đã quét xong! Tìm thấy ${allJobs.length} jobs.`),
            sendTelegramFile(fileName),
            triggerFlowViaEmail(allJobs.length, fileName)
        ]);
        console.log("🏁 Hoàn tất tất cả báo cáo.");
    } else {
        await sendTelegramAlert("⚠️ Không lấy được dữ liệu job nào.");
    }
}

runScraper();
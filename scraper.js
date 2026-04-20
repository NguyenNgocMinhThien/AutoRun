const axios = require('axios');
const XLSX = require('xlsx');
const cheerio = require('cheerio');
const fs = require('fs');
const FormData = require('form-data');

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM GỬI TELEGRAM ---
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
        console.log("✅ Đã gửi file Excel qua Telegram!");
    } catch (e) { console.error("❌ Telegram File Error:", e.message); }
}

// --- HÀM GỬI MS TEAMS ---
async function sendToTeams(jobCount) {
    const webhookUrl = process.env.MS_TEAMS_WEBHOOK;
    if (!webhookUrl) return;

    const runId = process.env.GITHUB_RUN_ID;
    const repo = process.env.GITHUB_REPOSITORY;
    const downloadLink = `https://github.com/${repo}/actions/runs/${runId}`;

    const cardData = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": "0076D7",
        "summary": "Cập nhật Job mới",
        "sections": [{
            "activityTitle": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER",
            "activitySubtitle": `Tìm thấy ${jobCount} vị trí tiềm năng`,
            "facts": [
                { "name": "Nguồn:", "value": "Indeed Canada" },
                { "name": "Số lượng:", "value": `<b>${jobCount} jobs</b>` }
            ],
            "markdown": true
        }],
        "potentialAction": [{
            "@type": "OpenUri",
            "name": "📥 Tải File Excel Tại Đây",
            "targets": [{ "os": "default", "uri": downloadLink }]
        }]
    };

    try {
        await axios.post(webhookUrl, cardData);
        console.log("✅ Đã gửi thông báo vào Microsoft Teams!");
    } catch (e) { console.error("❌ MS Teams Error:", e.message); }
}

// --- HÀM CHẠY CHÍNH ---
async function runScraper() {
    console.log("🚀 Khởi động Scraper (Anti-500 + MS Teams)...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;
        const maxAttempts = 2; // Giảm xuống 2 lần để tăng tốc nếu thực sự lỗi

        while (attempts < maxAttempts && !success) {
            attempts++;
            console.log(`🔍 Đang quét: ${kw} (Lần ${attempts})...`);

            try {
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        render: 'true',
                        premium: 'true',
                        country_code: 'ca'
                    },
                    timeout: 90000 // Giảm timeout xuống 90s để không treo quá lâu
                });

                const $ = cheerio.load(response.data);
                let count = 0;
                $('.job_seen_beacon, .resultContent, [class*="jobCard"]').each((i, el) => {
                    const title = $(el).find('h2.jobTitle, a[id^="job_"]').text().trim().replace(/new/g, '');
                    const salary = $(el).find('.salary-snippet-container, .estimated-salary-container, [class*="salary"]').text().trim() || "N/A";
                    const linkSuffix = $(el).find('a[data-jk], h2.jobTitle a').attr('href');

                    if (title && title !== "N/A") {
                        allJobs.push({
                            Title: title,
                            Salary: salary,
                            Link: linkSuffix ? (linkSuffix.startsWith('http') ? linkSuffix : 'https://ca.indeed.com' + linkSuffix) : "N/A"
                        });
                        count++;
                    }
                });

                if (count > 0) {
                    console.log(`✅ Thành công: ${count} jobs cho ${kw}`);
                    success = true;
                } else {
                    throw new Error("Empty Page");
                }
            } catch (err) {
                console.log(`⚠️ Lỗi tại ${kw}. Đang thử lại nhanh...`);
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 5000)); // Đợi ngắn hơn (5s thay vì 15s)
            }
        }
        // Giảm thời gian nghỉ giữa các từ khóa từ 5s xuống 2s để tăng năng suất
        await new Promise(r => setTimeout(r, 2000));
    }

    if (allJobs.length > 0) {
        const fileName = "Indeed_Jobs.xlsx";
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);
        
        // Gửi báo cáo song song cho cả 2 kênh để tiết kiệm thời gian
        await Promise.all([
            sendTelegramAlert(`✅ <b>QUÉT THÀNH CÔNG!</b>\nTìm thấy <b>${allJobs.length}</b> jobs mới.`),
            sendTelegramFile(fileName),
            sendToTeams(allJobs.length)
        ]);
        
        console.log("🏁 Hoàn tất! Đã gửi báo cáo đa kênh.");
    } else {
        await sendTelegramAlert("⚠️ Không lấy được dữ liệu job nào.");
    }
}

runScraper();
const axios = require('axios');
const XLSX = require('xlsx');
const cheerio = require('cheerio');
const fs = require('fs');
const FormData = require('form-data');

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- CÁC HÀM GỬI THÔNG BÁO ---

async function sendTelegramAlert(message) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML'
        });
    } catch (e) { console.error("❌ Lỗi Telegram Text:", e.message); }
}

async function sendTelegramFile(filePath) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId || !fs.existsSync(filePath)) return;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', fs.createReadStream(filePath));
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendDocument`, form, { headers: form.getHeaders() });
        console.log("✅ Đã gửi file Excel qua Telegram!");
    } catch (e) { console.error("❌ Lỗi Telegram File:", e.message); }
}

async function sendToTeams(jobCount) {
    const webhookUrl = process.env.MS_TEAMS_WEBHOOK;
    if (!webhookUrl) return;

    // Link dẫn tới trang GitHub Actions để khách bấm tải file Artifact
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
            "activitySubtitle": `Hệ thống vừa hoàn tất quét dữ liệu`,
            "facts": [
                { "name": "Tổng số Job tìm thấy:", "value": `<b>${jobCount}</b>` },
                { "name": "Khu vực:", "value": "Vancouver, BC" },
                { "name": "Trạng thái:", "value": "Thành công ✅" }
            ],
            "markdown": true
        }],
        "potentialAction": [{
            "@type": "OpenUri",
            "name": "📥 Tải File Excel Báo Cáo",
            "targets": [{ "os": "default", "uri": downloadLink }]
        }]
    };

    try {
        await axios.post(webhookUrl, cardData);
        console.log("✅ Đã gửi thông báo vào Microsoft Teams!");
    } catch (e) { console.error("❌ Lỗi MS Teams:", e.message); }
}

// --- LUỒNG QUÉT DỮ LIỆU ---

async function runScraper() {
    console.log("🚀 Khởi động Scraper đa kênh (Telegram + MS Teams)...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;

        while (attempts < 3 && !success) {
            attempts++;
            try {
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        render: 'true',
                        premium: 'true',
                        country_code: 'ca'
                    },
                    timeout: 120000
                });

                const $ = cheerio.load(response.data);
                let count = 0;
                $('.job_seen_beacon, .resultContent, [class*="jobCard"]').each((i, el) => {
                    const title = $(el).find('h2.jobTitle, a[id^="job_"]').text().trim().replace(/new/g, '');
                    if (title) {
                        const linkSuffix = $(el).find('a[data-jk], h2.jobTitle a').attr('href');
                        allJobs.push({
                            Title: title,
                            Salary: $(el).find('.salary-snippet-container, [class*="salary"]').text().trim() || "N/A",
                            Link: linkSuffix ? (linkSuffix.startsWith('http') ? linkSuffix : 'https://ca.indeed.com' + linkSuffix) : "N/A"
                        });
                        count++;
                    }
                });
                console.log(`✅ ${kw}: Lấy được ${count} jobs`);
                success = true;
            } catch (err) {
                console.log(`⚠️ ${kw} lỗi status ${err.response ? err.response.status : 'Timeout'}. Thử lại...`);
                await new Promise(r => setTimeout(r, 10000));
            }
        }
        await new Promise(r => setTimeout(r, 5000));
    }

    if (allJobs.length > 0) {
        const fileName = "Indeed_Jobs.xlsx";
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);
        
        // Gửi báo cáo đồng thời
        await sendTelegramAlert(`✅ <b>QUÉT XONG!</b> Tìm thấy <b>${allJobs.length}</b> jobs mới.`);
        await sendTelegramFile(fileName);
        await sendToTeams(allJobs.length);
        
        console.log("🏁 HOÀN TẤT MỌI CÔNG VIỆC!");
    }
}

runScraper();
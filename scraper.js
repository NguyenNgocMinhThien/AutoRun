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

// --- HÀM TẢI FILE LÊN (CATBOX CHÍNH + LITTERBOX DỰ PHÒNG) ---
async function uploadToPublicLink(filePath) {
    if (!fs.existsSync(filePath)) return null;

    // Thử Catbox trước (Lưu trữ lâu dài)
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(filePath));

        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });
        
        if (typeof response.data === 'string' && response.data.includes('http')) {
            console.log("🔗 Link tải trực tiếp (Catbox):", response.data);
            return response.data; 
        }
    } catch (e) {
        console.warn("⚠️ Catbox lỗi 412, đang thử dịch vụ dự phòng Litterbox...");
    }

    // Dự phòng: Litterbox (Link tồn tại trong 24h - Rất ổn định cho báo cáo ngày)
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('time', '24h');
        form.append('fileToUpload', fs.createReadStream(filePath));

        const response = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });

        if (typeof response.data === 'string' && response.data.includes('http')) {
            console.log("🔗 Link tải trực tiếp (Litterbox):", response.data);
            return response.data;
        }
    } catch (e) {
        console.error("❌ Tất cả dịch vụ upload đều thất bại:", e.message);
    }
    return null;
}

// --- HÀM GỬI MS TEAMS ---
async function sendToTeams(jobCount, directDownloadLink) {
    const webhookUrl = process.env.MS_TEAMS_WEBHOOK;
    if (!webhookUrl) return;

    // Link dự phòng nếu upload lỗi hoàn toàn
    const fallbackLink = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions`;
    const finalLink = directDownloadLink || fallbackLink;

    const adaptiveCard = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "type": "AdaptiveCard",
                "body": [
                    { "type": "TextBlock", "size": "Large", "weight": "Bolder", "text": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER" },
                    { "type": "FactSet", "facts": [
                        { "title": "Nguồn:", "value": "Indeed Canada" },
                        { "title": "Số lượng:", "value": `${jobCount} jobs` },
                        { "title": "Trạng thái:", "value": directDownloadLink ? "Tải về trực tiếp ✅" : "Tải qua GitHub ⚠️" }
                    ]}
                ],
                "actions": [{
                    "type": "Action.OpenUrl",
                    "title": "📥 TẢI FILE EXCEL VỀ MÁY",
                    "url": finalLink
                }],
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "version": "1.4"
            }
        }]
    };

    try {
        await axios.post(webhookUrl, adaptiveCard);
        console.log("✅ Đã gửi tin nhắn kèm nút tải vào Teams!");
    } catch (e) { console.error("❌ MS Teams Error:", e.message); }
}

// --- HÀM CHẠY CHÍNH (GIỮ NGUYÊN LOGIC QUÉT CỦA BẠN) ---
async function runScraper() {
    console.log("🚀 Khởi động Scraper siêu bền bỉ (Quét tối thiểu 3 lần/từ khóa)...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        let success = false;
        const maxAttempts = 5;

        while (attempts < maxAttempts && !success) {
            attempts++;
            console.log(`🔍 Đang quét: ${kw} (Lần thử ${attempts}/${maxAttempts})...`);
            try {
                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        proxy_type: 'residential',
                        render: 'true',
                        country_code: 'us',
                        session_number: Math.floor(Math.random() * 100000)
                    },
                    timeout: 120000
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
                    console.log(`✅ Thành công: Lấy được ${count} jobs cho ${kw}`);
                    success = true;
                } else {
                    console.log(`⚠️ Trang trống tại ${kw}, đang ép thử lại...`);
                    throw new Error("Empty Page");
                }
            } catch (err) {
                console.log(`⚠️ Lần ${attempts} lỗi. Thử lại...`);
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    if (allJobs.length > 0) {
        const fileName = "Indeed_Jobs.xlsx";
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        // Upload lấy link tải trực tiếp
        const directLink = await uploadToPublicLink(fileName);

        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs!`),
            sendTelegramFile(fileName),
            sendToTeams(allJobs.length, directLink)
        ]);
        console.log("🏁 Hoàn tất! Đã gửi báo cáo đa kênh.");
    } else {
        await sendTelegramAlert("⚠️ Không lấy được dữ liệu job nào.");
    }
}

runScraper();
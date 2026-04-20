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

// --- HÀM TẢI FILE LÊN CATBOX (SỬA LẠI ĐỂ ĐẢM BẢO CÓ LINK TRỰC TIẾP) ---
async function uploadToPublicLink(filePath) {
    // Chờ file được ghi xong hoàn toàn vào ổ đĩa trước khi upload
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (!fs.existsSync(filePath)) {
        console.error("❌ File không tồn tại để upload!");
        return null;
    }

    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(filePath));

        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(),
            timeout: 60000 // Tăng timeout lên 60s cho file lớn
        });
        
        if (response.data && typeof response.data === 'string' && response.data.includes('http')) {
            console.log("🔗 Link tải trực tiếp mới:", response.data);
            return response.data; 
        }
        return null;
    } catch (e) {
        console.error("❌ Lỗi upload Catbox:", e.message);
        return null;
    }
}

// --- HÀM GỬI MS TEAMS ---
async function sendToTeams(jobCount, directDownloadLink) {
    const webhookUrl = process.env.MS_TEAMS_WEBHOOK;
    if (!webhookUrl) return;

    // Nếu directDownloadLink bị null, nó sẽ trỏ về link chạy của GitHub thay vì trang chủ GitHub
    const fallbackLink = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    const finalLink = directDownloadLink || fallbackLink;

    const adaptiveCard = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "type": "AdaptiveCard",
                "body": [
                    { "type": "TextBlock", "size": "Medium", "weight": "Bolder", "text": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER" },
                    { "type": "FactSet", "facts": [
                        { "title": "Nguồn:", "value": "Indeed Canada" },
                        { "title": "Số lượng:", "value": `${jobCount} jobs` },
                        { "title": "Trạng thái:", "value": "Sẵn sàng tải về ✅" }
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
        console.log("✅ Đã gửi nút tải trực tiếp vào Teams!");
    } catch (e) { console.error("❌ MS Teams Error:", e.message); }
}

// --- HÀM CHẠY CHÍNH (GIỮ NGUYÊN NHƯ YÊU CẦU) ---
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
                const status = err.response ? err.response.status : "Timeout";
                console.log(`⚠️ Lỗi ${status} tại ${kw}.`);

                if (attempts < maxAttempts) {
                    console.log(`⚠️ Lần ${attempts} vẫn lỗi. Đổi IP mới và thử lại ngay...`);
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }
        await new Promise(r => setTimeout(r, 3000));
    }

    if (allJobs.length > 0) {
        const fileName = "Indeed_Jobs.xlsx";
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        // Chờ tạo file xong rồi mới upload link
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
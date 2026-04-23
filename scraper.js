import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
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
async function sendToTeamsViaAPI(jobCount) {
    const bearerToken = process.env.TEAMS_TOKEN; 
    if (!bearerToken) return;

    try {
        const token = bearerToken.startsWith('Bearer ') ? bearerToken : `Bearer ${bearerToken}`;
        
        // Đây là Endpoint chuẩn xác 100% trích xuất từ Network của bạn
        // Lưu ý: Tôi đã chuyển %3A thành : và %40 thành @ để tránh lỗi lặp mã hóa
        const chatId = "19:NSdc3795cx7bU0lxFnh51auWa7tdyWN2KXzmKQlQEMg1@thread.v2";
        const endpoint = `https://teams.cloud.microsoft/api/chatsvc/apac/v1/users/ME/conversations/${chatId}/messages`;

        const messageBody = {
            "content": `🚀 <b>CẬP NHẬT JOB MỚI</b><br/>- Tìm thấy: <b>${jobCount}</b> jobs.<br/>- Ngày: ${new Date().toLocaleDateString()}<br/>- File: Đã gửi qua Telegram.`,
            "messagetype": "RichText/Html",
            "contenttype": "text"
        };

        const response = await axios.post(endpoint, messageBody, {
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json',
                'X-Client-Version': '20/24020401405',
                'ScenarioId': 'S_Messaging_Chat_V2'
            }
        });

        if (response.status === 201 || response.status === 200) {
            console.log("✅ [API] Thành công! Tin nhắn đã xuất hiện trong Teams khu vực APAC.");
        }
    } catch (e) {
        // Log chi tiết để xử lý nếu Token hết hạn
        const status = e.response?.status;
        const data = e.response?.data ? JSON.stringify(e.response.data) : e.message;
        console.error(`❌ Lỗi API Teams (${status}):`, data);
    }
}
async function uploadFileToTeamsDirectly(jobCount, filePath) {
    const bearerToken = process.env.TEAMS_TOKEN;
    if (!bearerToken || !fs.existsSync(filePath)) return;

    try {
        const token = bearerToken.startsWith('Bearer ') ? bearerToken : `Bearer ${bearerToken}`;
        const fileName = filePath.split('/').pop();
        const stats = fs.statSync(filePath);
        
        // Chat ID chuẩn từ link bạn gửi
        const chatId = "19:NSdc3795cx7bU0lxFnh51auWa7tdyWN2KXzmKQlQEMg1@thread.v2";
        
        // BƯỚC 1: Khởi tạo đối tượng file (Xin lệnh Upload)
        const initRes = await axios.post(
            `https://teams.cloud.microsoft/api/chatsvc/apac/v1/users/ME/conversations/${chatId}/objects`,
            {
                "type": "message/file",
                "filename": fileName,
                "filesize": stats.size
            },
            { 
                headers: { 
                    'Authorization': token,
                    'Content-Type': 'application/json'
                } 
            }
        );

        const { uploadUrl, id: fileId } = initRes.data;

        // BƯỚC 2: Upload dữ liệu nhị phân lên server Microsoft
        const fileBuffer = fs.readFileSync(filePath);
        await axios.put(uploadUrl, fileBuffer, {
            headers: { 
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Length': stats.size
            }
        });

        // BƯỚC 3: Gửi tin nhắn chứa "Thẻ file" để hiển thị icon Excel trong khung chat
        const fileCardBody = {
            "content": `<file id="${fileId}" name="${fileName}"></file>`,
            "messagetype": "RichText/Html",
            "contenttype": "text",
            "properties": {
                "files": JSON.stringify([{
                    "id": fileId,
                    "displayName": fileName,
                    "type": "microsoft-excel",
                    "version": "1"
                }])
            }
        };

        await axios.post(
            `https://teams.cloud.microsoft/api/chatsvc/apac/v1/users/ME/conversations/${chatId}/messages`,
            fileCardBody,
            { 
                headers: { 
                    'Authorization': token,
                    'X-Client-Version': '20/24020401405'
                } 
            }
        );

        console.log("✅ [SUCCESS] File Excel đã được đẩy thẳng vào Teams!");

    } catch (e) {
        const errorDetail = e.response ? JSON.stringify(e.response.data) : e.message;
        console.error(`❌ Lỗi gửi file trực tiếp:`, errorDetail);
    }
}
// --- HÀM CHẠY CHÍNH (GIỮ NGUYÊN LOGIC CỦA BẠN) ---
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
        const fileName = `Indeed_Jobs.xlsx`; // Bỏ random để dễ quản lý trong workflow
        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        // Gửi báo cáo đồng thời
        // --- GIỮ NGUYÊN LOGIC CŨ VÀ GỌI THÊM HÀM FILE ---
        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs!`),
            sendTelegramFile(fileName),
            sendToTeamsViaAPI(allJobs.length), // Hàm cũ của bạn (Giữ nguyên)
            uploadFileToTeamsDirectly(allJobs.length, fileName) // Hàm mới (Thử nghiệm gửi file)
        ]);
        console.log("🏁 Hoàn tất tất cả báo cáo.");
    } else {
        await sendTelegramAlert("⚠️ Không lấy được dữ liệu job nào.");
    }
}

runScraper();
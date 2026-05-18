import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const KEYWORDS = [
  "Analyst", 
  "CFA", 
  "CEO", 
  "Data Science", 
  "FP&A",
  "artificial_intelligence",
  "data",
  "data scientist",
  "finance",
  "financial analyst",
  "investment",
  "investment management",
  "machine learning",
  "systems analyst",
  "technology manager"
];
// --- HÀM TỰ ĐỘNG LẤY TẤT CẢ KEY TỪ GOOGLE SHEETS ---
// --- HÀM TỰ ĐỘNG LẤY CHÍNH XÁC KEY TỪ CỘT D GOOGLE SHEETS ---
async function getScraperApiKeys() {
    // URL tải file dưới dạng Excel (xlsx) thay vì CSV để xử lý chính xác theo cột
    const sheetExcelUrl = "https://docs.google.com/spreadsheets/d/1TvG_bxAE0AIStNuAxVMrfYdnJepKWvRGhDkFTRcRIzs/export?format=xlsx";
    try {
        console.log("📥 Đang tải danh sách API Keys từ Google Sheet...");
        const response = await axios.get(sheetExcelUrl, { responseType: 'arraybuffer' });
        
        // Đọc dữ liệu Excel bằng thư viện XLSX có sẵn trong dự án của bạn
        const workbook = XLSX.read(response.data, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Chuyển đổi sheet thành mảng JSON dữ liệu
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        let keys = [];
        
        // Vòng lặp duyệt qua từng hàng dữ liệu (bỏ qua hàng tiêu đề đầu tiên)
        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            // Cột D trong Excel tương ứng với index số 3 trong mảng (A=0, B=1, C=2, D=3)
            const apiKey = row[3] ? row[3].toString().trim() : "";
            
            // Chỉ lấy các chuỗi hợp lệ, độ dài tối thiểu của một ScraperAPI Key chuẩn (~32 ký tự)
            if (apiKey && apiKey.length >= 20 && !apiKey.includes("KEY")) {
                keys.push(apiKey);
            }
        }
        
        console.log(`✅ Đã bóc tách chính xác ${keys.length} API Keys hoạt động từ Cột D.`);
        return keys;
    } catch (error) {
        console.error("❌ Không thể đọc Google Sheet, khôi phục dùng Key mặc định từ Secret:", error.message);
        return [process.env.SCRAPER_API_KEY]; 
    }
}

// --- CÁC HÀM PHỤ TRỢ GIỮ NGUYÊN NỘI DUNG 100% ---
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

async function sendToTeams(totalJobs, fileLink) {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!webhookUrl) return;

    const adaptiveCard = {
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
            { "type": "TextBlock", "text": "🚀 CẬP NHẬT JOB MỚI TẠI VANCOUVER", "weight": "Bolder", "size": "Medium", "color": "Accent" },
            {
                "type": "FactSet",
                "facts": [
                    { "title": "Nguồn:", "value": "Indeed Canada" },
                    { "title": "Số lượng:", "value": `${totalJobs} jobs` },
                    { "title": "Trạng thái:", "value": "Đã sẵn sàng ✅" }
                ]
            }
        ],
        "actions": [
            { "type": "Action.OpenUrl", "title": "📥 TẢI FILE EXCEL VỀ MÁY", "url": fileLink }
        ],
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json"
    };

    try {
        await axios.post(webhookUrl, adaptiveCard);
        console.log("✅ [Teams] Đã gửi Card thành công!");
    } catch (error) {
        console.error("❌ [Teams] Lỗi gửi:", error.message);
    }
}

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
    
    const apiKeys = await getScraperApiKeys();
    let currentKeyIndex = 0;
    let consecutiveErrors = 0; // Đếm số lần lỗi liên tiếp của các Key
    
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=Vancouver%2C+BC&radius=25&fromage=3`;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            // Nếu duyệt qua tất cả key trong Sheet mà không cái nào chạy được thì dừng tránh vòng lặp vô tận
            if (consecutiveErrors >= apiKeys.length) {
                console.log("❌ Toàn bộ API Keys trong Google Sheet đều lỗi hoặc hết credit!");
                break;
            }

            try {
                attempts++;
                const activeKey = apiKeys[currentKeyIndex % apiKeys.length];
                console.log(`🔍 Quét: ${kw} (Lần thử từ khóa: ${attempts}/3) - Sử dụng Key vị trí số [${(currentKeyIndex % apiKeys.length) + 1}]...`);

                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: activeKey,
                        url: targetUrl,
                        country_code: 'ca'
                    },
                    timeout: 60000
                });

                // Nếu chạy thành công tới đây, reset bộ đếm lỗi liên tiếp
                consecutiveErrors = 0;

                const $ = cheerio.load(response.data);
                let count = 0;

                $('.job_seen_beacon').each((i, el) => {
                    const titleEl = $(el).find('h2.jobTitle, a.jcs-JobTitle');
                    const title = titleEl.text().trim();

                    if (!title) return;

                    const relativeLink = titleEl.find('a').attr('href') || titleEl.attr('href');

                    // ==================== LẤY SALARY - CHỈ GIỮ PHẦN SỐ TIỀN ====================
                    let salary = "";

                    let salaryEl = $(el).find('[data-testid="attribute_snippet_testid"], .salary-snippet-container, .estimated-salary, [class*="salary-snippet"], .salary-section');

                    if (salaryEl.length) {
                        salary = salaryEl.text().trim();
                    }

                    salary = salary.replace(/\s+/g, ' ').trim();

                    if (salary.includes('$')) {
                        salary = salary
                            .replace(/Full-time/gi, '')
                            .replace(/Permanent/gi, '')
                            .replace(/\+1/gi, '')
                            .replace(/Mon/gi, '')
                            .replace(/Ove/gi, '')
                            .replace(/\s*-\s*Permanent/gi, '')
                            .replace(/\s*-\s*Full-time/gi, '')
                            .trim();
                    } else {
                        salary = "";
                    }
                    // =================================================================

                    const location = $(el).find('[data-testid="text-location"]').text().trim() ||
                                     $(el).find('.companyLocation').text().trim() ||
                                     "Vancouver, BC";

                    const company = $(el).find('[data-testid="company-name"]').text().trim() || "N/A";

                    const isQuickApply = $(el).find('.iaIcon').length > 0;
                    const applyMethod = isQuickApply ? "Indeed Quick Apply" : "Company Website";

                    allJobs.push({
                        Title: title,
                        Company: company,
                        Salary: salary,        
                        Location: location,
                        'Apply Method': applyMethod,
                        Link: relativeLink ? `https://ca.indeed.com${relativeLink}` : 'N/A',
                        Keyword: kw
                    });

                    count++;
                });

                console.log(`✅ Lấy được ${count} jobs cho từ khóa "${kw}"`);
                if (count > 0) break;

            } catch (err) {
                console.log(`⚠️ Lỗi ${kw} với Key vị trí [${(currentKeyIndex % apiKeys.length) + 1}]: ${err.message}`);
                
                // CƠ CHẾ BẠN CẦN: Đổi sang key tiếp theo NGAY LẬP TỨC
                currentKeyIndex++;
                consecutiveErrors++;
                console.log(`🔄 Key lỗi/Hết credit. Đổi sang Key tiếp theo ở vị trí [${(currentKeyIndex % apiKeys.length) + 1}]...`);

                // Vì Key lỗi nên lượt thử của từ khóa này không được tính, hạ bộ đếm attempts xuống để nó chạy lại với Key mới luôn
                attempts--; 
                
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        if (consecutiveErrors >= apiKeys.length) break;
    }

    if (allJobs.length > 0) {
        const fileName = `Indeed_Jobs_${new Date().toISOString().slice(0,10)}.xlsx`;

        const worksheet = XLSX.utils.json_to_sheet(allJobs);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");
        XLSX.writeFile(workbook, fileName);

        console.log(`📊 Đã lưu ${allJobs.length} jobs vào ${fileName}`);

        const fileLink = await uploadToCatbox(fileName);

        await Promise.all([
            sendTelegramAlert(`✅ Tìm thấy ${allJobs.length} jobs mới!`),
            sendTelegramFile(fileName),
            sendToTeams(allJobs.length, fileLink)
        ]);

        console.log("🏁 Hoàn tất!");
    } else {
        console.log("❌ Không tìm thấy job nào.");
        await sendTelegramAlert("❌ Không tìm thấy job mới nào.");
    }
}

runScraper();
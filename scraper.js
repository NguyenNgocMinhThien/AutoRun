const puppeteer = require('puppeteer');
const axios = require('axios'); // Dùng để gửi tin nhắn Telegram

// Yêu cầu 1: Từ khóa và Địa điểm
const KEYWORDS = [
    "Analyst", "FP&A", "Investment", "quantitative researcher", "data science", 
    "CFA", "Actuarial", "President", "CEO", "CIO", "CTO"
];
const LOCATIONS = ["Vancouver, BC", "Burnaby, BC", "North Vancouver, BC", "West Vancouver, BC"];

// Yêu cầu 2: Lọc 3 ngày gần nhất (tích hợp thẳng vào tham số URL của Indeed: &fromage=3)
// Yêu cầu 3: Lương > $60k/year hoặc > $30/hour

async function sendTelegramAlert(message) {
    const botToken = 'TOKEN_CỦA_BẠN';
    const chatId = 'CHAT_ID_CỦA_BẠN';
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error("Lỗi gửi Telegram:", error);
    }
}

async function runScraper() {
    console.log("Khởi động trình duyệt ảo ngầm...");
    const browser = await puppeteer.launch({ 
        headless: true, // Chạy ngầm (bắt buộc khi đưa lên server)
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    let allValidJobs = [];

    for (const location of LOCATIONS) {
        for (const keyword of KEYWORDS) {
            // URL đã set sẵn từ khóa, địa điểm và bộ lọc 3 ngày (fromage=3)
            const url = `https://ca.indeed.com/jobs?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}&fromage=3`;
            console.log(`Đang quét: ${keyword} tại ${location}`);
            
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            // Đợi một chút để tránh bị Indeed chặn
            await new Promise(r => setTimeout(r, 3000));

            // BẠN CÓ THỂ COPY LOGIC TỪ FILE CONTENT.JS CỦA EXTENSION VÀO ĐÂY
            const jobs = await page.evaluate(() => {
                let results = [];
                // Ví dụ class của Indeed (cần check lại vì Indeed hay đổi)
                const jobCards = document.querySelectorAll('.job_seen_beacon'); 
                
                jobCards.forEach(card => {
                    const title = card.querySelector('h2.jobTitle')?.innerText || '';
                    const company = card.querySelector('.companyName')?.innerText || '';
                    const link = card.querySelector('h2.jobTitle a')?.href || '';
                    const salaryText = card.querySelector('.salary-snippet-container')?.innerText || '';
                    
                    // Logic lọc lương cơ bản (Bạn có thể làm mịn hơn bằng Regex)
                    let isSalaryValid = false;
                    if (salaryText) {
                        const salaryStr = salaryText.replace(/,/g, '').toLowerCase();
                        const numMatch = salaryStr.match(/\d+/);
                        if (numMatch) {
                            const num = parseInt(numMatch[0]);
                            if (salaryStr.includes('year') && num >= 60000) isSalaryValid = true;
                            if (salaryStr.includes('hour') && num >= 30) isSalaryValid = true;
                        }
                    } else {
                        // Nếu job không để lương, có thể quyết định lấy hay bỏ tùy bạn
                        isSalaryValid = true; 
                    }

                    if (isSalaryValid) {
                        results.push({ title, company, link, salary: salaryText });
                    }
                });
                return results;
            });

            allValidJobs = allValidJobs.concat(jobs);
        }
    }

    await browser.close();

    // Xử lý gửi báo cáo
    if (allValidJobs.length > 0) {
        let msg = `<b>📊 BÁO CÁO JOB MỚI (Lọc 3 ngày)</b>\nTổng số: ${allValidJobs.length} jobs\n\n`;
        // Cắt bớt nếu tin nhắn quá dài
        const jobsToSend = allValidJobs.slice(0, 10); 
        jobsToSend.forEach((j, index) => {
            msg += `${index + 1}. <b>${j.title}</b>\n🏢 ${j.company}\n💰 ${j.salary || 'Không rõ'}\n🔗 <a href="${j.link}">Xem chi tiết</a>\n\n`;
        });
        
        await sendTelegramAlert(msg);
        console.log("Đã gửi báo cáo thành công!");
    } else {
        await sendTelegramAlert("Sáng nay không quét được job nào thỏa điều kiện.");
        console.log("Không có data mới.");
    }
}

runScraper();
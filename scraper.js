const puppeteer = require('puppeteer');
const axios = require('axios');
const XLSX = require('xlsx'); // Thêm thư viện Excel

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];
const LOCATIONS = ["Vancouver, BC"];

async function sendTelegramAlert(message) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } catch (e) {
        console.error("Telegram Error: Dãy ID hoặc Token có thể bị sai.");
    }
}

async function runScraper() {
    console.log("🚀 Đang khởi động trình duyệt tàng hình...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let allJobs = [];

    for (const kw of KEYWORDS) {
        const url = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=Vancouver%2C+BC&fromage=3`;
        try {
            console.log(`🔍 Đang thử truy cập: ${kw}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Chờ ngẫu nhiên để tránh bot detection
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 4000) + 3000));

            const jobs = await page.evaluate(() => {
                let results = [];
                document.querySelectorAll('.job_seen_beacon').forEach(card => {
                    const title = card.querySelector('h2.jobTitle')?.innerText || "";
                    const salaryText = card.querySelector('.salary-snippet-container')?.innerText ||
                        card.querySelector('.estimated-salary-container')?.innerText || "";
                    const link = card.querySelector('h2.jobTitle a')?.href || "";

                    // Logic lọc: Min $60k/năm hoặc $30/giờ
                    let isValidSalary = false;
                    if (salaryText) {
                        const s = salaryText.toLowerCase().replace(/,/g, '');
                        const matches = s.match(/\d+/);
                        if (matches) {
                            const num = parseInt(matches[0]);
                            // Nếu Indeed ghi kiểu "60" thay vì "60000" cho lương năm
                            const normalizedNum = (s.includes('year') && num < 1000) ? num * 1000 : num;
                            
                            if (s.includes('year') && normalizedNum >= 60000) isValidSalary = true;
                            else if (s.includes('hour') && normalizedNum >= 30) isValidSalary = true;
                            else if (normalizedNum >= 60000) isValidSalary = true;
                        }
                    } else {
                        isValidSalary = true; // Giữ lại job không lương để sếp xem
                    }

                    if (isValidSalary) {
                        results.push({
                            Title: title,
                            Salary: salaryText,
                            Link: link
                        });
                    }
                });
                return results;
            });
            console.log(`✅ Tìm thấy ${jobs.length} jobs cho từ khóa ${kw}`);
            allJobs.push(...jobs);
        } catch (err) {
            console.log(`❌ Lỗi tại từ khóa ${kw}: Có thể bị Indeed chặn.`);
        }
    }

    await browser.close();

    // --- PHẦN XỬ LÝ DỮ LIỆU ---
    if (allJobs.length > 0) {
        // 1. Loại bỏ trùng lặp nếu có
        const uniqueJobs = Array.from(new Set(allJobs.map(a => a.Link)))
            .map(link => allJobs.find(a => a.Link === link));

        // 2. Xuất file Excel
        try {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(uniqueJobs);
            XLSX.utils.book_append_sheet(wb, ws, "Jobs_Report");
            XLSX.writeFile(wb, "Indeed_Jobs.xlsx");
            console.log("📊 Đã tạo xong file Indeed_Jobs.xlsx");
        } catch (err) {
            console.error("❌ Lỗi khi tạo file Excel:", err);
        }

        // 3. Gửi Telegram (tối đa 10 job tiêu biểu)
        let msg = `<b>✅ ĐÃ TÌM THẤY ${uniqueJobs.length} JOB PHÙ HỢP</b>\n\n`;
        uniqueJobs.slice(0, 10).forEach((j, i) => {
            msg += `${i + 1}. <b>${j.Title}</b>\n💰 ${j.Salary || 'Thỏa thuận'}\n🔗 <a href="${j.Link}">Link</a>\n\n`;
        });
        await sendTelegramAlert(msg);
    } else {
        await sendTelegramAlert("⚠️ Chạy thành công nhưng không tìm thấy job nào đạt yêu cầu lương.");
    }
}

runScraper();
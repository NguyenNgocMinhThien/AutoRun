import axios from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';

const KEYWORDS = ["Analyst", "FP&A", "Data Science", "CFA"];

// --- HÀM LỌC LƯƠNG CHUẨN ---
function isSalaryHighEnough(salaryText) {
    if (!salaryText || salaryText === "N/A") return true;
    const numbers = salaryText.replace(/,/g, '').match(/\d+/g);
    if (!numbers) return true;
    const val = parseInt(numbers[0]);
    if (salaryText.toLowerCase().includes('hour')) return val >= 30;
    if (val >= 60000 || (val >= 30 && val < 1000)) return true;
    return false;
}

// --- HÀM UPLOAD (SỬA LỖI 405) ---
async function uploadToCatbox(filePath) {
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(filePath));
        // Đổi sang API Catbox chính để ổn định hơn
        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders()
        });
        return response.data.trim();
    } catch (error) {
        console.error("❌ Lỗi Upload:", error.message);
        return "N/A";
    }
}

// --- HÀM CHẠY CHÍNH ---
async function runScraper() {
    console.log("🚀 Đang xử lý lỗi 500 và N/A...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://ca.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=Vancouver%2C+BC&fromage=3`;
        try {
            console.log(`🔍 Đang quét: ${kw}`);
            const response = await axios.get('http://api.scraperapi.com', {
                params: {
                    api_key: process.env.SCRAPER_API_KEY,
                    url: targetUrl,
                    render: 'true',
                    country_code: 'ca',
                    autoparse: 'true', // Tự động bóc tách để tránh N/A
                    ultra_premium: 'true' // Vượt lỗi 500
                }
            });

            const $ = cheerio.load(response.data);
            $('.job_seen_beacon').each((i, el) => {
                const title = $(el).find('h2.jobTitle').text().trim();
                // Selector mới nhất cho Salary và Location
                const salary = $(el).find('[data-testid="attribute_snippet_testid"]').first().text().trim() || "N/A";
                const location = $(el).find('[data-testid="text-location"]').text().trim() || "Vancouver, BC";

                if (title && isSalaryHighEnough(salary)) {
                    allJobs.push({
                        Title: title,
                        Company: $(el).find('[data-testid="company-name"]').text().trim(),
                        Salary: salary,
                        Location: location,
                        Link: "https://ca.indeed.com" + $(el).find('a').attr('href')
                    });
                }
            });
        } catch (err) {
            console.log(`⚠️ Bỏ qua ${kw} do lỗi hệ thống.`);
        }
    }

    if (allJobs.length > 0) {
        const fileName = 'Job_Report.xlsx';
        const ws = XLSX.utils.json_to_sheet(allJobs);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Jobs");
        XLSX.writeFile(wb, fileName);
        
        const link = await uploadToCatbox(fileName);
        console.log(`✅ Hoàn tất! Link: ${link}`);
    }
}

runScraper();
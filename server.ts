import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const getDirname = () => {
  try {
    return typeof __dirname !== "undefined" 
      ? __dirname 
      : path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};
const __dirnameSafe = getDirname();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use larger limits for base64 images upload
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Lazy initialization helper for Gemini
  let aiInstance: GoogleGenAI | null = null;
  function getAi() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("Không tìm thấy GEMINI_API_KEY trên máy chủ. Vui lòng thiết lập biến môi trường này trong mục Settings > Secrets.");
    }
    if (!aiInstance) {
      aiInstance = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
    return aiInstance;
  }

  // API Route: OCR trích xuất văn bản
  app.post("/api/ocr", async (req: express.Request, res: express.Response) => {
    try {
      const { base64Image, mimeType } = req.body;
      if (!base64Image || !mimeType) {
        return res.status(400).json({ error: "Thiếu dữ liệu ảnh hoặc định dạng ảnh." });
      }

      let aiClient;
      try {
        aiClient = getAi();
      } catch (keyError: any) {
        return res.status(400).json({ error: keyError.message });
      }

      // use the correct model requested in skill guidelines for text tasks
      const model = "gemini-3.5-flash";
      
      const prompt = `
        Bạn là một chuyên gia OCR (Nhận diện ký tự quang học) và biên tập văn bản chuyên nghiệp.
        Nhiệm vụ của bạn là trích xuất TOÀN BỘ văn bản từ hình ảnh được cung cấp với độ chính xác tuyệt đối.
        
        YÊU CẦU ĐẶC BIỆT VỀ ĐỊNH DẠNG VÀ CẤU TRÚC (SỬ DỤNG HOÀN TOÀN MARKDOWN):
        1. Nhận diện tiêu đề: Định dạng các tiêu đề thành các cấp độ Heading tương ứng trong Markdown (#, ##, ###,... dựa trên kích thước chữ và vai trò trong văn bản).
        2. Nhận diện in đậm/in nghiêng/gạch chân:
           - In đậm: **văn bản**
           - In nghiêng: *văn bản*
           - Gạch chân (Underline): Sử dụng thẻ HTML chuẩn <u>văn bản</u> khi có chữ gạch dưới trong ảnh.
        3. Nhận diện danh sách: Định dạng các danh sách không thứ tự sử dụng dấu gạch đầu dòng (ví dụ: "- Mục 1") hoặc danh sách có thứ tự sử dụng số (ví dụ: "1. Mục 1").
        4. Đoạn văn liền mạch: Nếu các dòng chữ thuộc nguyên một đoạn văn dài, hãy ghép chúng lại thành một khối câu hoàn chỉnh, KHÔNG ngắt dòng tùy tiện giữa câu hoặc giữa chừng. Chỉ ngắt dòng khi chuyển sang đoạn văn mới.
        5. Nhận diện Bảng biểu: Nếu ảnh chứa bảng biểu, hãy chuyển nó thành bảng Markdown chuẩn cấu trúc:
           | Tiêu đề 1 | Tiêu đề 2 |
           | --------- | --------- |
           | Giá trị 1 | Giá trị 2 |
        6. Độ chính xác nội dung: Không thêm bớt từ ngữ, giữ đúng chính tả, ngữ pháp, các ký tự đặc biệt có trong ảnh. Không thêm phần lời khuyên, lời giải thích hay lời dẫn dắt bên ngoài. Chỉ trả về trực tiếp văn bản Markdown trích xuất.
        7. Nếu ảnh hoàn toàn trống hoặc không thể nhận diện được bất kỳ ký tự nào, chỉ trả về chuỗi rỗng "".
      `;

      const rawData = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

      const imagePart = {
        inlineData: {
          data: rawData,
          mimeType: mimeType,
        },
      };

      const response = await aiClient.models.generateContent({
        model: model,
        contents: { parts: [imagePart, { text: prompt }] },
      });

      return res.json({ text: response.text || "" });
    } catch (error: any) {
      console.error("OCR API error:", error);
      return res.status(500).json({ error: error?.message || "Lỗi máy chủ khi trích xuất văn bản." });
    }
  });

  // API Route: Tự động đặt tên file từ nội dung văn bản
  app.post("/api/generate-filename", async (req: express.Request, res: express.Response) => {
    try {
      const { text } = req.body;
      if (!text || text.trim().length < 10) {
        return res.json({ filename: "tai-lieu-trich-xuat" });
      }

      let aiClient;
      try {
        aiClient = getAi();
      } catch (keyError: any) {
        return res.json({ filename: "tai-lieu-trich-xuat" });
      }

      const model = "gemini-3.5-flash";
      const prompt = `
        Dựa vào nội dung văn bản sau đây, hãy đặt một tên file ngắn gọn, súc tích và phù hợp nhất (không quá 5-7 từ).
        YÊU CẦU:
        1. Trả về tên file bằng tiếng Việt không dấu, các từ cách nhau bằng dấu gạch ngang (-).
        2. Không bao gồm phần mở rộng (như .docx).
        3. Chỉ trả về chuỗi tên file, không thêm bất kỳ văn bản nào khác.
        
        Nội dung văn bản:
        ${text.substring(0, 1000)}
      `;

      const response = await aiClient.models.generateContent({
        model: model,
        contents: prompt,
      });

      let filename = response.text?.trim() || "tai-lieu-trich-xuat";
      filename = filename.toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      return res.json({ filename: filename || "tai-lieu-trich-xuat" });
    } catch (error: any) {
      console.error("Filename generation API error:", error);
      return res.json({ filename: "tai-lieu-trich-xuat" });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer();

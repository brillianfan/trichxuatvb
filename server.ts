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

function cleanErrorMessage(error: any): string {
  let msg = error?.message || "";
  if (!msg && error) {
    msg = typeof error === "string" ? error : JSON.stringify(error);
  }
  
  if (msg.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error?.message) {
        return parsed.error.message;
      }
      if (parsed?.message) {
        return parsed.message;
      }
    } catch {
      // Non-parseable, continue
    }
  }
  
  if (msg.includes("503") || msg.includes("UNAVAILABLE")) {
    return "Mẫu AI đang bị quá tải tạm thời. Vui lòng thử lại sau vài giây.";
  }
  return msg;
}

function normalizeSpacings(text: string): string {
  if (!text) return "";
  
  // Clean up carriage returns
  const normalizedNewlines = text.replace(/\r\n/g, "\n");
  
  const lines = normalizedNewlines.split("\n").map(line => line.trimEnd());
  
  const cleanedLines: string[] = [];
  
  for (const line of lines) {
    if (line.trim() === "") {
      // Bỏ qua toàn bộ dòng trống để không sinh ra bất kỳ dòng trắng thừa nào
      continue;
    } else {
      cleanedLines.push(line);
    }
  }
  
  return cleanedLines.join("\n").trim();
}

async function generateWithFallbackAndRetry(
  aiClient: GoogleGenAI,
  parameters: any,
  modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"],
  retriesPerModel = 2,
  delayBetweenRetries = 1000
): Promise<any> {
  let lastError: any = new Error("No models tried");

  for (const model of modelsToTry) {
    console.log(`[Gemini API] Attempting generation with model: ${model}`);
    for (let i = 0; i < retriesPerModel; i++) {
      try {
        return await aiClient.models.generateContent({
          model,
          ...parameters,
        });
      } catch (error: any) {
        lastError = error;
        const errorMessage = error?.message || "";
        const isRetryable = (
          error?.status === 503 ||
          error?.code === 503 ||
          errorMessage.includes("503") ||
          errorMessage.includes("UNAVAILABLE") ||
          errorMessage.includes("high demand") ||
          errorMessage.includes("temporary") ||
          error?.status === 429 ||
          error?.code === 429
        );
        if (isRetryable) {
          console.warn(`[Gemini API Warning] Retryable error on model ${model} (Attempt ${i + 1}/${retriesPerModel}). Retrying in ${delayBetweenRetries * (i + 1)}ms: ${errorMessage}`);
          await new Promise((resolve) => setTimeout(resolve, delayBetweenRetries * (i + 1)));
          continue;
        }
        // If it's a non-retryable error (e.g. invalid arguments or perm permission issues), fail immediately
        throw error;
      }
    }
    console.warn(`[Gemini API Warning] Model ${model} failed after all retries. Trying next fallback model...`);
  }

  throw lastError;
}

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
        return res.status(400).json({ error: "Vui lòng cung cấp hình ảnh để trích xuất." });
      }

      let aiClient;
      try {
        aiClient = getAi();
      } catch (keyError: any) {
        return res.status(400).json({ error: keyError.message });
      }

      // use the correct model requested in skill guideline
      const prompt = `
        Bạn là một chuyên gia OCR (Nhận diện ký tự quang học) và cấu trúc hóa văn bản chuyên nghiệp.
        Nhiệm vụ duy nhất của bạn là trích xuất TOÀN BỘ văn bản từ hình ảnh được cung cấp với độ chính xác tuyệt đối.
        
        QUY TẮC BẮT BUỘC (QUAN TRỌNG NHẤT):
        - CHỈ TRÍCH XUẤT VĂN BẢN, TUYỆT ĐỐI KHÔNG GIẢI BÀI TẬP HOẶC TRẢ LỜI CÂU HỎI.
        - Nếu ảnh chứa đề thi, bài tập toán, lý, hóa, câu hỏi trắc nghiệm, câu hỏi tiếng Anh, câu đố,... bạn CHỈ được gõ lại nguyên văn đề bài và các phương án lựa chọn (A, B, C, D) dưới dạng Markdown.
        - KHÔNG được đưa ra lời giải, KHÔNG tính toán kết quả, KHÔNG gợi ý đáp án đúng, và KHÔNG giải thích bất kỳ nội dung nào.
        - Không thêm bớt lời dẫn như "Sau đây là văn bản trích xuất" hoặc thêm bất kỳ lời nói phụ họa nào khác.
        
        YÊU CẦU ĐẶC BIỆT SÁT THỰC TẾ VỀ TRÌNH BÀY (CHỈ XUỐNG DÒNG 1 LẦN, TUYỆT ĐỐI KHÔNG SỬ DỤNG DÒNG TRỐNG):
        1. Nhận diện, gộp dòng thông minh và ngắt đoạn không dòng trống:
           - Hãy phân biệt rõ dòng kết thúc thực sự của một đoạn và dòng xuống hàng cơ học của trang giấy (ngắt dòng tự động do giới hạn chiều rộng trang).
           - Gộp các dòng liên tục của cùng một đoạn văn thành một dòng dài mạch lạc, KHÔNG ngắt dòng tùy tiện ở giữa câu hoặc gãy dòng ở mép ảnh.
           - Khi bắt đầu một đoạn văn mới, một tiêu đề mới, hoặc một danh mục/mục lục mới, CHỈ sử dụng duy nhất một ký tự xuống dòng (\n). TUYỆT ĐỐI KHÔNG sử dụng hai hay nhiều ký tự xuống dòng liên tiếp (\n\n), không tạo ra bất kỳ dòng trống hay dòng trắng phân tách nào giữa các đoạn văn hay tiêu đề. Tất cả các phần văn bản chỉ cách nhau đúng một lượt xuống hàng sát nhau.
        2. Nhận diện tiêu đề: Định dạng các tiêu đề thành các cấp độ Heading tương ứng trong Markdown (#, ##, ###,... dựa trên kích thước chữ và vai trò trong văn bản).
        3. Nhận diện in đậm/in nghiêng/gạch chân:
           - In đậm: **văn bản**
           - In nghiêng: *văn bản*
           - Gạch chân (Underline): Sử dụng thẻ HTML chuẩn <u>văn bản</u> khi có chữ gạch dưới trong ảnh.
        4. Nhận diện danh sách: Định dạng các danh sách không thứ tự sử dụng dấu gạch đầu dòng (ví dụ: "- Mục 1") hoặc danh sách có thứ tự sử dụng số (ví dụ: "1. Mục 1"). Đảm bảo các dòng trong mỗi mục danh sách được căn chỉnh đúng, không ngắt dòng ngẫu nhiên.
        5. Nhận diện Bảng biểu: Nếu ảnh chứa bảng biểu, hãy chuyển nó thành bảng Markdown chuẩn cấu trúc:
           | Tiêu đề 1 | Tiêu đề 2 |
           | --------- | --------- |
           | Giá trị 1 | Giá trị 2 |
        6. Độ chính xác nội dung: Giữ nguyên vẹn chính tả, ngữ pháp, các ký tự đặc biệt có trong ảnh. Không thêm phần lời khuyên, giải thích hay lời dẫn dắt bên ngoài. Chỉ trả về trực tiếp văn bản Markdown sạch sẽ sau trích xuất.
        7. Nếu ảnh hoàn toàn trống hoặc không thể nhận diện được bất kỳ ký tự nào, chỉ trả về chuỗi rỗng "".
      `;

      const rawData = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

      const imagePart = {
        inlineData: {
          data: rawData,
          mimeType: mimeType,
        },
      };

      const response = await generateWithFallbackAndRetry(aiClient, {
        contents: { parts: [imagePart, { text: prompt }] },
      });

      const processedText = normalizeSpacings(response.text || "");
      return res.json({ text: processedText });
    } catch (error: any) {
      console.error("OCR API error:", error);
      const cleanMsg = cleanErrorMessage(error);
      return res.status(500).json({ error: cleanMsg || "Lỗi máy chủ khi trích xuất văn bản." });
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

      const prompt = `
        Dựa vào nội dung văn bản sau đây, hãy đặt một tên file ngắn gọn, súc tích và phù hợp nhất (không quá 5-7 từ).
        YÊU CẦU:
        1. Trả về tên file bằng tiếng Việt không dấu, các từ cách nhau bằng dấu gạch ngang (-).
        2. Không bao gồm phần mở rộng (như .docx).
        3. Chỉ trả về chuỗi tên file, không thêm bất kỳ văn bản nào khác.
        
        Nội dung văn bản:
        ${text.substring(0, 1000)}
      `;

      const response = await generateWithFallbackAndRetry(aiClient, {
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

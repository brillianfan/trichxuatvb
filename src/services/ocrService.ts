import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function extractTextFromImage(base64Image: string, mimeType: string): Promise<string> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Bạn là một chuyên gia OCR (Nhận diện ký tự quang học). 
    Nhiệm vụ của bạn là trích xuất TOÀN BỘ văn bản từ hình ảnh được cung cấp.
    
    YÊU CẦU:
    1. Giữ nguyên nội dung, không thêm bớt bất kỳ từ nào.
    2. Giữ đúng định dạng văn bản (xuống dòng, thụt đầu dòng, danh sách nếu có).
    3. Nếu có bảng biểu, hãy cố gắng trình bày lại dưới dạng văn bản có cấu trúc rõ ràng.
    4. Chỉ trả về văn bản đã trích xuất, không thêm lời dẫn giải hay nhận xét nào khác.
    5. Nếu hình ảnh không có chữ, hãy trả về chuỗi rỗng.
  `;

  const imagePart = {
    inlineData: {
      data: base64Image.split(",")[1] || base64Image,
      mimeType: mimeType,
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [imagePart, { text: prompt }] },
    });

    return response.text || "";
  } catch (error) {
    console.error("OCR Error:", error);
    throw new Error("Không thể trích xuất văn bản từ ảnh này.");
  }
}

export async function generateFilenameFromText(text: string): Promise<string> {
  if (!text || text.trim().length < 10) return "tai-lieu-trich-xuat";
  
  const model = "gemini-3-flash-preview";
  const prompt = `
    Dựa vào nội dung văn bản sau đây, hãy đặt một tên file ngắn gọn, súc tích và phù hợp nhất (không quá 5-7 từ).
    YÊU CẦU:
    1. Trả về tên file bằng tiếng Việt không dấu, các từ cách nhau bằng dấu gạch ngang (-).
    2. Không bao gồm phần mở rộng (như .docx).
    3. Chỉ trả về chuỗi tên file, không thêm bất kỳ văn bản nào khác.
    
    Nội dung văn bản:
    ${text.substring(0, 1000)}
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });

    let filename = response.text?.trim() || "tai-lieu-trich-xuat";
    // Clean up filename just in case
    filename = filename.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
      
    return filename || "tai-lieu-trich-xuat";
  } catch (error) {
    console.error("Filename generation error:", error);
    return "tai-lieu-trich-xuat";
  }
}

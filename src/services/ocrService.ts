export async function extractTextFromImage(base64Image: string, mimeType: string): Promise<string> {
  try {
    const response = await fetch("/api/ocr", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base64Image, mimeType }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Gặp lỗi khi giao tiếp với máy chủ OCR.");
    }

    const data = await response.json();
    return data.text || "";
  } catch (error: any) {
    console.error("OCR Client Error:", error);
    throw new Error(error?.message || "Không thể kết nối đến máy chủ trích xuất văn bản.");
  }
}

export async function generateFilenameFromText(text: string): Promise<string> {
  try {
    const response = await fetch("/api/generate-filename", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      return "tai-lieu-trich-xuat";
    }

    const data = await response.json();
    return data.filename || "tai-lieu-trich-xuat";
  } catch (error) {
    console.error("Filename Client Error:", error);
    return "tai-lieu-trich-xuat";
  }
}

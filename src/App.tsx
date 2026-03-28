import React, { useState, useCallback, useEffect, useRef } from "react";
import { 
  Upload, 
  Image as ImageIcon, 
  FileText, 
  Download, 
  X, 
  Loader2, 
  Clipboard, 
  CheckCircle2, 
  AlertCircle,
  Plus,
  Trash2,
  Copy
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import { extractTextFromImage, generateFilenameFromText } from "./services/ocrService";
import { cn } from "./lib/utils";

interface ImageFile {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "processing" | "completed" | "error";
  extractedText?: string;
  error?: string;
}

export default function App() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const newImages: ImageFile[] = Array.from(files)
      .filter(file => file.type.startsWith("image/"))
      .map(file => ({
        id: Math.random().toString(36).substring(7),
        file,
        preview: URL.createObjectURL(file),
        status: "pending"
      }));

    setImages(prev => [...prev, ...newImages]);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const onPaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) files.push(blob);
        }
      }
      if (files.length > 0) {
        handleFiles(files);
      }
    }
  }, [handleFiles]);

  useEffect(() => {
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onPaste]);

  const removeImage = (id: string) => {
    setImages(prev => {
      const filtered = prev.filter(img => img.id !== id);
      const removed = prev.find(img => img.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return filtered;
    });
  };

  const processImage = async (id: string) => {
    const img = images.find(i => i.id === id);
    if (!img || img.status === "processing") return;

    setImages(prev => prev.map(i => i.id === id ? { ...i, status: "processing" } : i));

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(img.file);
      });
      
      const base64 = await base64Promise;
      const text = await extractTextFromImage(base64, img.file.type);
      
      setImages(prev => prev.map(i => i.id === id ? { 
        ...i, 
        status: "completed", 
        extractedText: text 
      } : i));
    } catch (err) {
      setImages(prev => prev.map(i => i.id === id ? { 
        ...i, 
        status: "error", 
        error: (err as Error).message 
      } : i));
    }
  };

  const processAll = async () => {
    const pending = images.filter(img => img.status === "pending" || img.status === "error");
    for (const img of pending) {
      await processImage(img.id);
    }
  };

  const exportToDocx = async () => {
    if (images.length === 0) return;
    setIsExporting(true);

    try {
      const sections = images
        .filter(img => img.extractedText)
        .map(img => {
          const lines = img.extractedText!.split("\n");
          return {
            properties: {},
            children: lines.map(line => new Paragraph({
              children: [new TextRun(line)],
            })),
          };
        });

      const doc = new Document({
        sections: sections
      });

      const allText = images.map(img => img.extractedText || "").join(" ");
      const filename = await generateFilenameFromText(allText);

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `${filename}.docx`);
    } catch (error) {
      console.error("Export error:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const totalProcessed = images.filter(img => img.status === "completed").length;
  const isProcessing = images.some(img => img.status === "processing");

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <header className="text-center space-y-2">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-bold tracking-tight text-[#0F172A]"
          >
            Trích Xuất Văn Bản Thông Minh
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-[#64748B] text-lg"
          >
            Tải lên, dán ảnh và trích xuất văn bản tức thì với AI
          </motion.p>
        </header>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Upload & List */}
          <div className="lg:col-span-5 space-y-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative border-2 border-dashed rounded-2xl p-8 transition-all cursor-pointer flex flex-col items-center justify-center space-y-4 bg-white",
                isDragging ? "border-blue-500 bg-blue-50/50 scale-[1.02]" : "border-slate-200 hover:border-slate-300",
                images.length > 0 ? "py-10" : "py-20"
              )}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
                multiple 
                accept="image/*" 
                className="hidden" 
              />
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
                <Upload size={32} />
              </div>
              <div className="text-center">
                <p className="font-semibold text-lg">Kéo thả hoặc chọn ảnh</p>
                <p className="text-sm text-slate-500">Hỗ trợ JPG, PNG, WEBP hoặc dán (Ctrl+V)</p>
              </div>
            </div>

            {images.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-lg flex items-center gap-2">
                    <ImageIcon size={20} className="text-blue-600" />
                    Danh sách ảnh ({images.length})
                  </h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={processAll}
                      disabled={isProcessing || images.every(i => i.status === "completed")}
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      Xử lý tất cả
                    </button>
                    <button 
                      onClick={() => {
                        images.forEach(img => URL.revokeObjectURL(img.preview));
                        setImages([]);
                      }}
                      className="text-sm font-medium text-red-600 hover:text-red-700"
                    >
                      Xóa hết
                    </button>
                  </div>
                </div>

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  <AnimatePresence mode="popLayout">
                    {images.map((img) => (
                      <motion.div
                        key={img.id}
                        layout
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={cn(
                          "group p-3 rounded-xl border bg-white flex items-center gap-4 transition-all",
                          img.status === "processing" ? "border-blue-200 bg-blue-50/30" : "border-slate-100"
                        )}
                      >
                        <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border border-slate-200">
                          <img src={img.preview} alt="preview" className="w-full h-full object-cover" />
                          {img.status === "processing" && (
                            <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                              <Loader2 className="animate-spin text-white" size={20} />
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate text-slate-700">{img.file.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {img.status === "pending" && <span className="text-xs text-slate-400">Chờ xử lý</span>}
                            {img.status === "processing" && <span className="text-xs text-blue-500 font-medium">Đang trích xuất...</span>}
                            {img.status === "completed" && (
                              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                <CheckCircle2 size={12} /> Hoàn tất
                              </span>
                            )}
                            {img.status === "error" && (
                              <span className="text-xs text-red-500 font-medium flex items-center gap-1">
                                <AlertCircle size={12} /> Lỗi
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {img.status !== "completed" && img.status !== "processing" && (
                            <button 
                              onClick={() => processImage(img.id)}
                              className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                              title="Xử lý"
                            >
                              <Plus size={18} />
                            </button>
                          )}
                          <button 
                            onClick={() => removeImage(img.id)}
                            className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                            title="Xóa"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full min-h-[600px]">
              <div className="p-4 border-bottom border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-t-2xl">
                <div className="flex items-center gap-2">
                  <FileText size={20} className="text-blue-600" />
                  <h2 className="font-bold">Kết quả trích xuất</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={exportToDocx}
                    disabled={totalProcessed === 0 || isExporting}
                    className="flex items-center gap-2 px-4 py-2 bg-[#0F172A] text-white rounded-xl text-sm font-medium hover:bg-[#1E293B] disabled:opacity-50 transition-all"
                  >
                    {isExporting ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                    Xuất DOCX
                  </button>
                </div>
              </div>

              <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                {images.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                      <Clipboard size={32} />
                    </div>
                    <p className="text-center">Chưa có dữ liệu. Hãy tải ảnh lên để bắt đầu.</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {images.map((img) => (
                      img.extractedText && (
                        <div key={img.id} className="space-y-3 group">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              <ImageIcon size={14} />
                              {img.file.name}
                            </div>
                            <button 
                              onClick={() => copyToClipboard(img.extractedText!)}
                              className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                              title="Sao chép"
                            >
                              <Copy size={16} />
                            </button>
                          </div>
                          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 whitespace-pre-wrap text-slate-700 leading-relaxed font-mono text-sm">
                            {img.extractedText}
                          </div>
                        </div>
                      )
                    ))}
                    {images.some(img => img.status === "processing") && (
                      <div className="flex items-center justify-center py-12">
                        <div className="flex flex-col items-center gap-3">
                          <Loader2 className="animate-spin text-blue-600" size={32} />
                          <p className="text-sm text-slate-500 animate-pulse">Đang trích xuất văn bản...</p>
                        </div>
                      </div>
                    )}
                    {images.length > 0 && !images.some(img => img.extractedText) && !isProcessing && (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400 py-20">
                        <p>Nhấn nút xử lý để trích xuất văn bản.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E2E8F0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #CBD5E1;
        }
      `}</style>
    </div>
  );
}

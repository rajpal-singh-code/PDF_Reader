import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Document, Page, pdfjs } from "react-pdf";
import { Trash2, FileText, Upload, Send, ChevronLeft, ChevronRight } from "lucide-react";

// PDF Worker Setup
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function App() {
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [typingText, setTypingText] = useState("");

  const BACKEND_URL = "http://127.0.0.1:8000";
  const chatEndRef = useRef(null);

  // Load saved files from LocalStorage
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("pdfFiles"));
    if (saved?.length > 0) {
      setFiles(saved);
      setActiveFile(saved[0]);
    }
  }, []);

  // Save files to LocalStorage
  useEffect(() => {
    localStorage.setItem("pdfFiles", JSON.stringify(files));
  }, [files]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingText]);

  const handleUpload = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

    try {
      setLoading(true);
      const res = await axios.post(`${BACKEND_URL}/upload`, formData);
      const newFile = { 
        name: res.data.filename || file.name, 
        url: res.data.url || URL.createObjectURL(file) 
      };
      setFiles((prev) => [...prev, newFile]);
      setActiveFile(newFile);
      setPageNumber(1);
    } catch (err) {
      alert("Upload failed. Please check your backend connection.");
    } finally {
      setLoading(false);
    }
  };

  const removeFile = (index) => {
    const updated = files.filter((_, i) => i !== index);
    setFiles(updated);
    if (activeFile === files[index]) {
      setActiveFile(updated[0] || null);
      setPageNumber(1);
    }
  };

  const handleAsk = async () => {
    if (!query.trim() || !activeFile) return;

    const userMessage = { role: "user", text: query };
    setMessages((prev) => [...prev, userMessage]);
    const currentQuery = query;
    setQuery("");
    setLoading(true);

    try {
      const res = await axios.get(`${BACKEND_URL}/chat`, { params: { query: currentQuery } });
      typeText(res.data.answer, res.data.sources);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "bot", text: "Sorry, I couldn't process that request. ❌" }]);
    } finally {
      setLoading(false);
    }
  };

  const typeText = (text, sources) => {
    let i = 0;
    setTypingText("");
    const interval = setInterval(() => {
      setTypingText((prev) => prev + text[i]);
      i++;
      if (i >= text.length) {
        clearInterval(interval);
        setMessages((prev) => [...prev, { role: "bot", text, sources }]);
        setTypingText("");
      }
    }, 10);
  };

  return (
    <div className="h-screen flex flex-col bg-[#cbd5e1] font-sans text-gray-800">
      
      {/* HEADER */}
      <header className="bg-[#b9cee3] p-4 shadow-sm shrink-0">
        <h1 className="text-2xl font-bold text-gray-700 text-center">PDF Question Assistant</h1>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col lg:flex-row p-4 gap-4 overflow-hidden">
        
        {/* COLUMN 1: PDF PREVIEW */}
        <div className="lg:flex-[2] bg-white rounded-xl shadow-lg flex flex-col overflow-hidden border border-gray-200">
          <div className="flex-1 overflow-auto bg-[#f8fafc] p-4 flex justify-center custom-scrollbar">
            {activeFile ? (
              <Document
                file={activeFile.url}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                loading={<div className="mt-10 animate-pulse text-gray-400">Loading PDF...</div>}
              >
                <Page 
                  pageNumber={pageNumber} 
                  width={window.innerWidth > 1024 ? 550 : 320} 
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                />
              </Document>
            ) : (
              <div className="flex flex-col items-center justify-center text-gray-400 h-full">
                <FileText size={64} strokeWidth={1} className="mb-4 opacity-20" />
                <p className="text-sm font-medium">Select or upload a PDF to preview</p>
              </div>
            )}
          </div>
          
          {activeFile && (
            <div className="p-3 border-t flex justify-between items-center bg-gray-50 shrink-0">
              <button 
                className="p-1 hover:bg-gray-200 rounded-full disabled:opacity-30 transition"
                onClick={() => setPageNumber(p => Math.max(1, p-1))} 
                disabled={pageNumber <= 1}
              >
                <ChevronLeft size={24} />
              </button>
              <span className="text-xs font-bold text-gray-500 uppercase">Page {pageNumber} of {numPages}</span>
              <button 
                className="p-1 hover:bg-gray-200 rounded-full disabled:opacity-30 transition"
                onClick={() => setPageNumber(p => Math.min(numPages, p+1))} 
                disabled={pageNumber >= numPages}
              >
                <ChevronRight size={24} />
              </button>
            </div>
          )}
        </div>

        {/* COLUMN 2: UPLOAD & HISTORY */}
        <div className="lg:w-80 flex flex-col gap-4 shrink-0">
          {/* Upload Area */}
          <div className="bg-white p-6 rounded-xl border-2 border-dashed border-blue-200 shadow-sm flex flex-col items-center justify-center transition hover:border-blue-400">
            <div className="bg-red-50 p-3 rounded-full mb-3 text-red-500">
              <FileText size={32} />
            </div>
            <p className="text-xs text-gray-500 mb-2 font-medium">Drag and Drop PDF Here or</p>
            <label className="text-blue-500 text-sm font-bold cursor-pointer hover:text-blue-700 underline decoration-2 underline-offset-4">
              [Browse Files]
              <input type="file" className="hidden" accept="application/pdf" onChange={(e) => handleUpload(e.target.files[0])} />
            </label>
            <button className="mt-4 bg-[#64748b] text-white px-5 py-2 rounded-lg text-xs font-bold hover:bg-[#475569] shadow-sm active:scale-95 transition">
              UPLOAD PDF
            </button>
          </div>

          {/* File History */}
          <div className="bg-white flex-1 rounded-xl shadow-sm p-4 overflow-hidden border border-gray-200 flex flex-col">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 border-b pb-1">File History</h3>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
              {files.map((file, idx) => (
                <div 
                  key={idx}
                  onClick={() => { setActiveFile(file); setPageNumber(1); }}
                  className={`group flex items-center justify-between p-3 rounded-lg border text-sm transition cursor-pointer ${
                    activeFile?.name === file.name ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <span className="truncate flex-1 font-medium">{file.name}</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeFile(idx); }} 
                    className="ml-2 text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {files.length === 0 && <p className="text-center text-gray-300 text-xs mt-4 italic">No files yet</p>}
            </div>
          </div>
        </div>

        {/* COLUMN 3: CHAT INTERFACE */}
        <div className="lg:w-96 bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-gray-50 shrink-0">
            <h2 className="font-bold text-gray-700">Ask Questions</h2>
          </div>
          
          {/* Scrollable Chat Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-white">
            <div className="text-[10px] text-gray-400 font-bold uppercase text-center tracking-tighter opacity-50 mb-2">Questions & Answers</div>
            
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user' 
                  ? 'bg-blue-500 text-white rounded-tr-none' 
                  : 'bg-[#eef2f6] text-gray-800 rounded-tl-none border border-gray-100'
                }`}>
                  <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                  {msg.sources && (
                    <div className="mt-2 pt-1 border-t border-gray-300 text-[10px] opacity-60">
                      Source: Page {msg.sources[0]?.page || 'N/A'}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {typingText && (
              <div className="flex justify-start">
                <div className="bg-[#eef2f6] text-gray-800 p-3 rounded-2xl rounded-tl-none text-sm shadow-sm border border-gray-100">
                  <div className="whitespace-pre-wrap">{typingText}</div>
                  <span className="inline-block w-1 h-4 bg-blue-400 ml-1 animate-pulse" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t bg-gray-50 shrink-0">
            <div className="relative">
              <textarea
                className="w-full p-3 pr-12 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none resize-none text-sm shadow-inner min-h-[80px]"
                placeholder="Type your question..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              />
              <button 
                onClick={handleAsk}
                disabled={loading || !activeFile || !query.trim()}
                className="absolute right-2 bottom-3 p-2 text-blue-500 hover:text-blue-700 disabled:text-gray-300 transition"
              >
                <Send size={20} />
              </button>
            </div>
            <button 
              onClick={handleAsk}
              className="w-full mt-2 bg-[#475569] text-white py-2 rounded-lg font-bold text-xs uppercase hover:bg-[#334155] shadow transition disabled:opacity-50"
              disabled={loading || !activeFile}
            >
              {loading ? "Thinking..." : "Submit Question"}
            </button>
          </div>
        </div>
      </main>

      {/* Global CSS for Custom Scrollbar */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}
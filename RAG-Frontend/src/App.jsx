import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { Document, Page, pdfjs } from "react-pdf";
import {
  Send, ChevronLeft, ChevronRight,
  FileText, Upload, MessageSquare, X, Loader2,
  ZoomIn, ZoomOut, RotateCw, BookOpen, Sparkles,
} from "lucide-react";

// ✅ FIX: Use unpkg which always has every exact version, avoiding CDN mismatches
// unpkg serves the exact installed package version so the worker always matches
// Worker: see options below — choose ONE based on your setup
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

// ─── Toast ────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-2xl
            ${t.type === "error"   ? "bg-red-950 border border-red-500/60 text-red-300" :
              t.type === "success" ? "bg-emerald-950 border border-emerald-500/60 text-emerald-300" :
                                     "bg-slate-800 border border-slate-600/60 text-slate-200"}`}
          style={{ animation: "slideIn .25s ease" }}
        >
          <span className="font-bold text-base leading-none">
            {t.type === "error" ? "✕" : t.type === "success" ? "✓" : "ℹ"}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Source normalizer ────────────────────────────────────────────
// Backend may return sources as numbers, strings, or {text, page} objects.
// Rendering an object directly as a React child causes the "Objects are not
// valid as a React child" crash — always convert to a string first.
function toSourceLabel(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return String(s);
  if (typeof s === "string") return s;
  if (typeof s === "object") {
    if (s.page !== undefined) return String(s.page);
    if (s.text !== undefined) return String(s.text).slice(0, 40);
  }
  return null;
}

// ─── Chat Bubble ──────────────────────────────────────────────────
function ChatBubble({ msg }) {
  const isUser = msg.role === "user";

  // Normalize every source entry to a safe string — prevents React crash
  const safeSources = (msg.sources || [])
    .map(toSourceLabel)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  return (
    <div className={`flex items-end gap-2 w-full ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-500 flex items-center justify-center flex-shrink-0 shadow-md self-start mt-0.5">
          <Sparkles size={11} className="text-white" />
        </div>
      )}
      {/* min-w-0 stops flex child from overflowing its container on long text */}
      <div
        className={`min-w-0 max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed
          ${isUser
            ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-br-sm shadow-lg"
            : "bg-slate-800 border border-slate-700/60 text-slate-200 rounded-bl-sm"}`}
      >
        {/* whitespace-pre-wrap preserves newlines in AI responses;
            overflowWrap:anywhere breaks any word/URL that would overflow */}
        <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: "anywhere" }}>
          {msg.text}
        </p>
        {safeSources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-slate-400 flex-shrink-0">Sources:</span>
            {safeSources.map((label, i) => (
              <span key={i} className="text-xs bg-violet-900/50 text-violet-300 px-2 py-0.5 rounded-full border border-violet-700/40 flex-shrink-0">
                p.{label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3.5 py-2 rounded-xl text-xs text-violet-300 bg-violet-950/60 border border-violet-800/50 hover:bg-violet-900/60 hover:border-violet-600 transition-all duration-150 font-medium"
    >
      {label}
    </button>
  );
}

function ToolBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:border-violet-500 hover:text-violet-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
    >
      {children}
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [files, setFiles]           = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [numPages, setNumPages]     = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale]           = useState(1.0);
  const [query, setQuery]           = useState("");
  const [messages, setMessages]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [typingText, setTypingText] = useState("");
  const [toasts, setToasts]         = useState([]);
  const [dragOver, setDragOver]     = useState(false);
  const [chatOpen, setChatOpen]     = useState(false);
  const [pdfError, setPdfError]     = useState(false);

  const chatEndRef   = useRef(null);
  const fileInputRef = useRef(null);
  const typingRef    = useRef(null);

  const showToast = useCallback((message, type = "info") => {
    const id = Date.now();
    setToasts((p) => [...p, { id, message, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pdfFiles") || "[]");
      const valid = saved.filter((f) => f.url && !f.url.startsWith("blob:"));
      if (valid.length) { setFiles(valid); setActiveFile(valid[0]); }
    } catch {}
  }, []);

  useEffect(() => {
    const saveable = files.filter((f) => !f.url?.startsWith("blob:"));
    localStorage.setItem("pdfFiles", JSON.stringify(saveable));
  }, [files]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); },
    [messages, typingText]);

  const handleUpload = useCallback(async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") return showToast("Only PDF files are allowed", "error");
    if (file.size > 20 * 1024 * 1024)   return showToast("File must be under 20 MB", "error");

    const blobUrl = URL.createObjectURL(file);

    if (BACKEND_URL) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        setUploading(true);
        showToast("Uploading…", "info");
        const res = await axios.post(`${BACKEND_URL}/upload`, formData);
        if (!res.data?.url) throw new Error("Invalid response");
        URL.revokeObjectURL(blobUrl);
        const newFile = { name: res.data.filename || file.name, url: res.data.url };
        setFiles((p) => [...p, newFile]);
        setActiveFile(newFile);
        setPageNumber(1); setPdfError(false);
        showToast("PDF uploaded ✓", "success");
      } catch {
        const newFile = { name: file.name, url: blobUrl, isBlob: true };
        setFiles((p) => [...p, newFile]);
        setActiveFile(newFile);
        setPageNumber(1); setPdfError(false);
        showToast("Local preview (no backend)", "info");
      } finally { setUploading(false); }
    } else {
      const newFile = { name: file.name, url: blobUrl, isBlob: true };
      setFiles((p) => [...p, newFile]);
      setActiveFile(newFile);
      setPageNumber(1); setPdfError(false);
      showToast("PDF loaded ✓", "success");
    }
  }, [showToast]);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  const removeFile = (index) => {
    const f = files[index];
    if (f?.isBlob && f.url) URL.revokeObjectURL(f.url);
    const updated = files.filter((_, i) => i !== index);
    setFiles(updated);
    if (activeFile === f) { setActiveFile(updated[0] || null); setPageNumber(1); }
    showToast("File removed", "success");
  };

  const handleAsk = async () => {
    if (!activeFile) return showToast("Upload a PDF first", "error");
    if (!query.trim()) return showToast("Enter a question", "error");

    const userMsg = { role: "user", text: query };
    setMessages((p) => [...p, userMsg]);
    const currentQuery = query;
    setQuery(""); setLoading(true);

    try {
      const res = await axios.get(`${BACKEND_URL}/chat`, { params: { query: currentQuery } });
      typeText(res.data.answer, res.data.sources);
    } catch {
      typeText("Preview mode — connect a backend to enable AI answers with page citations.", []);
    } finally { setLoading(false); }
  };

  const typeText = (text, sources) => {
    if (typingRef.current) clearInterval(typingRef.current);
    // Chunk by words so long responses finish in ~2-3s regardless of length
    const words = text.split(" ");
    let i = 0;
    setTypingText("");
    typingRef.current = setInterval(() => {
      i += 3; // advance 3 words per tick for snappy feel
      setTypingText(words.slice(0, i).join(" "));
      if (i >= words.length) {
        clearInterval(typingRef.current);
        setMessages((p) => [...p, { role: "bot", text, sources }]);
        setTypingText("");
      }
    }, 30);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); }
  };

  return (
    <div className="flex flex-col h-svh bg-slate-950 text-slate-100 overflow-hidden">
      {/* Inject minimal keyframes Tailwind can't do */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500&display=swap');
        * { font-family: 'DM Sans', sans-serif; }
        .font-display { font-family: 'Syne', sans-serif !important; }
        @keyframes slideIn  { from { transform:translateX(40px); opacity:0 } to { transform:none; opacity:1 } }
        @keyframes spinAnim { to   { transform:rotate(360deg) } }
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0} }
        .anim-spin   { animation: spinAnim .8s linear infinite; }
        .anim-blink::after { content:''; display:inline-block; width:2px; height:13px; background:#a78bfa; margin-left:2px; vertical-align:middle; animation: blink .7s infinite; }
        .pdf-wrap canvas { display:block !important; border-radius:6px; }
        ::-webkit-scrollbar       { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#334155; border-radius:10px; }
      `}</style>

      <Toast toasts={toasts} />

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 md:px-6 h-14 bg-slate-900 border-b border-slate-800 flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg">
            <BookOpen size={15} className="text-white" />
          </div>
          <div>
            <h1 className="font-display text-[15px] font-extrabold tracking-tight text-white leading-none">DocuMind</h1>
            <p className="text-[10px] text-slate-500 hidden sm:block mt-0.5">AI PDF Intelligence</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeFile && (
            <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-full text-[11px] text-violet-300 max-w-[180px]">
              <FileText size={10} />
              <span className="truncate">{activeFile.name}</span>
            </span>
          )}
          <button
            onClick={() => setChatOpen((p) => !p)}
            className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:border-violet-500 hover:text-violet-400 transition-all"
          >
            <MessageSquare size={15} />
          </button>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ══ Left: Library — horizontal strip on mobile, sidebar on desktop ══ */}
        <aside className="flex-shrink-0 bg-slate-900 border-slate-800
          flex flex-row items-center gap-2 overflow-x-auto overflow-y-hidden
          w-full h-auto border-b px-3 py-2
          lg:flex-col lg:items-stretch lg:w-52 lg:h-auto
          lg:overflow-x-hidden lg:overflow-y-auto
          lg:border-b-0 lg:border-r lg:px-3 lg:py-4 lg:gap-3">

          <p className="hidden lg:block font-display text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
            Library
          </p>

          {/* Drop zone */}
          <div
            className={`flex-shrink-0 flex flex-row lg:flex-col items-center justify-center gap-2
              px-4 py-2.5 lg:py-5 rounded-xl border-2 border-dashed cursor-pointer
              transition-all duration-200 min-w-[140px] lg:min-w-0
              ${dragOver
                ? "border-violet-500 bg-violet-950/30 text-violet-400"
                : "border-slate-700 text-slate-500 hover:border-violet-600 hover:text-violet-400 hover:bg-violet-950/20"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
              onChange={(e) => handleUpload(e.target.files[0])} />
            {uploading
              ? <Loader2 size={18} className="anim-spin" />
              : <Upload size={18} />}
            <span className="text-xs font-medium whitespace-nowrap">
              {uploading ? "Uploading…" : "Drop PDF or click"}
            </span>
          </div>

          {/* File list */}
          <div className="flex flex-row lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible flex-1">
            {files.length === 0 && (
              <p className="hidden lg:block text-xs text-slate-600 text-center py-4">No PDFs yet</p>
            )}
            {files.map((file, i) => (
              <div
                key={i}
                onClick={() => { setActiveFile(file); setPageNumber(1); setPdfError(false); }}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer
                  transition-all duration-150 flex-shrink-0 border
                  ${activeFile === file
                    ? "bg-slate-800 border-violet-600/70 text-white"
                    : "bg-transparent border-transparent hover:bg-slate-800/60 text-slate-400 hover:text-slate-200"}`}
              >
                <FileText size={13} className={activeFile === file ? "text-violet-400" : "text-slate-500"} />
                <span className="text-xs truncate max-w-[120px] lg:max-w-[110px]">{file.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  className="ml-auto flex-shrink-0 p-0.5 rounded text-slate-600 hover:text-red-400 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* ══ Center: PDF Viewer ════════════════════════════════ */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-950 min-w-0">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 px-4 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0 flex-wrap">
            <div className="flex items-center gap-1.5">
              <ToolBtn disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => Math.max(1, p - 1))}>
                <ChevronLeft size={15} />
              </ToolBtn>
              <span className="text-xs text-slate-400 px-2 tabular-nums whitespace-nowrap">
                {activeFile ? `${pageNumber} / ${numPages || "—"}` : "— / —"}
              </span>
              <ToolBtn disabled={!numPages || pageNumber >= numPages} onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}>
                <ChevronRight size={15} />
              </ToolBtn>
            </div>
            <div className="flex items-center gap-1.5">
              <ToolBtn onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(1)))}>
                <ZoomOut size={14} />
              </ToolBtn>
              <span className="text-xs text-slate-400 px-1 tabular-nums w-10 text-center">
                {Math.round(scale * 100)}%
              </span>
              <ToolBtn onClick={() => setScale((s) => Math.min(2.5, +(s + 0.2).toFixed(1)))}>
                <ZoomIn size={14} />
              </ToolBtn>
              <ToolBtn onClick={() => setScale(1.0)}>
                <RotateCw size={13} />
              </ToolBtn>
            </div>
          </div>

          {/* PDF canvas */}
          <div
            className="flex-1 overflow-auto flex justify-center items-start p-5"
            style={{ background: "repeating-linear-gradient(45deg,#0f172a 0,#0f172a 10px,#0c1120 10px,#0c1120 20px)" }}
          >
            {!activeFile ? (
              <div className="flex flex-col items-center justify-center gap-4 text-slate-600 m-auto text-center">
                <BookOpen size={48} className="opacity-20" />
                <p className="text-sm">Select or upload a PDF to preview</p>
                <p className="text-xs text-slate-700">Drag & drop a file in the sidebar</p>
              </div>
            ) : pdfError ? (
              <div className="flex flex-col items-center justify-center gap-3 text-red-500/60 m-auto text-center">
                <X size={44} className="opacity-50" />
                <p className="text-sm">Could not render PDF — try re-uploading</p>
              </div>
            ) : (
              <Document
                file={activeFile.url}
                className="pdf-wrap shadow-2xl"
                onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPdfError(false); }}
                onLoadError={(err) => { console.error(err); setPdfError(true); showToast("Failed to load PDF", "error"); }}
                loading={
                  <div className="flex flex-col items-center gap-3 text-slate-500 p-20">
                    <Loader2 size={28} className="anim-spin" />
                    <p className="text-sm">Loading PDF…</p>
                  </div>
                }
              >
                <Page
                  pageNumber={pageNumber}
                  scale={scale}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={
                    <div className="flex items-center justify-center p-20">
                      <Loader2 size={22} className="anim-spin text-slate-500" />
                    </div>
                  }
                />
              </Document>
            )}
          </div>
        </main>

        {/* ══ Right: Chat Panel ═════════════════════════════════ */}
        <aside
          className={`flex flex-col flex-shrink-0 bg-slate-900 border-l border-slate-800
            w-[min(340px,92vw)] lg:w-80
            fixed top-14 bottom-0 right-0 z-40
            transition-transform duration-300 ease-in-out
            ${chatOpen ? "translate-x-0" : "translate-x-full"}
            lg:relative lg:top-0 lg:z-auto lg:translate-x-0`}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <Sparkles size={13} className="text-violet-400" />
            <span className="font-display text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Ask AI
            </span>
            <button
              onClick={() => setChatOpen(false)}
              className="ml-auto lg:hidden text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-w-0">
            {messages.length === 0 && !typingText && (
              <div className="flex flex-col items-center gap-3 m-auto text-center px-3 py-6">
                <div className="w-12 h-12 rounded-2xl bg-violet-950/60 border border-violet-800/40 flex items-center justify-center">
                  <Sparkles size={20} className="text-violet-400 opacity-70" />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Ask anything about<br />your document
                </p>
                <div className="flex flex-col gap-1.5 w-full mt-1">
                  {["Summarize this PDF", "What are the key points?", "List all conclusions"].map((s) => (
                    <Chip key={s} label={s} onClick={() => setQuery(s)} />
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}

            {typingText && (
              <div className="flex items-end gap-2 w-full">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-500 flex items-center justify-center flex-shrink-0 self-start mt-0.5">
                  <Sparkles size={11} className="text-white" />
                </div>
                <div className="min-w-0 max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-slate-800 border border-slate-700/60 text-slate-200 text-sm leading-relaxed">
                  <p className="whitespace-pre-wrap anim-blink" style={{ overflowWrap: "anywhere" }}>{typingText}</p>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="flex gap-2 p-3 border-t border-slate-800 flex-shrink-0">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="Ask about your PDF… (↵ to send)"
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-xl px-3 py-2 resize-none outline-none placeholder-slate-600 focus:border-violet-500 transition-colors leading-relaxed"
            />
            <button
              onClick={handleAsk}
              disabled={loading}
              className="flex items-center justify-center self-end w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
            >
              {loading
                ? <Loader2 size={16} className="anim-spin" />
                : <Send size={16} />}
            </button>
          </div>
        </aside>

        {/* Overlay backdrop (mobile) */}
        {chatOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setChatOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
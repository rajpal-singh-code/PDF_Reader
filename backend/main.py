from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import uuid
import traceback
import logging
from dotenv import load_dotenv

# Import from rag.py
from rag import load_and_split_pdf, create_vector_store, ask_question

load_dotenv()

# ✅ Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)

# ✅ Get BASE URL from .env
BASE_URL = os.getenv("BASE_URL")

app = FastAPI(title="PDF RAG Backend")

# ✅ Upload folder
UPLOAD_DIR = os.path.abspath("uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

logger.info(f"Upload directory: {UPLOAD_DIR}")

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# ✅ CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://pdf-reader-gilt.vercel.app"
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

@app.get("/")
def home():
    logger.info("Home endpoint called")
    return {"message": "Welcome to the FastAPI RAG Backend!"}

VECTOR_DB = None


# 🚀 UPLOAD API
@app.post("/upload")
async def upload_pdf(request: Request, file: UploadFile = File(...)):
    logger.info("📥 Upload request received")

    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file uploaded")

        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

        # ✅ Read file ONLY ONCE
        file_bytes = await file.read()

        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        # ✅ File size check
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 10MB)")

        # ✅ Unique filename
        unique_filename = f"{uuid.uuid4()}_{file.filename}"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)

        logger.info(f"Saving file: {file_path}")

        # ✅ Save file
        with open(file_path, "wb") as f:
            f.write(file_bytes)

        logger.info(f"File saved successfully: {unique_filename}")
        logger.info(f"File size: {len(file_bytes)} bytes")

        # 🔍 STEP 1: Load & split
        logger.info("🔍 Splitting PDF into chunks...")
        chunks = load_and_split_pdf(file_path)

        if not chunks:
            raise Exception("No chunks created from PDF")

        logger.info(f"Chunks created: {len(chunks)}")

        # 🔍 STEP 2: Create vector DB
        logger.info("🧠 Creating vector store...")
        global VECTOR_DB
        VECTOR_DB = create_vector_store(chunks)

        if VECTOR_DB is None:
            raise Exception("VECTOR_DB creation failed")

        logger.info("✅ Vector store created successfully")

        # 🔗 URL
        if BASE_URL:
            file_url = f"{BASE_URL}/uploads/{unique_filename}"
        else:
            file_url = str(request.base_url) + f"uploads/{unique_filename}"
            file_url = file_url.replace("http://", "https://")

        logger.info(f"File URL: {file_url}")

        return {
            "message": "PDF uploaded and processed successfully!",
            "filename": unique_filename,
            "url": file_url,
            "chunks": len(chunks)
        }

    except HTTPException as he:
        logger.error(f"HTTP Error: {he.detail}")
        raise he

    except Exception as e:
        logger.error("❌ ERROR IN /upload")
        logger.error(str(e))
        logger.error(traceback.format_exc())

        raise HTTPException(
            status_code=500,
            detail=f"Upload failed: {str(e)}"
        )


# 🚀 CHAT API
@app.get("/chat")
def chat(query: str):
    logger.info(f"💬 Chat request: {query}")

    global VECTOR_DB

    try:
        if VECTOR_DB is None:
            logger.warning("VECTOR_DB is None")
            raise HTTPException(status_code=400, detail="Upload PDF first")

        logger.info("🔍 Running query on vector DB...")
        answer, docs = ask_question(VECTOR_DB, query)

        if not answer or answer.strip() == "":
            answer = "No answer found in document."

        logger.info("✅ Answer generated")

        sources = []
        for doc in docs:
            sources.append({
                "text": doc.page_content[:200] + "...",
                "page": doc.metadata.get("page", "N/A")
            })

        return {
            "answer": answer.strip(),
            "sources": sources
        }

    except HTTPException as he:
        logger.error(f"HTTP Error: {he.detail}")
        raise he

    except Exception as e:
        logger.error("❌ ERROR IN /chat")
        logger.error(str(e))
        logger.error(traceback.format_exc())

        return {
            "answer": f"Error: {str(e)}",
            "sources": []
        }
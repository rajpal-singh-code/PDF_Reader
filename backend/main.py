from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import uuid
from dotenv import load_dotenv

# Import from rag.py
from rag import load_and_split_pdf, create_vector_store, ask_question

load_dotenv()

# ✅ Get BASE URL from .env
BASE_URL = os.getenv("BASE_URL")

app = FastAPI(title="PDF RAG Backend")

# ✅ Ensure uploads folder exists BEFORE mounting
os.makedirs("uploads", exist_ok=True)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# ✅ CORS (update later with your frontend URL)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

@app.get("/")
def home():
    return {"message": "Welcome to the FastAPI RAG Backend!"}

VECTOR_DB = None


@app.post("/upload")
async def upload_pdf(request: Request, file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    # ✅ Unique filename using UUID
    unique_filename = f"{uuid.uuid4()}_{file.filename}"
    file_path = f"uploads/{unique_filename}"

    with open(file_path, "wb") as f:
        f.write(await file.read())

    try:
        chunks = load_and_split_pdf(file_path)

        global VECTOR_DB
        VECTOR_DB = create_vector_store(chunks)

        # ✅ Dynamic URL handling
        if BASE_URL:
            file_url = f"{BASE_URL}/{file_path}"
        else:
            file_url = str(request.base_url) + file_path

        return {
            "message": "PDF uploaded and processed successfully!",
            "filename": unique_filename,
            "url": file_url,
            "chunks": len(chunks)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/chat")
def chat(query: str):
    global VECTOR_DB

    if VECTOR_DB is None:
        raise HTTPException(status_code=400, detail="Upload PDF first")

    try:
        answer, docs = ask_question(VECTOR_DB, query)

        if not answer or answer.strip() == "":
            answer = "No answer found in document."

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

    except Exception as e:
        return {
            "answer": f"Error: {str(e)}",
            "sources": []
        }
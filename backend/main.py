from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

# Import from rag.py
from rag import load_and_split_pdf, create_vector_store, ask_question

load_dotenv()

app = FastAPI(title="PDF RAG Backend")

# ✅ ADD THIS HERE
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

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
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    os.makedirs("uploads", exist_ok=True)
    file_path = f"uploads/{file.filename}"

    with open(file_path, "wb") as f:
        f.write(await file.read())

    try:
        chunks = load_and_split_pdf(file_path)

        global VECTOR_DB
        VECTOR_DB = create_vector_store(chunks)

        return {
            "message": "PDF uploaded and processed successfully!",
            "filename": file.filename,
            "url": f"http://127.0.0.1:8000/{file_path}",  
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
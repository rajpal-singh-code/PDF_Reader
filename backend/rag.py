# from langchain_community.document_loaders import PyPDFLoader
# from langchain_text_splitters import RecursiveCharacterTextSplitter
# from langchain_community.vectorstores import FAISS
# from langchain_huggingface import HuggingFaceEmbeddings
# from groq import Groq
# import os
# from dotenv import load_dotenv

# load_dotenv()

# def load_and_split_pdf(file_path):
#     loader = PyPDFLoader(file_path)
#     documents = loader.load()

#     splitter = RecursiveCharacterTextSplitter(
#         chunk_size=500,
#         chunk_overlap=100
#     )
#     chunks = splitter.split_documents(documents)
#     return chunks


# def create_vector_store(chunks):
#     os.makedirs("models", exist_ok=True)

#     embeddings = HuggingFaceEmbeddings(
#         model_name="all-MiniLM-L6-v2",
#         cache_folder=os.path.abspath("models")
#     )

#     vector_store = FAISS.from_documents(chunks, embeddings)
#     return vector_store


# def ask_question(vectorstore, query):
#     retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
#     docs = retriever.invoke(query)

#     context = "\n\n".join([doc.page_content[:400] for doc in docs])

#     client = Groq(api_key=os.getenv("GROQ_API_KEY"))

#     prompt = f"""
#         Answer based on the context below.
#         If partially available, try to explain.

#         Context:
#         {context}

#         Question: {query}
#     """
    
#     try:
#         response = client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             messages=[
#                 {"role": "user", "content": prompt}
#             ]
#         )

#         answer = response.choices[0].message.content

#     except Exception as e:
#         answer = f"API Error: {str(e)}"

#     return answer, docs




from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
# from langchain_community.embeddings import HuggingFaceInferenceAPIEmbeddings
from langchain_huggingface import HuggingFaceEndpointEmbeddings
from groq import Groq
import os
from dotenv import load_dotenv

load_dotenv()


# 📄 Load & split PDF
def load_and_split_pdf(file_path):
    loader = PyPDFLoader(file_path)
    documents = loader.load()

    splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,   # 🔥 increase
    chunk_overlap=200  # 🔥 increase
)

    chunks = splitter.split_documents(documents)
    return chunks


# 🧠 Create vector DB (NO DOWNLOAD)
def create_vector_store(chunks):

    api_key = os.getenv("HUGGINGFACEHUB_API_TOKEN")

    if not api_key:
        raise Exception("HUGGINGFACE_API_KEY is missing ❌")

    embeddings = HuggingFaceEndpointEmbeddings(
        huggingfacehub_api_token=api_key,
        model="sentence-transformers/all-MiniLM-L6-v2"
    )

    vector_store = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings
    )

    return vector_store


# 💬 Ask question
def ask_question(vectorstore, query):

    retriever = vectorstore.as_retriever(
    search_type="similarity",
    search_kwargs={"k": 5}
)
    docs = retriever.invoke(query)

    # 🔍 Build context
    context = "\n\n".join([doc.page_content[:400] for doc in docs])

    client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    print("\n🔍 Retrieved Docs:\n")
    for d in docs:
        print(d.page_content[:200])
    print("------")
    prompt = f"""
Answer based ONLY on the context below.
If the answer is not fully available, say what is available.

Context:
{context}

Question: {query}
"""

    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        answer = response.choices[0].message.content

    except Exception as e:
        answer = f"API Error: {str(e)}"

    return answer, docs
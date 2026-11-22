"""
TASK 11: MAIN FASTAPI APPLICATION
UTM Tactical Deconfliction & AI Advisory Engine
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.api.tactical_routes import router as tactical_router
from backend.app.api.flight_plan_routes import router as flight_plan_router

app = FastAPI(
    title="Da Nang UTM Tactical Deconfliction Engine",
    description="Part 5 Tactical Conflict Detection, Trajectory Prediction, and AI Resolution Module",
    version="1.0.0"
)

# Enable CORS for React frontend (Vite port 3000 / 5173 / localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tactical_router)
app.include_router(flight_plan_router)

@app.get("/")
def read_root():
    return {
        "system": "Da Nang UTM Tactical Deconfliction & AI Advisory Service",
        "role": "Part 5 Engine (Tasks 11-13)",
        "docs_url": "/docs",
        "api_prefix": "/api/tactical"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)

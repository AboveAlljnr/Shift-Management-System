from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os

from routers import schedule


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🔧  Optimizer service starting up…")
    yield
    print("🛑  Optimizer service shutting down…")


app = FastAPI(
    title="ShiftMS Optimizer Service",
    description="Schedule optimization using Google OR-Tools CP-SAT solver",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — only the API backend should call this service
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3001").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

app.include_router(schedule.router, prefix="/api/v1/schedule", tags=["Schedule Optimization"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "optimizer"}

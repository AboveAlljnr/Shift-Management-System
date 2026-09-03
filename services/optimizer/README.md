# ShiftMS Optimizer Service

Python FastAPI microservice leveraging Google OR-Tools (CP-SAT Solver) for workforce shift scheduling and constraint optimization.

## Features
- Hard constraint satisfaction: employee availability, maximum/minimum weekly hours, non-overlapping shifts.
- Soft constraint optimization: maximize coverage, minimize understaffing.
- Fast execution with timeout guards.

## Running Locally

```bash
python -m venv .venv
source .venv/bin/activate # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from core.models import OptimizationRequest, OptimizationResponse
from core.solver import solve

router = APIRouter()


@router.post(
    "/optimize",
    response_model=OptimizationResponse,
    status_code=status.HTTP_200_OK,
    summary="Optimize shift schedule",
    description="Runs CP-SAT constraint optimization to generate optimal shift assignments.",
)
async def optimize_schedule(request: OptimizationRequest) -> OptimizationResponse:
    try:
        response = solve(request)
        return response
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Optimization failed: {str(e)}",
        )

from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional


class EmployeeAvailability(BaseModel):
    employee_id: str
    available_shift_ids: list[str]
    """List of shift IDs this employee is available for."""

    max_hours_per_week: float = Field(default=40.0, ge=0)
    min_hours_per_week: float = Field(default=0.0, ge=0)
    skills: list[str] = Field(default_factory=list)
    """Skill IDs (or codes) held by the employee (active skills only)."""

    certifications: list[str] = Field(default_factory=list)
    """Certification IDs (or codes) held and not expired within the window."""


class ShiftRequirement(BaseModel):
    shift_id: str
    start_time: str  # ISO datetime string
    end_time: str    # ISO datetime string
    required_count: int = Field(ge=1)
    position_id: Optional[str] = None
    department_id: Optional[str] = None
    required_skills: list[str] = Field(default_factory=list)
    required_certifications: list[str] = Field(default_factory=list)


class OptimizationRequest(BaseModel):
    tenant_id: str
    week_start: str  # ISO date (YYYY-MM-DD)
    shifts: list[ShiftRequirement]
    employees: list[EmployeeAvailability]
    max_solver_time_seconds: int = Field(default=30, ge=1, le=120)
    min_rest_hours: float = Field(default=0.0, ge=0)
    """Minimum rest (hours) required between any two shifts assigned to the same employee."""


class AssignmentResult(BaseModel):
    shift_id: str
    employee_id: str


class OptimizationResponse(BaseModel):
    status: str  # "optimal" | "feasible" | "infeasible" | "timeout"
    assignments: list[AssignmentResult]
    objective_value: Optional[float] = None
    solver_time_seconds: float
    unmet_shifts: list[str]
    """Shift IDs that could not be fully staffed."""

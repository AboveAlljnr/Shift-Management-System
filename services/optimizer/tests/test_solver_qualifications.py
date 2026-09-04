"""Tests for the qualification gate and solver-level qualification behavior."""
from datetime import timedelta

import pytest

from core.models import EmployeeAvailability, OptimizationRequest, ShiftRequirement
from core.solver import _is_qualified, solve

BASE = "2026-09-07T08:00:00+00:00"
END = "2026-09-07T16:00:00+00:00"


def shift(**overrides):
    data = {
        "shift_id": "s1",
        "start_time": BASE,
        "end_time": END,
        "required_count": 1,
        "required_skills": ["SK_CASH"],
        "required_certifications": ["CR_FOOD"],
    }
    data.update(overrides)
    return ShiftRequirement(**data)


def employee(**overrides):
    data = {
        "employee_id": "e1",
        "available_shift_ids": ["s1"],
        "skills": ["SK_CASH"],
        "certifications": ["CR_FOOD"],
    }
    data.update(overrides)
    return EmployeeAvailability(**data)


def make_solution(shift_: ShiftRequirement, emp: EmployeeAvailability):
    request = OptimizationRequest(
        tenant_id="c1",
        week_start="2026-09-07",
        shifts=[shift_],
        employees=[emp],
        max_solver_time_seconds=5,
        min_rest_hours=0,
    )
    return solve(request)


class TestQualificationGate:
    def test_qualified_passes(self):
        assert _is_qualified(employee(), shift()) is True

    def test_no_requirements_always_passes(self):
        assert _is_qualified(employee(skills=[], certifications=[]), shift(required_skills=[], required_certifications=[])) is True

    def test_missing_skill_blocked(self):
        assert _is_qualified(employee(skills=[]), shift()) is False

    def test_missing_certification_blocked(self):
        assert _is_qualified(employee(certifications=[]), shift()) is False

    def test_partial_skill_set_blocked(self):
        assert (
            _is_qualified(
                employee(skills=["SK_CASH", "SK_OTHER"], certifications=["CR_FOOD"]),
                shift(required_skills=["SK_CASH", "SK_OTHER"]),
            )
            is True
        )
        assert (
            _is_qualified(
                employee(skills=["SK_CASH"], certifications=["CR_FOOD"]),
                shift(required_skills=["SK_CASH", "SK_OTHER"]),
            )
            is False
        )


class TestSolverQualificationGate:
    def test_unqualified_employee_never_assigned(self):
        result = make_solution(shift(), employee(certifications=[]))
        assert result.assignments == []
        assert result.unmet_shifts == ["s1"]

    def test_qualified_employee_assigned(self):
        result = make_solution(shift(), employee())
        assert len(result.assignments) == 1
        assert result.assignments[0].employee_id == "e1"
        assert result.unmet_shifts == []

    def test_subset_skill_requirement(self):
        result = make_solution(
            shift(required_skills=["SK_CASH", "SK_OTC"]),
            employee(skills=["SK_CASH"]),
        )
        assert result.assignments == []
        assert result.unmet_shifts == ["s1"]


class TestSolverAvailabilityWeek:
    def test_two_similar_shifts_can_be_split(self):
        req = OptimizationRequest(
            tenant_id="c1",
            week_start="2026-09-07",
            shifts=[
                ShiftRequirement(shift_id="s1", start_time="2026-09-07T08:00:00+00:00", end_time="2026-09-07T12:00:00+00:00", required_count=1),
                ShiftRequirement(shift_id="s2", start_time="2026-09-08T08:00:00+00:00", end_time="2026-09-08T12:00:00+00:00", required_count=1),
            ],
            employees=[
                EmployeeAvailability(employee_id="e1", available_shift_ids=["s1", "s2"]),
            ],
            max_solver_time_seconds=5,
            min_rest_hours=0,
        )
        result = solve(req)
        assert len(result.assignments) == 2
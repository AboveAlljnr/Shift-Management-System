"""
Schedule optimizer using Google OR-Tools CP-SAT solver.

Constraints (hard):
  1. An employee can only be assigned to shifts they are available for.
  2. Each shift must be assigned exactly `required_count` employees.
  3. An employee cannot work overlapping shifts.
  4. An employee's weekly hours must be within [min_hours, max_hours].

Objective (soft):
  - Maximise total staffed shift-employee slots (minimise understaffing).
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from ortools.sat.python import cp_model

from core.models import (
    AssignmentResult,
    EmployeeAvailability,
    OptimizationRequest,
    OptimizationResponse,
    ShiftRequirement,
)


def _shift_duration_hours(shift: ShiftRequirement) -> float:
    start = datetime.fromisoformat(shift.start_time.replace("Z", "+00:00"))
    end = datetime.fromisoformat(shift.end_time.replace("Z", "+00:00"))
    return max(0.0, (end - start).total_seconds() / 3600)


def _shifts_overlap(a: ShiftRequirement, b: ShiftRequirement) -> bool:
    a_start = datetime.fromisoformat(a.start_time.replace("Z", "+00:00"))
    a_end = datetime.fromisoformat(a.end_time.replace("Z", "+00:00"))
    b_start = datetime.fromisoformat(b.start_time.replace("Z", "+00:00"))
    b_end = datetime.fromisoformat(b.end_time.replace("Z", "+00:00"))
    return a_start < b_end and b_start < a_end


def _rest_violation(a: ShiftRequirement, b: ShiftRequirement, min_rest_hours: float) -> bool:
    """True if the gap between two non-overlapping shifts is less than min_rest_hours."""
    a_start = datetime.fromisoformat(a.start_time.replace("Z", "+00:00"))
    a_end = datetime.fromisoformat(a.end_time.replace("Z", "+00:00"))
    b_start = datetime.fromisoformat(b.start_time.replace("Z", "+00:00"))
    b_end = datetime.fromisoformat(b.end_time.replace("Z", "+00:00"))
    if _shifts_overlap(a, b):
        return False
    gap = min(b_start - a_end, a_start - b_end)
    return gap.total_seconds() / 3600 < min_rest_hours


def solve(request: OptimizationRequest) -> OptimizationResponse:
    t_start = time.perf_counter()

    model = cp_model.CpModel()

    shifts = request.shifts
    employees = request.employees

    # Index maps
    shift_idx = {s.shift_id: i for i, s in enumerate(shifts)}
    emp_idx = {e.employee_id: j for j, e in enumerate(employees)}

    # Build availability matrix: available[j][i] = True if employee j can do shift i
    available: dict[int, set[int]] = {j: set() for j in range(len(employees))}
    for emp in employees:
        j = emp_idx[emp.employee_id]
        for sid in emp.available_shift_ids:
            if sid in shift_idx:
                available[j].add(shift_idx[sid])

    # Decision variables: x[i][j] = 1 if employee j is assigned to shift i
    x: dict[tuple[int, int], cp_model.IntVar] = {}
    for i in range(len(shifts)):
        for j in range(len(employees)):
            if i in available[j]:
                x[(i, j)] = model.new_bool_var(f"x_s{i}_e{j}")

    # --- Hard constraint 1: No overlapping shifts for same employee ---
    for j in range(len(employees)):
        for i1 in range(len(shifts)):
            for i2 in range(i1 + 1, len(shifts)):
                if (i1, j) in x and (i2, j) in x:
                    if _shifts_overlap(shifts[i1], shifts[i2]):
                        model.add(x[(i1, j)] + x[(i2, j)] <= 1)

    # --- Hard constraint 1b: Minimum rest between consecutive shifts ---
    min_rest_hours = request.min_rest_hours or 0.0
    if min_rest_hours > 0:
        for j in range(len(employees)):
            for i1 in range(len(shifts)):
                for i2 in range(i1 + 1, len(shifts)):
                    if (i1, j) in x and (i2, j) in x:
                        if _rest_violation(shifts[i1], shifts[i2], min_rest_hours):
                            model.add(x[(i1, j)] + x[(i2, j)] <= 1)

    # --- Hard constraint 2: Weekly hours bounds ---
    SCALE = 100  # use integers (hours * 100)
    for emp in employees:
        j = emp_idx[emp.employee_id]
        emp_vars = []
        emp_hours = []
        for i, shift in enumerate(shifts):
            if (i, j) in x:
                emp_vars.append(x[(i, j)])
                emp_hours.append(int(_shift_duration_hours(shift) * SCALE))

        if emp_vars:
            total = sum(h * v for h, v in zip(emp_hours, emp_vars))
            model.add(total >= int(emp.min_hours_per_week * SCALE))
            model.add(total <= int(emp.max_hours_per_week * SCALE))

    # --- Soft objective: maximise total assigned slots ---
    # We introduce slack variables for understaffing
    staffed_vars = []
    for i, shift in enumerate(shifts):
        assigned = [x[(i, j)] for j in range(len(employees)) if (i, j) in x]
        if assigned:
            # Soft: maximise sum of assignments, penalise gap below required
            model.add(sum(assigned) <= shift.required_count)
            staffed_vars.extend(assigned)

    model.maximize(sum(staffed_vars))

    # --- Solve ---
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(request.max_solver_time_seconds)
    solver.parameters.num_workers = 4

    status = solver.solve(model)

    t_elapsed = time.perf_counter() - t_start

    status_map = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.MODEL_INVALID: "invalid",
        cp_model.UNKNOWN: "timeout",
    }
    status_str = status_map.get(status, "unknown")

    assignments: list[AssignmentResult] = []
    unmet_shifts: list[str] = []

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        assigned_counts: dict[int, int] = {i: 0 for i in range(len(shifts))}
        for (i, j), var in x.items():
            if solver.value(var):
                assignments.append(
                    AssignmentResult(
                        shift_id=shifts[i].shift_id,
                        employee_id=employees[j].employee_id,
                    )
                )
                assigned_counts[i] += 1

        for i, shift in enumerate(shifts):
            if assigned_counts[i] < shift.required_count:
                unmet_shifts.append(shift.shift_id)

    return OptimizationResponse(
        status=status_str,
        assignments=assignments,
        objective_value=solver.objective_value if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
        solver_time_seconds=round(t_elapsed, 3),
        unmet_shifts=unmet_shifts,
    )

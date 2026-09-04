import type {
  AttendanceRecord,
  Branch,
  Department,
  Employee,
  EmploymentType,
  LeaveRequest,
  LeaveType,
  Shift,
  ShiftAssignment,
  ShiftConflictOverride,
  Team,
} from '@sms/shared';

import { apiClient } from '@/lib/api/client';

async function getData<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await apiClient.get<{ data: T; message: string }>(url, { params });
  return data.data;
}

async function postData<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await apiClient.post<{ data: T; message: string }>(url, body);
  return data.data;
}

async function patchData<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await apiClient.patch<{ data: T; message: string }>(url, body);
  return data.data;
}

async function putData<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await apiClient.put<{ data: T; message: string }>(url, body);
  return data.data;
}

// ---- Response types (relations as returned by the API) ----

export interface EmployeeDetail extends Employee {
  branch?: Branch | null;
  department?: Department | null;
  team?: Team | null;
  employmentType?: { id: string; name: string; code: string; isActive: boolean } | null;
  primaryPosition?: { id: string; name: string; code: string } | null;
  manager?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'email'> | null;
}

export interface PaginatedEmployees {
  data: EmployeeDetail[];
  pagination: { page: number; limit: number; total: number };
}

export interface ShiftAssignmentDetail extends ShiftAssignment {
  employee: EmployeeDetail;
}

export interface ShiftDetail extends Shift {
  branch?: Branch | null;
  department?: Department | null;
  team?: Team | null;
  assignments: ShiftAssignmentDetail[];
  requirements: { id: string; headcount: number }[];
  conflictOverrides: ShiftConflictOverride[];
}

export interface AttendanceRecordDetail extends AttendanceRecord {
  employee: EmployeeDetail;
  events: { id: string; eventType: string; clientOccurredAt: string; source: string }[];
  breaks: { id: string; startAt: string; endAt: string | null; durationMinutes: number | null }[];
  corrections: { id: string; field: string; newValue: string | null; reason: string }[];
}

export interface LeaveRequestDetail extends LeaveRequest {
  leaveType: LeaveType;
  employee: EmployeeDetail;
  reviewedBy?: { id: string; name: string; email: string } | null;
}

export interface LeaveBalance {
  id: string;
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays: number;
  usedDays: number;
  remainingDays: number;
  leaveType: LeaveType;
}

// ---- Auth / company ----

export interface CompanyCurrent {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: string;
}

export function fetchCompany(): Promise<CompanyCurrent> {
  return getData<CompanyCurrent>('/companies/current');
}

// ---- Employees ----

export function fetchEmployees(params?: Record<string, unknown>): Promise<PaginatedEmployees> {
  return getData<PaginatedEmployees>('/employees', params);
}

export function fetchMyEmployee(): Promise<EmployeeDetail | null> {
  return getData<PaginatedEmployees>('/employees', { limit: 100 }).then((res) => {
    const user = getUserId();
    if (!user) return null;
    return res.data.find((e) => e.userId === user) ?? null;
  });
}

export function createEmployee(
  body: Partial<Employee> & {
    employeeNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    employmentTypeId: string;
    hireDate: string;
  },
): Promise<EmployeeDetail> {
  return postData<EmployeeDetail>('/employees', body);
}

export function deactivateEmployee(id: string): Promise<EmployeeDetail> {
  return apiClient.delete<{ data: EmployeeDetail; message: string }>(`/employees/${id}`).then((r) => r.data.data);
}

function getUserId(): string | null {
  return getTokenPayload()?.sub ?? null;
}

function getTokenPayload(): { sub?: string } | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('accessToken');
  if (!token) return null;
  try {
    const base64 = token.split('.')[1] as string;
    const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized)) as { sub?: string };
  } catch {
    return null;
  }
}

// ---- Scheduling ----

export function fetchShifts(params?: {
  branchId?: string;
  departmentId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}): Promise<ShiftDetail[]> {
  return getData<ShiftDetail[]>('/shifts', params);
}

export function fetchMyShifts(employeeId: string, params?: { startDate?: string; endDate?: string }): Promise<ShiftDetail[]> {
  return fetchShifts(params).then((shifts) =>
    shifts.filter(
      (s) => s.status !== 'cancelled' && s.assignments.some((a) => a.employeeId === employeeId),
    ),
  );
}

export function createShift(body: {
  branchId: string;
  departmentId?: string;
  name: string;
  startAt: string;
  endAt: string;
  isOvernight?: boolean;
  notes?: string;
}): Promise<ShiftDetail> {
  return postData<ShiftDetail>('/shifts', body);
}

export function assignEmployeeToShift(
  shiftId: string,
  body: { employeeId: string; notes?: string },
): Promise<{ id: string; shift: ShiftDetail; employee: EmployeeDetail }> {
  return postData<{ id: string; shift: ShiftDetail; employee: EmployeeDetail }>(
    `/shifts/${shiftId}/assign`,
    body,
  );
}

export function validateAssignment(shiftId: string, employeeId: string): Promise<{
  isValid: boolean;
  conflicts: { type: string; severity: string; ruleIdentifier: string; message: string; overrideAllowed: boolean }[];
  warnings: { type: string; severity: string; ruleIdentifier: string; message: string; overrideAllowed: boolean }[];
}> {
  return postData(`/shifts/${shiftId}/validate-assignment`, { employeeId });
}

// ---- Schedule optimization (Generate Suggested Schedule) ----

export interface SuggestConflict {
  type: string;
  severity: 'WARNING' | 'BLOCKING';
  ruleIdentifier: string;
  message: string;
  overrideAllowed: boolean;
}

export interface SuggestedAssignment {
  shiftId: string;
  employeeId: string;
  blocking: SuggestConflict[];
  warnings: SuggestConflict[];
}

export interface ScheduleSuggestion {
  status: string;
  shiftsConsidered: number;
  suggestedCount: number;
  unfilledShifts: string[];
  droppedBlocking: number;
  solverTimeSeconds: number;
  objectiveValue?: number;
  assignments: SuggestedAssignment[];
}

export interface OptimizeCriteria {
  branchId: string;
  departmentId?: string;
  teamId?: string;
  startDate: string;
  endDate: string;
}

export interface ApplySuggestionsResult {
  accepted: SuggestedAssignment[];
  skipped: { shiftId: string; employeeId: string; reason: string }[];
  rejected: { shiftId: string; employeeId: string; conflicts: SuggestConflict[] }[];
}

export function generateScheduleSuggestions(criteria: OptimizeCriteria): Promise<ScheduleSuggestion> {
  return postData<ScheduleSuggestion>('/shifts/optimize', {
    ...criteria,
    startDate: new Date(criteria.startDate).toISOString(),
    endDate: new Date(criteria.endDate).toISOString(),
  });
}

export function applyScheduleSuggestions(
  criteria: OptimizeCriteria,
  assignments: { shiftId: string; employeeId: string }[],
): Promise<ApplySuggestionsResult> {
  return postData<ApplySuggestionsResult>('/shifts/optimize/apply', {
    branchId: criteria.branchId,
    startDate: new Date(criteria.startDate).toISOString(),
    endDate: new Date(criteria.endDate).toISOString(),
    assignments,
  });
}

// ---- Attendance ----

export interface ClockEventPayload {
  eventType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  clientOccurredAt: string;
  source: 'mobile' | 'web' | 'device' | 'offline_sync';
  idempotencyKey: string;
  latitude?: number;
  longitude?: number;
}

export function recordClockEvent(
  payload: Omit<ClockEventPayload, 'source'>,
): Promise<{
  status: string;
  eventId: string;
  recordId?: string;
}> {
  return postData('/attendance/events', { ...payload, source: 'web' });
}

export interface MyGeofenceStatus {
  applicable: boolean;
  branchId?: string;
  branchName?: string;
  radiusMeters?: number;
}

export function fetchMyGeofenceStatus(): Promise<MyGeofenceStatus> {
  return getData<MyGeofenceStatus>('/attendance/me/geofence');
}

export function fetchDailyAttendance(date: string): Promise<AttendanceRecordDetail[]> {
  return getData<AttendanceRecordDetail[]>('/attendance/daily', { date });
}

export function fetchEmployeeAttendance(
  employeeId: string,
  params?: { startDate?: string; endDate?: string },
): Promise<AttendanceRecordDetail[]> {
  return getData<AttendanceRecordDetail[]>(`/attendance/employee/${employeeId}`, params);
}

// ---- Leave ----

export function fetchLeaveTypes(): Promise<LeaveType[]> {
  return getData<LeaveType[]>('/leave/types');
}

export function fetchLeaveRequests(params?: {
  employeeId?: string;
  status?: string;
  startDate?: string;
}): Promise<LeaveRequestDetail[]> {
  return getData<LeaveRequestDetail[]>('/leave/requests', params);
}

export function createLeaveRequest(body: {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  requestedDays: number;
  reason?: string;
}): Promise<LeaveRequestDetail> {
  return postData<LeaveRequestDetail>('/leave/requests', body);
}

export function reviewLeaveRequest(id: string, body: { action: 'approve' | 'reject'; note?: string }) {
  return postData<LeaveRequestDetail>(`/leave/requests/${id}/review`, body);
}

export function fetchLeaveBalances(employeeId: string): Promise<LeaveBalance[]> {
  return getData<LeaveBalance[]>(`/leave/balances/${employeeId}`);
}

// ---- Organization ----

export interface EmploymentTypeItem extends EmploymentType {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

export function fetchBranches(): Promise<Branch[]> {
  return getData<Branch[]>('/organization/branches');
}

export function fetchDepartments(): Promise<Department[]> {
  return getData<Department[]>('/organization/departments');
}

export function fetchTeams(): Promise<Team[]> {
  return getData<Team[]>('/organization/teams');
}

export function fetchPositions(): Promise<{ id: string; name: string; code: string; isActive: boolean }[]> {
  return getData<{ id: string; name: string; code: string; isActive: boolean }[]>('/organization/positions');
}

export function fetchEmploymentTypes(): Promise<EmploymentTypeItem[]> {
  return getData<EmploymentTypeItem[]>('/organization/employment-types');
}

export function createBranch(body: { name: string; code: string; timezone?: string }): Promise<Branch> {
  return postData<Branch>('/organization/branches', body);
}

export function createDepartment(body: { branchId: string; name: string; code: string }): Promise<Department> {
  return postData<Department>('/organization/departments', body);
}

export function createTeam(body: { departmentId: string; name: string; code: string }): Promise<Team> {
  return postData<Team>('/organization/teams', body);
}

export interface BranchGeofence {
  id: string;
  companyId: string;
  branchId: string | null;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}

export interface BranchGeofenceInput {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  name?: string;
  isActive?: boolean;
}

export function fetchBranchGeofence(branchId: string): Promise<BranchGeofence | null> {
  return getData<BranchGeofence | null>(`/organization/branches/${branchId}/geofence`);
}

export function configureBranchGeofence(
  branchId: string,
  body: BranchGeofenceInput,
): Promise<BranchGeofence> {
  return putData<BranchGeofence>(`/organization/branches/${branchId}/geofence`, body);
}

export { patchData as updateResource };
import type {
  AttendanceRecord,
  AvailabilityException,
  AvailabilityRule,
  Branch,
  Department,
  Employee,
  EmploymentType,
  GeofenceEnforcementConfig,
  LeaveRequest,
  LeaveType,
  PresenceVerificationConfig,
  PresenceVerificationStatus,
  Schedule,
  ScheduleVersion,
  Shift,
  ShiftAssignment,
  ShiftConflictOverride,
  Team,
} from '@sms/shared';

export type { Schedule, ScheduleVersion, AvailabilityRule, AvailabilityException } from '@sms/shared';

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
  requirements: {
    id: string;
    headcount: number;
    position?: { id: string; name: string; code: string } | null;
    skills?: { skill: { id: string; name: string } }[];
    certifications?: { certification: { id: string; name: string } }[];
  }[];
  conflictOverrides: ShiftConflictOverride[];
  coverage?: {
    shiftId: string;
    headcountRequired: number;
    headcountFilled: number;
    shortfall: number;
    covered: boolean;
    overstaffed: boolean;
  };
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
  scheduleId?: string;
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

// ---- Schedules (publish / versions) ----

export interface ScheduleDetail extends Schedule {
  branch?: Branch | null;
  _count: { shifts: number; versions: number };
}

export function fetchSchedules(params?: {
  branchId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ScheduleDetail[]> {
  return getData<ScheduleDetail[]>('/schedules', params);
}

export function createSchedule(body: {
  branchId?: string;
  name: string;
  periodStart: string;
  periodEnd: string;
}): Promise<ScheduleDetail> {
  return postData<ScheduleDetail>('/schedules', body);
}

export function publishSchedule(scheduleId: string, body?: { notes?: string }): Promise<{
  success: boolean;
  versionNumber: number;
  publishedAt: string;
}> {
  return postData(`/schedules/${scheduleId}/publish`, body ?? {});
}

export function fetchScheduleVersions(scheduleId: string): Promise<ScheduleVersion[]> {
  return getData<ScheduleVersion[]>(`/schedules/${scheduleId}/versions`);
}

// ---- Coverage ----

export interface ShiftCoverage {
  shiftId: string;
  headcountRequired: number;
  headcountFilled: number;
  shortfall: number;
  covered: boolean;
  overstaffed: boolean;
}

export function fetchCoverage(shiftIds: string[]): Promise<ShiftCoverage[]> {
  return getData<ShiftCoverage[]>('/schedules/coverage', { shiftIds: shiftIds.join(',') });
}

// ---- Availability ----

export interface AvailabilityRuleDetail extends AvailabilityRule {
  employee: { id: string; firstName: string; lastName: string; email: string };
}

export interface AvailabilityExceptionDetail extends AvailabilityException {
  employee: { id: string; firstName: string; lastName: string; email: string };
}

export function fetchAvailabilityRules(params?: { employeeId?: string }): Promise<AvailabilityRuleDetail[]> {
  return getData<AvailabilityRuleDetail[]>('/availability/rules', params);
}

export function createAvailabilityRule(body: {
  employeeId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable?: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
}): Promise<AvailabilityRuleDetail> {
  return postData<AvailabilityRuleDetail>('/availability/rules', body);
}

export function updateAvailabilityRule(
  id: string,
  body: Partial<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>,
): Promise<AvailabilityRuleDetail> {
  return patchData<AvailabilityRuleDetail>(`/availability/rules/${id}`, body);
}

export function deleteAvailabilityRule(id: string): Promise<{ success: boolean }> {
  return apiClient.delete<{ data: { success: boolean }; message: string }>(`/availability/rules/${id}`).then((r) => r.data.data);
}

export function fetchAvailabilityExceptions(params?: { employeeId?: string }): Promise<AvailabilityExceptionDetail[]> {
  return getData<AvailabilityExceptionDetail[]>('/availability/exceptions', params);
}

export function createAvailabilityException(body: {
  employeeId: string;
  date: string;
  isAvailable?: boolean;
  startTime?: string;
  endTime?: string;
  reason?: string;
}): Promise<AvailabilityExceptionDetail> {
  return postData<AvailabilityExceptionDetail>('/availability/exceptions', body);
}

export function updateAvailabilityException(
  id: string,
  body: Partial<{ date: string; isAvailable: boolean; startTime: string | null; endTime: string | null; reason: string | null }>,
): Promise<AvailabilityExceptionDetail> {
  return patchData<AvailabilityExceptionDetail>(`/availability/exceptions/${id}`, body);
}

export function deleteAvailabilityException(id: string): Promise<{ success: boolean }> {
  return apiClient.delete<{ data: { success: boolean }; message: string }>(`/availability/exceptions/${id}`).then((r) => r.data.data);
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
  mode?: 'strict' | 'warning' | 'off';
  branchId?: string;
  branchName?: string;
  radiusMeters?: number;
}

export function fetchMyGeofenceStatus(): Promise<MyGeofenceStatus> {
  return getData<MyGeofenceStatus>('/attendance/me/geofence');
}

export function fetchGeofenceConfig(): Promise<GeofenceEnforcementConfig> {
  return getData<GeofenceEnforcementConfig>('/attendance/geofence-config');
}

export function updateGeofenceConfig(
  dto: Partial<GeofenceEnforcementConfig>,
): Promise<GeofenceEnforcementConfig> {
  return patchData<GeofenceEnforcementConfig>('/attendance/geofence-config', dto);
}

// ---- Presence verification (post clock-in check) ----

export interface MyPresenceVerification {
  applicable: boolean;
  config: PresenceVerificationConfig;
  verification: {
    id: string;
    status: PresenceVerificationStatus;
    dueAt: string;
    verifiedAt: string | null;
    branchId: string | null;
    branchName: string | null;
    distanceMeters: number | null;
    geofenceRadiusMeters: number | null;
  } | null;
}

export interface PresenceVerificationListItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  branchId: string | null;
  branchName: string | null;
  dueAt: string;
  verifiedAt: string | null;
  status: PresenceVerificationStatus;
  distanceMeters: number | null;
  geofenceRadiusMeters: number | null;
}

export function fetchPresenceConfig(): Promise<PresenceVerificationConfig> {
  return getData<PresenceVerificationConfig>('/attendance/presence-config');
}

export function updatePresenceConfig(
  dto: Partial<PresenceVerificationConfig>,
): Promise<PresenceVerificationConfig> {
  return patchData<PresenceVerificationConfig>('/attendance/presence-config', dto);
}

export function fetchMyPresenceVerification(): Promise<MyPresenceVerification> {
  return getData<MyPresenceVerification>('/attendance/presence-verifications/mine');
}

export function verifyPresence(
  id: string,
  coordinates: { latitude: number; longitude: number },
): Promise<{ id: string; status: PresenceVerificationStatus; inside: boolean }> {
  return postData(`/attendance/presence-verifications/${id}/verify`, coordinates);
}

export function fetchPresenceVerifications(statuses?: PresenceVerificationStatus[]): Promise<PresenceVerificationListItem[]> {
  return getData<PresenceVerificationListItem[]>('/attendance/presence-verifications', {
    ...(statuses && statuses.length ? { status: statuses.join(',') } : {}),
  });
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
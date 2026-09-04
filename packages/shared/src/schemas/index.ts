import { z } from 'zod';

// ---- Auth schemas ----
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  companySlug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
});

export const RegisterCompanySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  companyName: z.string().min(1).max(100),
  companySlug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  timezone: z.string().default('UTC'),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// ---- Employee schemas ----
export const CreateEmployeeSchema = z.object({
  employeeNumber: z.string().min(1).max(50),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().optional(),
  employmentTypeId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  primaryPositionId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  hireDate: z.string().datetime(),
});

export const UpdateEmployeeSchema = CreateEmployeeSchema.partial();

// ---- Shift & Scheduling schemas ----
export const CreateShiftSchema = z.object({
  branchId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  isOvernight: z.boolean().default(false),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.string().optional(),
  notes: z.string().optional(),
  requirements: z
    .array(
      z.object({
        headcount: z.number().int().min(1).default(1),
        positionId: z.string().uuid().optional(),
        branchConstraint: z.string().optional(),
        skillIds: z.array(z.string().uuid()).optional(),
        certificationIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .optional(),
});

export const UpdateShiftSchema = CreateShiftSchema.partial();

export const AssignShiftSchema = z.object({
  employeeId: z.string().uuid(),
  notes: z.string().optional(),
});

export const ShiftConflictOverrideSchema = z.object({
  shiftId: z.string().uuid(),
  employeeId: z.string().uuid().optional(),
  ruleIdentifier: z.string().min(1),
  reason: z.string().min(3),
  metadata: z.record(z.unknown()).optional(),
});

export const PublishSchedulesSchema = z.object({
  scheduleId: z.string().uuid(),
  notes: z.string().optional(),
});

// ---- Attendance schemas ----
export const ClockEventSchema = z.object({
  eventType: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end', 'correction', 'manual_override']),
  clientOccurredAt: z.string().datetime(),
  source: z.enum(['mobile', 'web', 'device', 'offline_sync']).default('mobile'),
  deviceIdentifier: z.string().optional(),
  idempotencyKey: z.string().uuid(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const AttendanceCorrectionSchema = z.object({
  attendanceRecordId: z.string().uuid(),
  field: z.string().min(1),
  previousValue: z.string().nullable().optional(),
  newValue: z.string().nullable().optional(),
  reason: z.string().min(3),
});

export const BranchGeofenceSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().positive().max(50000),
  name: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});

// ---- Leave schemas ----
export const CreateLeaveRequestSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  requestedDays: z.number().positive(),
  reason: z.string().optional(),
});

export const ReviewLeaveSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().optional(),
});

// ---- Optimization schemas (ADR-006) ----
export const RequestOptimizationSchema = z.object({
  scheduleId: z.string().uuid().optional(),
  branchId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  employeeIds: z.array(z.string().uuid()).optional(),
  idempotencyKey: z.string().uuid(),
});

// ---- Schedule optimization (Generate Suggested Schedule) ----
export const OptimizeScheduleSchema = z.object({
  branchId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export const OptimizeApplySchema = z.object({
  branchId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  assignments: z
    .array(
      z.object({
        shiftId: z.string().uuid(),
        employeeId: z.string().uuid(),
      }),
    )
    .min(1),
});

// ---- Pagination schema ----
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ---- Inferred types ----
export type LoginDto = z.infer<typeof LoginSchema>;
export type RegisterCompanyDto = z.infer<typeof RegisterCompanySchema>;
export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;
export type CreateEmployeeDto = z.infer<typeof CreateEmployeeSchema>;
export type UpdateEmployeeDto = z.infer<typeof UpdateEmployeeSchema>;
export type CreateShiftDto = z.infer<typeof CreateShiftSchema>;
export type UpdateShiftDto = z.infer<typeof UpdateShiftSchema>;
export type AssignShiftDto = z.infer<typeof AssignShiftSchema>;
export type ShiftConflictOverrideDto = z.infer<typeof ShiftConflictOverrideSchema>;
export type PublishSchedulesDto = z.infer<typeof PublishSchedulesSchema>;
export type ClockEventDto = z.infer<typeof ClockEventSchema>;
export type AttendanceCorrectionDto = z.infer<typeof AttendanceCorrectionSchema>;
export type BranchGeofenceDto = z.infer<typeof BranchGeofenceSchema>;
export type CreateLeaveRequestDto = z.infer<typeof CreateLeaveRequestSchema>;
export type ReviewLeaveDto = z.infer<typeof ReviewLeaveSchema>;
export type RequestOptimizationDto = z.infer<typeof RequestOptimizationSchema>;
export type OptimizeScheduleDto = z.infer<typeof OptimizeScheduleSchema>;
export type OptimizeApplyDto = z.infer<typeof OptimizeApplySchema>;
export type PaginationQueryDto = z.infer<typeof PaginationQuerySchema>;

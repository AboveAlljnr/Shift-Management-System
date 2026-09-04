import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Contract payloads for the schedule-optimizer microservice (Python OR-Tools CP-SAT).
 * The optimizer is strictly a PROPOSER: it never writes to the database and returns
 * suggested assignments that the API revalidates against the authoritative conflict
 * engine before exposing them (see SchedulingService.generateSuggestions).
 */

export interface OptimizerShift {
  shift_id: string;
  start_time: string;
  end_time: string;
  required_count: number;
  position_id?: string;
  department_id?: string;
}

export interface OptimizerEmployee {
  employee_id: string;
  available_shift_ids: string[];
  max_hours_per_week?: number;
  min_hours_per_week?: number;
}

export interface OptimizeRequest {
  tenant_id: string;
  week_start: string;
  shifts: OptimizerShift[];
  employees: OptimizerEmployee[];
  max_solver_time_seconds: number;
  min_rest_hours?: number;
}

export interface OptimizeAssignment {
  shift_id: string;
  employee_id: string;
}

export interface OptimizeResponse {
  status: 'optimal' | 'feasible' | 'infeasible' | 'timeout';
  assignments: OptimizeAssignment[];
  objective_value?: number;
  solver_time_seconds: number;
  unmet_shifts: string[];
}

const UNSUPPORTED_STATUS: ReadonlySet<string> = new Set([
  'infeasible',
  'timeout',
]);
const DEFAULT_TIMEOUT_MS = 35_000;

@Injectable()
export class OptimizerClient {
  private readonly logger = new Logger(OptimizerClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('OPTIMIZER_URL') ?? 'http://localhost:8000').replace(/\/$/, '');
    const parsed = Number(config.get<string>('OPTIMIZER_TIMEOUT_MS'));
    this.timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  /**
   * Calls POST /api/v1/schedule/optimize using Node's built-in fetch with a strict
   * timeout. Throws ServiceUnavailableException when the optimizer cannot be reached,
   * is slow, or returns malformed/infeasible results so callers never act on garbage.
   */
  async optimize(req: OptimizeRequest): Promise<OptimizeResponse> {
    const url = `${this.baseUrl}/api/v1/schedule/optimize`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
          signal: controller.signal,
        });
      } catch (err) {
        const reason =
          err instanceof Error && err.name === 'AbortError'
            ? `optimizer timed out after ${this.timeoutMs}ms`
            : `optimizer unavailable at ${this.baseUrl}`;
        this.logger.warn(`${reason} (${(err as Error)?.message ?? 'network error'})`);
        throw new ServiceUnavailableException(
          `Schedule optimizer is unavailable. Please ensure the optimizer service is running and try again.`,
        );
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`optimizer returned HTTP ${res.status}: ${body}`);
        throw new ServiceUnavailableException(`Schedule optimizer failed with HTTP ${res.status}`);
      }

      const payload = (await res.json()) as OptimizeResponse;
      this.assertValid(payload);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertValid(payload: OptimizeResponse): void {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray(payload.assignments) ||
      !Array.isArray(payload.unmet_shifts)
    ) {
      this.logger.warn(`optimizer returned malformed payload: ${JSON.stringify(payload)}`);
      throw new ServiceUnavailableException('Schedule optimizer returned an unexpected response');
    }

    if (UNSUPPORTED_STATUS.has(payload.status)) {
      this.logger.warn(`optimizer returned status=${payload.status}`);
      throw new ServiceUnavailableException(
        `Schedule optimizer could not produce a schedule (${payload.status})`,
      );
    }
  }
}

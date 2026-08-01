export const READINESS_INDICATORS = Symbol('READINESS_INDICATORS');

export type ReadinessStatus = 'up' | 'down';

export interface ReadinessCheckResult {
  name: string;
  status: ReadinessStatus;
  message?: string;
}

export interface ReadinessIndicator {
  readonly name: string;
  check(): Promise<ReadinessCheckResult>;
}

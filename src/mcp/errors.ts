import type { RebuildError, ScheduleError } from '../core/index.js';

/**
 * Split out of tools.ts so samples.ts can return a ToolError without importing tools.ts, which
 * imports samples.ts (no circular imports inside a package, structure.md).
 */
export type ToolErrorCode =
  | ScheduleError['kind']
  | RebuildError['kind']
  | 'invalid_dinnerfile'
  | 'samples_unavailable'
  | 'not_found'
  | 'sample_unavailable'
  | 'internal';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details: Record<string, unknown>;
}

import type { VersoConfig, WorkType, State, DoctorCheck } from '../../types/index.js';

/**
 * Represents a single work item on the board.
 */
export interface BoardItem {
  id: number;
  title: string;
  type: WorkType;
  state: State;
  assignee: string;
  autonomy: number;
  branch: string;
  pr: string;
  created_at: string;
  updated_at: string;
  labels: string[];
  external: Record<string, unknown>;
}

/**
 * Contract that every board provider must implement.
 *
 * Each method maps to a CLI command:
 *   setup       -> `verso init`
 *   validate    -> `verso doctor`
 *   sync        -> `verso sync`
 *   getStatusInfo -> `verso status`
 */
export interface BoardIntegration {
  name: string;

  /** Called during `verso init` to scaffold provider-specific files. */
  setup(projectRoot: string, config: VersoConfig): Promise<void>;

  /** Called during `verso doctor` to verify provider health. */
  validate(projectRoot: string, config: VersoConfig): Promise<DoctorCheck[]>;

  /** Called during `verso sync` -- pushes local board to external, pulls external to local. */
  sync(projectRoot: string, board: BoardItem[]): Promise<BoardItem[]>;

  /** Called during `verso status` -- returns provider-specific status info. */
  getStatusInfo(config: VersoConfig): Record<string, string>;
}

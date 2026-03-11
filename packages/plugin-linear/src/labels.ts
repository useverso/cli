// Default mapping from VERSO states to Linear workflow state names
const DEFAULT_STATE_MAP: Record<string, string> = {
  captured: 'Backlog',
  refined: 'Backlog',
  queued: 'Todo',
  building: 'In Progress',
  verifying: 'In Review',
  pr_ready: 'Done',
  done: 'Done',
  cancelled: 'Cancelled',
  blocked: 'Backlog',
};

// States that require an additional label to distinguish from other states
// sharing the same Linear workflow state
const STATE_DISAMBIGUATION_LABELS: Record<string, string> = {
  refined: 'refined',
  pr_ready: 'pr-ready',
  blocked: 'blocked',
};

// Work type to Linear label mapping
const WORK_TYPE_LABELS: Record<string, string> = {
  feature: 'feature',
  bug: 'bug',
  hotfix: 'hotfix',
  refactor: 'refactor',
  chore: 'chore',
};

export interface LinearStateMapping {
  stateName: string;
  label?: string;
}

/**
 * Build the effective state map, merging defaults with user overrides.
 */
function resolveStateMap(configOverrides?: Record<string, string>): Record<string, string> {
  if (!configOverrides) return DEFAULT_STATE_MAP;
  return { ...DEFAULT_STATE_MAP, ...configOverrides };
}

/**
 * Map a VERSO state to a Linear workflow state name and optional disambiguation label.
 */
export function stateToLinear(
  state: string,
  configOverrides?: Record<string, string>,
): LinearStateMapping {
  const stateMap = resolveStateMap(configOverrides);
  const stateName = stateMap[state] || 'Backlog';
  const label = STATE_DISAMBIGUATION_LABELS[state];
  return { stateName, label };
}

/**
 * Map a Linear workflow state name (+ labels) back to a VERSO state.
 * Labels are used to disambiguate states that map to the same Linear workflow state.
 */
export function linearToState(
  linearStateName: string,
  labels: string[],
  configOverrides?: Record<string, string>,
): string {
  const stateMap = resolveStateMap(configOverrides);

  // Build reverse map: Linear state name -> VERSO state(s)
  const reverseMap = new Map<string, string[]>();
  for (const [versoState, linearName] of Object.entries(stateMap)) {
    const existing = reverseMap.get(linearName) || [];
    existing.push(versoState);
    reverseMap.set(linearName, existing);
  }

  const candidates = reverseMap.get(linearStateName);
  if (!candidates || candidates.length === 0) {
    return 'captured'; // fallback
  }

  // If there's only one candidate, return it
  if (candidates.length === 1) {
    return candidates[0];
  }

  // Multiple candidates — use labels to disambiguate
  const labelSet = new Set(labels);
  for (const candidate of candidates) {
    const disambigLabel = STATE_DISAMBIGUATION_LABELS[candidate];
    if (disambigLabel && labelSet.has(disambigLabel)) {
      return candidate;
    }
  }

  // No disambiguation label found — return the first candidate that
  // does NOT require disambiguation (i.e., the "default" for that Linear state)
  for (const candidate of candidates) {
    if (!STATE_DISAMBIGUATION_LABELS[candidate]) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Map a VERSO work type to a Linear label name.
 */
export function workTypeToLabel(workType: string): string {
  return WORK_TYPE_LABELS[workType] || 'feature';
}

/**
 * Detect a VERSO work type from a set of Linear label names.
 */
export function detectWorkType(labels: string[]): string {
  const validTypes = new Set(Object.values(WORK_TYPE_LABELS));
  for (const label of labels) {
    if (validTypes.has(label)) return label;
  }
  return 'feature'; // default
}

export { DEFAULT_STATE_MAP, STATE_DISAMBIGUATION_LABELS, WORK_TYPE_LABELS };

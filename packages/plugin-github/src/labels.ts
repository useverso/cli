export const STATE_TO_LABEL: Record<string, string> = {
  captured: 'verso:captured',
  refined: 'verso:refined',
  queued: 'verso:queued',
  blocked: 'verso:blocked',
  building: 'verso:building',
  verifying: 'verso:verifying',
  pr_ready: 'verso:pr-ready',
  // done and cancelled are represented by issue closed state
};

export const LABEL_TO_STATE: Record<string, string> = {};
for (const [state, label] of Object.entries(STATE_TO_LABEL)) {
  LABEL_TO_STATE[label] = state;
}

export function buildLabels(item: { state: string; type: string }): string[] {
  const labels = ['verso']; // meta-label for filtering
  const stateLabel = STATE_TO_LABEL[item.state];
  if (stateLabel) labels.push(stateLabel);
  labels.push(`type:${item.type}`);
  return labels;
}

export function detectWorkType(labels: Array<string | { name?: string }>): string {
  const validTypes = ['feature', 'bug', 'hotfix', 'refactor', 'chore'];
  for (const label of labels) {
    const name = typeof label === 'string' ? label : label.name;
    if (name?.startsWith('type:')) {
      const t = name.replace('type:', '');
      if (validTypes.includes(t)) return t;
    }
  }
  return 'feature'; // default
}

export function detectVersoState(issue: { state?: string; labels?: Array<string | { name?: string }> }): string | null {
  if (issue.state === 'closed') return 'done';
  for (const label of issue.labels || []) {
    const name = typeof label === 'string' ? label : label.name;
    if (name && LABEL_TO_STATE[name]) {
      return LABEL_TO_STATE[name];
    }
  }
  return null;
}

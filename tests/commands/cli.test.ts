import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(__dirname, '..', '..', 'src', 'index.ts');

/** Run a verso CLI command inside the given directory, return stdout */
function verso(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Run a verso CLI command expecting failure, return combined output */
function versoFail(dir: string, args: string): string {
  try {
    execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return '';
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    return (e.stderr ?? '') + (e.stdout ?? '');
  }
}

describe('verso CLI commands', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-cli-test-'));
    // Initialize a .verso project
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── board add ─────────────────────────────────────────────
  describe('board add', () => {
    it('creates an item and returns JSON', () => {
      const out = verso(tmpDir, 'board add -t feature --title "Login page" --format json');
      const item = JSON.parse(out);
      expect(item.id).toBe(1);
      expect(item.title).toBe('Login page');
      expect(item.type).toBe('feature');
      expect(item.state).toBe('captured');
    });

    it('creates an item with plain output', () => {
      const out = verso(tmpDir, 'board add -t bug --title "Fix crash" --format plain');
      expect(out).toContain('id: 1');
      expect(out).toContain('state: captured');
      expect(out).toContain('type: bug');
      expect(out).toContain('title: Fix crash');
    });

    it('auto-increments IDs', () => {
      verso(tmpDir, 'board add -t feature --title "First"');
      const out = verso(tmpDir, 'board add -t feature --title "Second" --format json');
      const item = JSON.parse(out);
      expect(item.id).toBe(2);
    });
  });

  // ── board show ────────────────────────────────────────────
  describe('board show', () => {
    it('shows item detail as JSON', () => {
      verso(tmpDir, 'board add -t feature --title "Auth module"');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.id).toBe(1);
      expect(item.title).toBe('Auth module');
    });

    it('fails for non-existent item', () => {
      const out = versoFail(tmpDir, 'board show 99 --format plain');
      expect(out).toContain('not found');
    });
  });

  // ── board list ────────────────────────────────────────────
  describe('board list', () => {
    it('lists items as JSON array', () => {
      verso(tmpDir, 'board add -t feature --title "First"');
      verso(tmpDir, 'board add -t bug --title "Second"');
      const out = verso(tmpDir, 'board list --format json');
      const items = JSON.parse(out);
      expect(items).toHaveLength(2);
    });

    it('filters by state', () => {
      verso(tmpDir, 'board add -t feature --title "Item1"');
      verso(tmpDir, 'board add -t feature --title "Item2"');
      // Move item 1 to refined
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved --actor captain');
      const out = verso(tmpDir, 'board list --state captured --format json');
      const items = JSON.parse(out);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(2);
    });

    it('filters by type', () => {
      verso(tmpDir, 'board add -t feature --title "Feat1"');
      verso(tmpDir, 'board add -t bug --title "Bug1"');
      const out = verso(tmpDir, 'board list -t bug --format json');
      const items = JSON.parse(out);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('bug');
    });
  });

  // ── board move ────────────────────────────────────────────
  describe('board move', () => {
    it('moves item state', () => {
      verso(tmpDir, 'board add -t feature --title "Move me"');
      const out = verso(tmpDir, 'board move 1 --to refined --trigger spec_approved --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('refined');
    });

    it('fails on invalid transition', () => {
      verso(tmpDir, 'board add -t feature --title "Bad move"');
      const out = versoFail(tmpDir, 'board move 1 --to done --format plain');
      expect(out).toContain('Invalid transition');
    });
  });

  // ── board update ──────────────────────────────────────────
  describe('board update', () => {
    it('updates title', () => {
      verso(tmpDir, 'board add -t feature --title "Old title"');
      verso(tmpDir, 'board update 1 --title "New title"');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.title).toBe('New title');
    });

    it('updates assignee', () => {
      verso(tmpDir, 'board add -t feature --title "Task"');
      verso(tmpDir, 'board update 1 --assignee alice');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.assignee).toBe('alice');
    });
  });

  // ── board add with new fields ────────────────────────────
  describe('board add with new fields', () => {
    it('board add with --description', () => {
      const out = verso(tmpDir, 'board add -t feature --title "With desc" --description "Build login" --format json');
      const item = JSON.parse(out);
      expect(item.description).toBe('Build login');
    });

    it('board add with --milestone', () => {
      const out = verso(tmpDir, 'board add -t feature --title "With ms" --milestone "v1.0" --format json');
      const item = JSON.parse(out);
      expect(item.milestone).toBe('v1.0');
    });

    it('board add with --labels', () => {
      const out = verso(tmpDir, 'board add -t feature --title "With labels" --labels "auth,security" --format json');
      const item = JSON.parse(out);
      expect(item.labels).toEqual(['auth', 'security']);
    });

    it('board add with --complexity', () => {
      const out = verso(tmpDir, 'board add -t feature --title "With complexity" --complexity complex --format json');
      const item = JSON.parse(out);
      expect(item.complexity).toBe('complex');
    });

    it('board add with --spec-path', () => {
      const out = verso(tmpDir, 'board add -t feature --title "With spec" --spec-path ".verso/specs/login.md" --format json');
      const item = JSON.parse(out);
      expect(item.spec_path).toBe('.verso/specs/login.md');
    });
  });

  // ── board update with new fields ───────────────────────────
  describe('board update with new fields', () => {
    it('board update with --description', () => {
      verso(tmpDir, 'board add -t feature --title "Test"');
      verso(tmpDir, 'board update 1 --description "Updated desc"');
      const out = verso(tmpDir, 'board show 1 --format json');
      expect(JSON.parse(out).description).toBe('Updated desc');
    });

    it('board update with --milestone and --complexity', () => {
      verso(tmpDir, 'board add -t feature --title "Test"');
      verso(tmpDir, 'board update 1 --milestone "v2.0" --complexity complex');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.milestone).toBe('v2.0');
      expect(item.complexity).toBe('complex');
    });

    it('board update with --labels', () => {
      verso(tmpDir, 'board add -t feature --title "Test"');
      verso(tmpDir, 'board update 1 --labels "frontend, backend"');
      const out = verso(tmpDir, 'board show 1 --format json');
      expect(JSON.parse(out).labels).toEqual(['frontend', 'backend']);
    });

    it('board update with --branch and --pr', () => {
      verso(tmpDir, 'board add -t feature --title "Test"');
      verso(tmpDir, 'board update 1 --branch "feat/login" --pr "#42"');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.branch).toBe('feat/login');
      expect(item.pr).toBe('#42');
    });

    it('board update with --spec-path', () => {
      verso(tmpDir, 'board add -t feature --title "Test"');
      verso(tmpDir, 'board update 1 --spec-path ".verso/specs/auth.md"');
      const out = verso(tmpDir, 'board show 1 --format json');
      expect(JSON.parse(out).spec_path).toBe('.verso/specs/auth.md');
    });

    it('board update with --autonomy', () => {
      verso(tmpDir, 'board add -t feature --title "Test"');
      verso(tmpDir, 'board update 1 --autonomy 4');
      const out = verso(tmpDir, 'board show 1 --format json');
      expect(JSON.parse(out).autonomy).toBe(4);
    });
  });

  // ── board move to blocked ──────────────────────────────────
  describe('board move to blocked', () => {
    it('board move to blocked requires --reason', () => {
      verso(tmpDir, 'board add -t feature --title "Block test"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      const out = versoFail(tmpDir, 'board move 1 --to blocked');
      expect(out).toContain('reason');
    });

    it('board move to blocked with --reason succeeds', () => {
      verso(tmpDir, 'board add -t feature --title "Block test"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      const out = verso(tmpDir, 'board move 1 --to blocked --reason "waiting for API" --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('blocked');
      expect(item.blocked_reason).toBe('waiting for API');
    });
  });

  // ── board cancel ──────────────────────────────────────────
  describe('board cancel', () => {
    it('cancels an item', () => {
      verso(tmpDir, 'board add -t feature --title "Cancel me"');
      const out = verso(tmpDir, 'board cancel 1 --reason "no longer needed" --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('cancelled');
    });
  });

  // ── build start ───────────────────────────────────────────
  describe('build start', () => {
    it('moves item to building state', () => {
      verso(tmpDir, 'board add -t feature --title "Build me"');
      // Need to move through: captured -> refined -> queued -> building
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      const out = verso(tmpDir, 'build start 1 --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('building');
    });

    it('sets assignee when provided', () => {
      verso(tmpDir, 'board add -t feature --title "Assign me"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1 --assignee builder-1');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.assignee).toBe('builder-1');
    });

    it('increments agent_sessions', () => {
      verso(tmpDir, 'board add -t feature --title "Sessions test"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.agent_sessions).toBe(1);
    });
  });

  // ── build start error cases ──────────────────────────────
  describe('build start error cases', () => {
    it('fails when item is not in queued state', () => {
      verso(tmpDir, 'board add -t feature --title "Not queued"');
      // Item is in captured state
      const out = versoFail(tmpDir, 'build start 1');
      expect(out).toContain('Invalid transition');
    });

    it('fails when item is in building state', () => {
      verso(tmpDir, 'board add -t feature --title "Already building"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      // Now try to start again — item is already building
      const out = versoFail(tmpDir, 'build start 1');
      expect(out).toContain('Invalid transition');
    });
  });

  // ── build fail ────────────────────────────────────────────
  describe('build fail', () => {
    it('moves item back to queued on first failure', () => {
      verso(tmpDir, 'board add -t feature --title "Fail me"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      const out = verso(tmpDir, 'build fail 1 --reason "tests failed" --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('queued');
    });

    it('increments retries counter on failure', () => {
      verso(tmpDir, 'board add -t feature --title "Retry counter"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'build fail 1 --reason "compile error"');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.retries).toBe(1);
    });
  });

  // ── review start ──────────────────────────────────────────
  describe('review start', () => {
    it('moves item to verifying', () => {
      verso(tmpDir, 'board add -t feature --title "Review me"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      // building -> verifying
      const out = verso(tmpDir, 'review start 1 --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('verifying');
    });

    it('fails when item is not in building state', () => {
      verso(tmpDir, 'board add -t feature --title "Not building"');
      // Item is in captured state
      const out = versoFail(tmpDir, 'review start 1');
      expect(out).toContain('Invalid transition');
    });
  });

  // ── review submit ─────────────────────────────────────────
  describe('review submit', () => {
    it('approve moves to pr_ready', () => {
      verso(tmpDir, 'board add -t feature --title "Approve me"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'review start 1');
      const out = verso(
        tmpDir,
        'review submit 1 --verdict approve --summary "Looks good" --format json',
      );
      const item = JSON.parse(out);
      expect(item.state).toBe('pr_ready');
    });

    it('request-changes moves back to building', () => {
      verso(tmpDir, 'board add -t feature --title "Change me"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'review start 1');
      const out = verso(
        tmpDir,
        'review submit 1 --verdict request-changes --summary "Needs work" --format json',
      );
      const item = JSON.parse(out);
      expect(item.state).toBe('building');
    });

    it('records review in item', () => {
      verso(tmpDir, 'board add -t feature --title "Review record"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'review start 1');
      verso(tmpDir, 'review submit 1 --verdict approve --summary "All good"');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.reviews).toHaveLength(1);
      expect(item.reviews[0].verdict).toBe('approve');
      expect(item.reviews[0].summary).toBe('All good');
    });
  });

  // ── review escalate ───────────────────────────────────────
  describe('review escalate', () => {
    it('moves item to blocked', () => {
      verso(tmpDir, 'board add -t feature --title "Escalate me"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'review start 1');
      const out = verso(tmpDir, 'review escalate 1 --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('blocked');
    });

    it('records escalation reason', () => {
      verso(tmpDir, 'board add -t feature --title "Escalate reason"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'review start 1');
      verso(tmpDir, 'review escalate 1');
      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.blocked_reason).toBe('review rejected');
    });
  });

  // ── ship ──────────────────────────────────────────────────
  describe('ship', () => {
    it('moves item to done', () => {
      verso(tmpDir, 'board add -t feature --title "Ship me"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'review start 1');
      verso(tmpDir, 'review submit 1 --verdict approve --summary "LGTM"');
      const out = verso(tmpDir, 'ship 1 --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('done');
    });

    it('fails when item is not in pr_ready state', () => {
      verso(tmpDir, 'board add -t feature --title "Not ready"');
      // Item is in captured state
      const out = versoFail(tmpDir, 'ship 1');
      expect(out).toContain('Invalid transition');
    });

    it('fails when item is in building state', () => {
      verso(tmpDir, 'board add -t feature --title "Still building"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      const out = versoFail(tmpDir, 'ship 1');
      expect(out).toContain('Invalid transition');
    });
  });

  // ── status ────────────────────────────────────────────────
  describe('status', () => {
    it('shows status as JSON', () => {
      verso(tmpDir, 'board add -t feature --title "Status item"');
      const out = verso(tmpDir, 'status --format json');
      const status = JSON.parse(out);
      expect(status.total).toBe(1);
      expect(status.counts.captured).toBe(1);
      expect(status.wip.building.current).toBe(0);
    });

    it('counts items by state', () => {
      verso(tmpDir, 'board add -t feature --title "A"');
      verso(tmpDir, 'board add -t feature --title "B"');
      verso(tmpDir, 'board cancel 2 --reason "nope"');
      const out = verso(tmpDir, 'status --format json');
      const status = JSON.parse(out);
      expect(status.total).toBe(2);
      expect(status.done).toBe(0);
      expect(status.cancelled).toBe(1);
      expect(status.counts.captured).toBe(1);
      expect(status.counts.cancelled).toBe(1);
    });

    it('shows plain output', () => {
      verso(tmpDir, 'board add -t feature --title "Plain status"');
      const out = verso(tmpDir, 'status --format plain');
      expect(out).toContain('total: 1');
      expect(out).toContain('captured: 1');
    });
  });

  // ── doctor ────────────────────────────────────────────────
  describe('doctor', () => {
    it('passes all checks on a fresh project', () => {
      const out = verso(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);
      expect(result.has_failures).toBe(false);
      expect(result.checks.length).toBeGreaterThan(0);
      // All critical checks should pass
      const fails = result.checks.filter((c: { severity: string }) => c.severity === 'fail');
      expect(fails).toHaveLength(0);
    });

    it('reports pass in plain format', () => {
      const out = verso(tmpDir, 'doctor --format plain');
      expect(out).toContain('verso_dir: pass');
      expect(out).toContain('config_yaml: pass');
    });
  });

  // ── upgrade ───────────────────────────────────────────────
  describe('upgrade', () => {
    it('updates unmodified files on fresh project', () => {
      const out = verso(tmpDir, 'upgrade --format json');
      const result = JSON.parse(out);
      expect(result.updated.length).toBeGreaterThan(0);
      expect(result.preserved).toEqual([]);
    });

    it('reports updated files in plain format', () => {
      const out = verso(tmpDir, 'upgrade --format plain');
      expect(out).toContain('updated:');
      expect(out).toContain('recomposed: agents/pilot.md');
    });
  });

  // ── full lifecycle ────────────────────────────────────────
  describe('full lifecycle', () => {
    it('item goes through captured -> refined -> queued -> building -> verifying -> pr_ready -> done', () => {
      verso(tmpDir, 'board add -t feature --title "Full lifecycle"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
      verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'review start 1');
      verso(tmpDir, 'review submit 1 --verdict approve --summary "Done"');
      verso(tmpDir, 'ship 1');

      const out = verso(tmpDir, 'board show 1 --format json');
      const item = JSON.parse(out);
      expect(item.state).toBe('done');
      expect(item.agent_sessions).toBe(1);
      expect(item.reviews).toHaveLength(1);

      // Board file on disk should also reflect this
      const boardContent = readFileSync(join(tmpDir, '.verso', 'board.yaml'), 'utf-8');
      expect(boardContent).toContain('done');
    });

    it('comprehensive lifecycle: verifies all transitions, fields, and history', () => {
      // 1. Add item
      const addOut = verso(tmpDir, 'board add -t feature --title "Complete lifecycle" --format json');
      const created = JSON.parse(addOut);
      expect(created.state).toBe('captured');
      expect(created.id).toBe(1);
      expect(created.retries).toBe(0);
      expect(created.agent_sessions).toBe(0);
      expect(created.reviews).toEqual([]);
      expect(created.transitions).toEqual([]);

      // 2. Refine (captured -> refined)
      verso(tmpDir, 'board move 1 --to refined --trigger spec_written --actor captain');
      let show = verso(tmpDir, 'board show 1 --format json');
      let item = JSON.parse(show);
      expect(item.state).toBe('refined');
      expect(item.transitions).toHaveLength(1);
      expect(item.transitions[0].from).toBe('captured');
      expect(item.transitions[0].to).toBe('refined');
      expect(item.transitions[0].trigger).toBe('spec_written');

      // 3. Queue (refined -> queued)
      verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete --actor captain');
      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('queued');
      expect(item.transitions).toHaveLength(2);
      expect(item.transitions[1].from).toBe('refined');
      expect(item.transitions[1].to).toBe('queued');

      // 4. Build start (queued -> building)
      verso(tmpDir, 'build start 1 --assignee builder-agent');
      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('building');
      expect(item.assignee).toBe('builder-agent');
      expect(item.agent_sessions).toBe(1);
      expect(item.transitions).toHaveLength(3);
      expect(item.transitions[2].from).toBe('queued');
      expect(item.transitions[2].to).toBe('building');
      expect(item.transitions[2].trigger).toBe('builder_spawned');

      // 5. Review start (building -> verifying)
      verso(tmpDir, 'review start 1');
      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('verifying');
      expect(item.transitions).toHaveLength(4);
      expect(item.transitions[3].from).toBe('building');
      expect(item.transitions[3].to).toBe('verifying');
      expect(item.transitions[3].trigger).toBe('pr_created');

      // 6. Review approve (verifying -> pr_ready)
      verso(tmpDir, 'review submit 1 --verdict approve --summary "All checks pass"');
      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('pr_ready');
      expect(item.transitions).toHaveLength(5);
      expect(item.transitions[4].from).toBe('verifying');
      expect(item.transitions[4].to).toBe('pr_ready');
      expect(item.transitions[4].trigger).toBe('reviewer_commented');
      expect(item.reviews).toHaveLength(1);
      expect(item.reviews[0].verdict).toBe('approve');
      expect(item.reviews[0].summary).toBe('All checks pass');
      expect(item.reviews[0].at).toBeTruthy();

      // 7. Ship (pr_ready -> done)
      verso(tmpDir, 'ship 1');
      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('done');
      expect(item.transitions).toHaveLength(6);
      expect(item.transitions[5].from).toBe('pr_ready');
      expect(item.transitions[5].to).toBe('done');
      expect(item.transitions[5].trigger).toBe('pr_merged');

      // Final assertions
      expect(item.type).toBe('feature');
      expect(item.title).toBe('Complete lifecycle');
      expect(item.assignee).toBe('builder-agent');
      expect(item.agent_sessions).toBe(1);
      expect(item.retries).toBe(0);
      expect(item.reviews).toHaveLength(1);

      // Board file on disk is consistent
      const boardContent = readFileSync(join(tmpDir, '.verso', 'board.yaml'), 'utf-8');
      expect(boardContent).toContain('done');
      expect(boardContent).toContain('Complete lifecycle');
    });

    it('lifecycle with review rejection cycle: build -> review reject -> rebuild -> approve -> ship', () => {
      verso(tmpDir, 'board add -t feature --title "Review cycle"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
      verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');

      // First build
      verso(tmpDir, 'build start 1 --assignee builder-1');

      // First review: request changes
      verso(tmpDir, 'review start 1');
      verso(tmpDir, 'review submit 1 --verdict request-changes --summary "Missing tests"');

      let show = verso(tmpDir, 'board show 1 --format json');
      let item = JSON.parse(show);
      expect(item.state).toBe('building');
      expect(item.reviews).toHaveLength(1);
      expect(item.reviews[0].verdict).toBe('request-changes');

      // Second review: approve
      verso(tmpDir, 'review start 1');
      verso(tmpDir, 'review submit 1 --verdict approve --summary "Tests added, LGTM"');

      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('pr_ready');
      expect(item.reviews).toHaveLength(2);
      expect(item.reviews[1].verdict).toBe('approve');

      // Ship
      verso(tmpDir, 'ship 1');
      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('done');
    });

    it('lifecycle with build failure and retry: build -> fail -> rebuild -> review -> ship', () => {
      verso(tmpDir, 'board add -t feature --title "Retry lifecycle"');
      verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
      verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');

      // First build attempt fails
      verso(tmpDir, 'build start 1 --assignee builder-1');
      verso(tmpDir, 'build fail 1 --reason "compilation error"');

      let show = verso(tmpDir, 'board show 1 --format json');
      let item = JSON.parse(show);
      expect(item.state).toBe('queued');
      expect(item.retries).toBe(1);
      expect(item.agent_sessions).toBe(1);

      // Second build attempt succeeds
      verso(tmpDir, 'build start 1 --assignee builder-2');
      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('building');
      expect(item.assignee).toBe('builder-2');
      expect(item.agent_sessions).toBe(2);

      // Review and ship
      verso(tmpDir, 'review start 1');
      verso(tmpDir, 'review submit 1 --verdict approve --summary "Fixed"');
      verso(tmpDir, 'ship 1');

      show = verso(tmpDir, 'board show 1 --format json');
      item = JSON.parse(show);
      expect(item.state).toBe('done');
      expect(item.retries).toBe(1);
      expect(item.agent_sessions).toBe(2);
    });
  });
});

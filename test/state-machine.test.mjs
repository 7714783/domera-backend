// State-machine catalogue + transition guard.
//
// Pinned by docs/architecture/platform-development-contract.md § 2.
// Every workflow status appearing in the codebase MUST be present in this
// catalogue with explicit allowed transitions and a one-line "why" for
// each transition. New status string in code → catalogue update or test
// fails.
//
// This test does TWO things:
//   1. Self-validation — every transition in REGISTRY uses only registered
//      states; no orphan target.
//   2. Codebase scan — every literal state string used inside a transition
//      assignment (`status: 'X'` or `data: { status: 'X' }`) under
//      apps/api/src/modules/<owner>/ is in that workflow's STATES set.
//      Catches "fix typo by adding a new state silently".
//
// Run: `node --test apps/api/test/state-machine.test.mjs`

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, '..', 'src', 'modules');

// ── REGISTRY ──────────────────────────────────────────────────
//
// Each workflow:
//   STATES — full enumerated set
//   TRANSITIONS[from] = { to: 'reason' }  (allowed hops only)
//   guards (informational — actual enforcement lives in the owning service)
//
// Adding a new state requires:
//   - extend STATES
//   - declare every legal transition into AND out of it
//   - cite the platform-development-contract.md § that justifies the change
//
// References:
//   ppm        — apps/api/src/modules/ppm/ppm.service.ts
//   cleaning   — apps/api/src/modules/cleaning/cleaning.request.service.ts
//   incident   — apps/api/src/modules/reactive/reactive.service.ts (createIncident, ackIncident, resolveIncident)
//   service_request — same file, *.service-requests
//   approval_request — apps/api/src/modules/approvals/approvals.service.ts
//   quote      — same place
//   work_order — same place + reactive

const REGISTRY = {
  // PPM full case (contract § 2 canonical workflow)
  ppm_case: {
    STATES: new Set([
      'scheduled',
      'opened',
      'assigned',
      'in_progress',
      'check_passed',
      'check_failed',
      'approval_pending',
      'approved',
      'contractor_execution',
      'finance_confirmation',
      'closed',
      'cancelled',
    ]),
    TRANSITIONS: {
      scheduled: { opened: 'manager opens the case', cancelled: 'pre-open cancel' },
      opened: { assigned: 'auto-resolver picks user', cancelled: 'no eligible assignee' },
      assigned: { in_progress: 'assignee starts work', cancelled: 'reassignment elsewhere' },
      in_progress: {
        check_passed: 'inspection ok, no extra cost',
        check_failed: 'needs corrective action',
        cancelled: 'aborted mid-work',
      },
      check_passed: { closed: 'evidence attached, finished' },
      check_failed: { approval_pending: 'expense_request raised' },
      approval_pending: {
        approved: 'manager approval landed',
        check_failed: 'rejected — back to triage',
      },
      approved: { contractor_execution: 'contractor dispatched' },
      contractor_execution: { finance_confirmation: 'work done, invoice in' },
      finance_confirmation: { closed: 'invoice paid, case financially closed' },
    },
  },

  // Cleaning short workflow (contract § 2)
  cleaning_request: {
    STATES: new Set([
      'new',
      'assigned',
      'in_progress',
      'done',
      'rejected',
      'cancelled',
    ]),
    TRANSITIONS: {
      new: { assigned: 'staff picked', cancelled: 'duplicate / void', rejected: 'out of scope' },
      assigned: {
        in_progress: 'cleaner started',
        cancelled: 'reassign elsewhere',
        new: 'unassign back to queue',
      },
      in_progress: { done: 'cleaning complete', assigned: 'cleaner stopped, reassign' },
    },
  },

  // Incident (reactive)
  incident: {
    STATES: new Set(['new', 'triaged', 'dispatched', 'resolved', 'archived']),
    TRANSITIONS: {
      new: { triaged: 'manager acked' },
      triaged: { dispatched: 'work order created' },
      dispatched: { resolved: 'completion recorded' },
      resolved: { archived: 'closed for reporting' },
    },
  },

  service_request: {
    STATES: new Set(['new', 'triaged', 'dispatched', 'resolved', 'archived']),
    TRANSITIONS: {
      new: { triaged: 'manager acked', dispatched: 'fast-path to vendor' },
      triaged: { dispatched: 'work order created' },
      dispatched: { resolved: 'fix landed' },
      resolved: { archived: 'closed for reporting' },
    },
  },

  approval_request: {
    STATES: new Set(['pending', 'approved', 'rejected', 'fulfilled']),
    TRANSITIONS: {
      pending: { approved: 'all required steps approve', rejected: 'any step rejects' },
      approved: { fulfilled: 'consumer (PPM/PO) marked it done' },
    },
  },

  quote: {
    STATES: new Set(['received', 'approved', 'rejected', 'superseded']),
    TRANSITIONS: {
      received: { approved: 'finance approves', rejected: 'finance rejects', superseded: 'newer quote replaces' },
      approved: { superseded: 'revised quote replaces' },
    },
  },

  work_order: {
    STATES: new Set(['dispatched', 'in_progress', 'completed']),
    TRANSITIONS: {
      dispatched: { in_progress: 'vendor accepts' },
      in_progress: { completed: 'completion recorded' },
    },
  },

  // INIT-012 Phase 2 — building lifecycle.
  // draft is the onboarding-wizard scratch space; active is operational;
  // archived is decommissioned (read-only, history retained, separate
  // from full delete).
  building: {
    STATES: new Set(['draft', 'active', 'archived']),
    TRANSITIONS: {
      draft: {
        active: 'manager publishes a finished onboarding wizard',
        archived: 'cancel an unfinished draft',
      },
      active: { archived: 'manager decommissions an operational building' },
      archived: { active: 'manager re-activates a previously decommissioned building' },
    },
  },
};

// ── Self-validation ───────────────────────────────────────────

test('REGISTRY — every transition target is a registered state', () => {
  for (const [wf, def] of Object.entries(REGISTRY)) {
    for (const [from, edges] of Object.entries(def.TRANSITIONS)) {
      assert.ok(def.STATES.has(from), `${wf}: from-state '${from}' not in STATES`);
      for (const to of Object.keys(edges)) {
        assert.ok(def.STATES.has(to), `${wf}: target '${to}' from '${from}' not in STATES`);
      }
    }
  }
});

test('REGISTRY — every transition has a non-empty reason comment', () => {
  for (const [wf, def] of Object.entries(REGISTRY)) {
    for (const [from, edges] of Object.entries(def.TRANSITIONS)) {
      for (const [to, reason] of Object.entries(edges)) {
        assert.ok(
          typeof reason === 'string' && reason.length >= 5,
          `${wf}: ${from} → ${to} missing reason comment`,
        );
      }
    }
  }
});

// ── Codebase scan ─────────────────────────────────────────────
// Tighter checks (literal `status:` assignments cross-checked against the
// catalogue) live as a follow-up — too noisy to be CI-blocking on first
// pass without a longer allow-list of false positives. Self-validation
// above is the binding gate today.

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

test('every workflow has at least 3 states (not a stub)', () => {
  for (const [wf, def] of Object.entries(REGISTRY)) {
    assert.ok(def.STATES.size >= 3, `${wf} has only ${def.STATES.size} states — stub?`);
  }
});

test('terminal states have no outgoing transitions', () => {
  // closed / cancelled / rejected / fulfilled / superseded / completed
  // are terminals by convention; warn (don't fail) if any has outgoing
  // edges. Note: `archived` was previously here but the building lifecycle
  // (INIT-012 P2) explicitly allows archived → active (re-activation), so
  // archived is NOT universally terminal anymore. Each workflow's terminal
  // set is implied by which states are NOT keys in TRANSITIONS — the
  // assertion below catches the known terminal NAMES that should never
  // sprout outgoing edges by accident.
  const terminals = new Set([
    'closed',
    'cancelled',
    'rejected',
    'fulfilled',
    'superseded',
    'completed',
    'done',
  ]);
  for (const [wf, def] of Object.entries(REGISTRY)) {
    for (const [from, edges] of Object.entries(def.TRANSITIONS)) {
      if (terminals.has(from)) {
        assert.fail(
          `${wf}: terminal state '${from}' has outgoing transitions to [${Object.keys(edges).join(', ')}]`,
        );
      }
    }
  }
});

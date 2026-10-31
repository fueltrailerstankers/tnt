import { describe, expect, it } from 'vitest';
import { areaOf, describe as describeAudit, KNOWN_ACTIONS } from '@/lib/activity/describe';
import { findDuplicateOf } from '@/lib/leads/duplicates';
import { BranchChange, Merge, NotDuplicate } from '@/lib/leads/schema';
import { actionMessage, leadRpcError, LEAD_RPC_CODES } from '@/lib/leads-view/actions';
import { branchSuggestions, duplicateActions } from '@/lib/leads-view/model';
import { eventLabel, eventText } from '@/lib/leads-view/timeline';

// Leads actions (0023): Merge, Not a duplicate, Branch. Pure rules only; the RPCs are covered in tests/db. Synthetic data.

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('duplicate detection after merge and "Not a duplicate"', () => {
  const c = (id: string, created: string, email: string | null, dup: string | null = null, merged: string | null = null) =>
    ({ id, created_at: created, email_norm: email, phone_norm: null, duplicate_of: dup, merged_into: merged });

  it('a merged lead hands new duplicates to the lead it was merged into', () => {
    const rows = [c('m', '2026-10-02T00:00:00Z', 'x@example.invalid', 'orig', 'orig')];
    expect(findDuplicateOf({ email_norm: 'x@example.invalid', phone_norm: null }, rows)).toBe('orig');
    // merged_into wins over a stale duplicate_of
    expect(findDuplicateOf({ email_norm: 'x@example.invalid', phone_norm: null }, [c('m', '2026-10-02', 'x@example.invalid', 'old', 'new')])).toBe('new');
  });

  it('never flags a lead again against the original staff dismissed', () => {
    const rows = [c('a', '2026-10-01T00:00:00Z', 'x@example.invalid')];
    const lead = { id: 'b', created_at: '2026-10-02T00:00:00Z', email_norm: 'x@example.invalid', phone_norm: null };
    expect(findDuplicateOf(lead, rows)).toBe('a');
    expect(findDuplicateOf({ ...lead, not_duplicate_of: 'a' }, rows)).toBeNull();
    // A different original is still found.
    expect(findDuplicateOf({ ...lead, not_duplicate_of: 'zzz' }, rows)).toBe('a');
  });
});

describe('schemas', () => {
  it('Merge needs two different lead ids', () => {
    expect(Merge.safeParse({ id: A, into: B }).success).toBe(true);
    expect(Merge.safeParse({ id: A, into: A }).success).toBe(false);
    expect(Merge.safeParse({ id: A, into: 'x' }).success).toBe(false);
    expect(NotDuplicate.safeParse({ id: A, of: B }).success).toBe(true);
    expect(NotDuplicate.safeParse({ id: A }).success).toBe(false);
  });

  it('Branch trims, clears on blank and allows the intake characters only', () => {
    expect(BranchChange.parse({ id: A, branch: '  Cape Town ' }).branch).toBe('Cape Town');
    expect(BranchChange.parse({ id: A, branch: "St. Helena's-Bay" }).branch).toBe("St. Helena's-Bay");
    expect(BranchChange.parse({ id: A, branch: '   ' }).branch).toBeNull();
    for (const bad of ['1 Durban', 'Durban;', 'x'.repeat(61), '<b>']) {
      expect(BranchChange.safeParse({ id: A, branch: bad }).success).toBe(false);
    }
  });
});

describe('RPC errors', () => {
  it('maps every lead RPC code to a message and anything else to a plain save error', () => {
    expect(leadRpcError({ message: 'LEAD_MERGED', hint: 'leads' })).toBe('merged');
    expect(leadRpcError({ message: 'DUPLICATE_CHANGED', hint: 'leads' })).toBe('changed');
    expect(leadRpcError({ message: 'LEAD_NOT_FOUND', hint: 'leads' })).toBe('notfound');
    expect(leadRpcError({ message: 'FORBIDDEN', hint: 'leads' })).toBe('forbidden');
    expect(leadRpcError({ message: 'INVALID_INPUT', hint: 'leads' })).toBe('invalid');
    expect(leadRpcError({ message: 'FORBIDDEN', hint: 'stock' })).toBe('save');
    expect(leadRpcError({ message: 'boom' })).toBe('save');
    expect(leadRpcError(null)).toBe('save');
    for (const code of LEAD_RPC_CODES) expect(actionMessage(leadRpcError({ message: code, hint: 'leads' }))).toMatch(/\w/);
  });
});

describe('duplicate banner actions', () => {
  it('offers Merge only with the original on the page, and nothing on merged leads or without leads write', () => {
    const dup = { duplicate_of: B, merged_into: null };
    expect(duplicateActions(dup, { id: B, merged_into: null }, true)).toEqual({ merge: true, notDuplicate: true });
    expect(duplicateActions(dup, null, true)).toEqual({ merge: false, notDuplicate: true });
    expect(duplicateActions(dup, { id: B, merged_into: A }, true)).toEqual({ merge: false, notDuplicate: true });
    expect(duplicateActions(dup, { id: 'other', merged_into: null }, true)).toEqual({ merge: false, notDuplicate: true });
    expect(duplicateActions(dup, { id: B }, false)).toEqual({ merge: false, notDuplicate: false });
    expect(duplicateActions({ duplicate_of: B, merged_into: B }, { id: B }, true)).toEqual({ merge: false, notDuplicate: false });
    expect(duplicateActions({ duplicate_of: null }, null, true)).toEqual({ merge: false, notDuplicate: false });
  });

  it('branch suggestions are distinct (case-insensitive), trimmed and sorted', () => {
    expect(branchSuggestions([' Durban', 'durban', null, '', 'Cape Town', undefined, 'Cape Town'])).toEqual(['Cape Town', 'Durban']);
  });
});

describe('timeline and activity wording', () => {
  const who = new Map<string, string>();
  it('names the new lead events without personal data', () => {
    expect(eventLabel('merged')).toBe('Merged');
    expect(eventLabel('merged_from')).toBe('Duplicate merged in');
    expect(eventLabel('not_duplicate')).toBe('Marked not a duplicate');
    expect(eventText('merged_from', { from: A, repointed: 2 }, who)).toBe('(2 later duplicates now point here)');
    expect(eventText('merged_from', { from: A, repointed: 0 }, who)).toBe('');
    expect(eventText('branch', { from: null, to: 'Durban' }, who)).toBe('not set → Durban');
    expect(eventText('branch', { from: 'Durban', to: null }, who)).toBe('Durban → not set');
  });

  it('describes the audit actions and files them under Leads', () => {
    const row = (action: string, meta: Record<string, unknown> = {}) => ({ id: 1, created_at: '2026-10-31T10:00:00Z', actor_user: null, action, entity: 'lead', entity_id: A, meta });
    for (const a of ['lead.merge', 'lead.not_duplicate', 'lead.branch']) {
      expect(KNOWN_ACTIONS).toContain(a);
      expect(areaOf(a)).toBe('leads');
    }
    expect(describeAudit(row('lead.merge', { into: B }), new Map()).text).toMatch(/merged a duplicate lead into its original/);
    expect(describeAudit(row('lead.not_duplicate', { of: B }), new Map()).text).toMatch(/not a duplicate/);
    expect(describeAudit(row('lead.branch', { from: null, to: 'Durban' }), new Map()).text).toMatch(/branch to Durban/);
    expect(describeAudit(row('lead.branch', { from: 'Durban', to: null }), new Map()).text).toMatch(/cleared a lead's branch/);
    expect(describeAudit(row('lead.merge'), new Map()).href).toBe(`/admin/leads/${A}`);
  });
});

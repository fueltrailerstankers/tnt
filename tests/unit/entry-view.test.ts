import { describe, expect, it } from 'vitest';
import {
  canReveal, decryptAuditRow, formSpecForPage, keepStoredProtected, maskRecipients, protectedNames, protectedView, revealAuditRow, RevealInput, withoutProtected,
} from '@/lib/entry-view/protected';
import { belowMinimum, entryTimeline, extOf, fieldLabels, fileRows, formatBytes, pdfVersions, shortHash } from '@/lib/entry-view/rail';
import { humanizeAction, railActions, roleNote, statusFlow, statusPath } from '@/lib/entry-view/status';
import type { Member } from '@/lib/security/can';
import { hiddenNames } from '@/lib/spec/visibility';
import { checkPost, readFormData } from '@/lib/spec/values';
import { timelineText } from '@/lib/ui/timeline';
import { spec } from './specs';

const ORG = '00000000-0000-0000-0000-000000000001';
const member = (role: Member['role']): Member => ({ userId: `u-${role}`, orgId: ORG, role, branch: null });

describe('status path and Store Room flow', () => {
  const insp = spec('trailer-inspection-checklist');

  it('shows the spec statuses (no Incomplete once submitted) with done/current/todo', () => {
    expect(statusPath(insp, 'Submitted').map((s) => [s.label, s.state])).toEqual([['Submitted', 'current'], ['Reviewed', 'todo'], ['Approved', 'todo']]);
    expect(statusPath(insp, 'Reviewed').map((s) => s.state)).toEqual(['done', 'current', 'todo']);
    // The last status reads done once reached (design: Approved ✓).
    expect(statusPath(insp, 'Approved').map((s) => s.state)).toEqual(['done', 'done', 'done']);
    expect(statusPath(insp, 'Incomplete').map((s) => s.label)).toEqual(['Incomplete', 'Submitted', 'Reviewed', 'Approved']);
    expect(statusPath(insp, 'Reviewed')[1].tone).toBe('yellow');
  });

  it('leaves archived statuses off the path; an off-path status marks nothing', () => {
    const sr = spec('store-room');
    expect(statusPath(sr, 'APPROVAL').map((s) => s.label)).toEqual(['APPROVAL', 'APPROVED EMAILED']);
    expect(statusPath(sr, 'Submitted').every((s) => s.state === 'todo')).toBe(true);
  });

  it('Store Room flow: Submitted (archived) → APPROVAL (red) → APPROVED EMAILED (green)', () => {
    const sr = spec('store-room');
    const flow = statusFlow(sr, 'APPROVAL');
    expect(flow.map((f) => [f.label, f.state, f.tone])).toEqual([
      ['Submitted (archived)', 'done', 'gray'],
      ['APPROVAL', 'current', 'red'],
      ['APPROVED EMAILED', 'todo', 'green'],
    ]);
    expect(statusFlow(sr, 'APPROVED EMAILED').map((f) => f.state)).toEqual(['done', 'done', 'done']);
  });
});

describe('rail actions', () => {
  const insp = spec('trailer-inspection-checklist');

  it('humanizes spec action names', () => {
    expect(humanizeAction('MarkReviewed')).toBe('Mark reviewed');
    expect(humanizeAction('RequestReviewChanges')).toBe('Request review changes');
    expect(humanizeAction('ApproveInspection')).toBe('Approve inspection');
    expect(humanizeAction('Submit')).toBe('Submit');
    expect(humanizeAction('Mark as done')).toBe('Mark as done');
  });

  it('lists workflow actions by role: reviewer and admin act, staff and factory do not', () => {
    const names = (m: Member, status: string) => railActions(insp, status, m).map((a) => a.name);
    expect(names(member('admin'), 'Submitted')).toEqual(['RequestReviewChanges', 'MarkReviewed']);
    expect(names(member('reviewer'), 'Reviewed')).toEqual(['ApproveInspection']);
    expect(names(member('staff'), 'Submitted')).toEqual([]);
    expect(names(member('factory'), 'Submitted')).toEqual([]);
    expect(names(member('admin'), 'Approved')).toEqual([]);
    expect(railActions(insp, 'Submitted', member('admin')).find((a) => a.name === 'RequestReviewChanges')?.tone).toBe('secondary');
  });

  it('keeps plain save actions (Update) with the form; rail labels never equal the camel-case button text', () => {
    const jc = spec('job-card');
    expect(railActions(jc, 'Submitted', member('admin'))).toEqual([]);
    for (const a of railActions(insp, 'Submitted', member('admin'))) expect(a.label).not.toBe(a.name);
  });

  it('role note', () => {
    expect(roleNote({ anyAction: false, railCount: 0 })).toBe('No action is available for this entry at its current status.');
    expect(roleNote({ anyAction: true, railCount: 0 })).toMatch(/end of the form/);
  });
});

describe('protected fields', () => {
  const dn = spec('delivery-note');
  const data = { Email: 'customer.one@example.invalid', TrailerVinNO: 'TESTVIN0000000042' };

  it('finds the protected email and masks it on the server', () => {
    expect(protectedNames(dn)).toEqual(['Email']);
    const [v] = protectedView(dn, data);
    expect(v).toMatchObject({ name: 'Email', hasValue: true });
    expect(v.masked).not.toContain('customer.one');
    expect(v.masked).toMatch(/^c•+e@example\.invalid$/);
  });

  it('the page form never receives the value and does not show or check the field', () => {
    const page = withoutProtected(dn, data);
    expect(page).not.toHaveProperty('Email');
    expect(page.TrailerVinNO).toBe('TESTVIN0000000042');
    const view = formSpecForPage(dn);
    expect(view.fields.length).toBe(dn.fields.length);
    expect(hiddenNames(view, page).has('Email')).toBe(true);
    expect(hiddenNames(dn, data).has('Email')).toBe(false);
    // The real spec is untouched.
    expect(dn.fields.find((f) => 'name' in f && f.name === 'Email')).not.toHaveProperty('showWhen');
    // A form without protected fields is returned as is.
    const jc = spec('job-card');
    expect(formSpecForPage(jc)).toBe(jc);
  });

  it('a page post cannot change or blank a protected value', () => {
    const fd = new FormData();
    fd.set('f.Email', 'attacker@example.invalid');
    keepStoredProtected(dn, fd, data);
    expect(fd.get('f.Email')).toBe('customer.one@example.invalid');
    const fd2 = new FormData();
    keepStoredProtected(dn, fd2, data);
    expect(readFormData(dn, fd2).data.Email).toBe('customer.one@example.invalid');
    const fd3 = new FormData();
    fd3.set('f.Email', 'x@example.invalid');
    keepStoredProtected(dn, fd3, {});
    expect(fd3.get('f.Email')).toBeNull();
    // The browser check on the page's spec ignores the hidden field.
    expect(checkPost(formSpecForPage(dn), new FormData(), { audience: 'staff', previous: {} })).not.toHaveProperty('Email');
  });

  it('masks recipients that are a protected value of the entry', () => {
    expect(maskRecipients(dn, data, ['Customer.One@example.invalid', 'sales@example.invalid'])).toEqual([
      expect.stringMatching(/^C•+e@example\.invalid$/), 'sales@example.invalid',
    ]);
    expect(maskRecipients(spec('job-card'), {}, ['a@example.invalid'])).toEqual(['a@example.invalid']);
  });

  it('only admins reveal; audit rows carry ids and keys, never values', () => {
    expect(canReveal(member('admin'))).toBe(true);
    for (const r of ['staff', 'reviewer', 'inspector', 'factory'] as const) expect(canReveal(member(r))).toBe(false);
    expect(canReveal({ ...member('admin'), status: 'disabled' })).toBe(false);
    expect(canReveal(null)).toBe(false);
    const row = revealAuditRow(member('admin'), 'e1', 'delivery-note', ['Email']);
    expect(row).toEqual({ org_id: ORG, actor_user: 'u-admin', action: 'entry.reveal', entity: 'entry', entity_id: 'e1', meta: { form: 'delivery-note', fields: ['Email'] } });
    expect(JSON.stringify(row)).not.toContain('@');
    expect(decryptAuditRow(member('staff'), 'e2', 'deal', 7)).toEqual({ org_id: ORG, actor_user: 'u-staff', action: 'entry.decrypt', entity: 'entry', entity_id: 'e2', meta: { form: 'deal', number: 7, via: 'page' } });
  });

  it('validates reveal input', () => {
    expect(RevealInput.safeParse({ slug: 'delivery-note', number: 3, field: 'Email' }).success).toBe(true);
    expect(RevealInput.safeParse({ slug: '../x', number: 3, field: 'Email' }).success).toBe(false);
    expect(RevealInput.safeParse({ slug: 'deal', number: 0, field: 'Email' }).success).toBe(false);
    expect(RevealInput.safeParse({ slug: 'deal', number: 1.5, field: 'Email' }).success).toBe(false);
  });
});

describe('timeline', () => {
  const insp = spec('trailer-inspection-checklist');
  const ev = (o: Partial<Parameters<typeof entryTimeline>[0][number]>) => ({
    id: '1', action: 'Update', from_status: 'Submitted', to_status: 'Submitted', actor_user: null, actor_role: 'Form Creator / Internal Reviewer', diff: { changed: [] }, created_at: '2026-10-29T07:14:00Z', ...o,
  });

  it('status moves read "Action → Status"; field changes list labels, never values', () => {
    const items = entryTimeline([
      ev({ id: '3', action: 'SetStatus', from_status: 'APPROVAL', to_status: 'APPROVED EMAILED', actor_user: 'u1' }),
      ev({ id: '2', diff: { changed: ['InspectedByName', 'checklist'], before: { InspectedByName: 'Secret Value' }, after: 'Other Secret' } }),
      ev({ id: '1', action: 'SubmitInspection', from_status: null, to_status: 'Submitted', actor_role: 'Inspector' }),
    ], { names: { u1: 'Test Admin' }, labels: fieldLabels(insp) });
    expect(items[0]).toMatchObject({ who: 'Test Admin', what: 'SetStatus → APPROVED EMAILED', tone: 'green' });
    expect(items[2]).toMatchObject({ who: 'Inspector', what: 'SubmitInspection → Submitted', tone: 'teal' });
    const text = timelineText(items[1]);
    expect(text).toContain('Checklist');
    expect(text).not.toContain('Secret');
    expect(JSON.stringify(items)).not.toContain('Secret');
  });
});

describe('files, PDFs and Store Room shortfall', () => {
  it('formats files with type, size and field label', () => {
    const dn = spec('delivery-note');
    const rows = fileRows(dn, [
      { id: 'b', fieldKey: 'NATIS', kind: 'file', fileName: 'natis.pdf', contentType: 'application/pdf', sizeBytes: 2048 },
      { id: 'a', fieldKey: 'COPYOfSignatoryID', kind: 'file', fileName: 'scan', contentType: 'image/jpeg', sizeBytes: 1_887_437 },
      { id: 'c', fieldKey: 'Signature', kind: 'signature', fileName: 'Signature.png', contentType: 'image/png', sizeBytes: 500 },
      { id: 'd', fieldKey: 'x', kind: 'document', fileName: 'doc.pdf', contentType: 'application/pdf', sizeBytes: 1 },
    ]);
    // Spec field order: the signatory ID copy comes before NATIS.
    expect(rows.findIndex((r) => r.id === 'a')).toBeLessThan(rows.findIndex((r) => r.id === 'b'));
    expect(rows.find((r) => r.id === 'a')).toMatchObject({ ext: 'JPG', meta: expect.stringMatching(/^1\.8 MB · COPY of Signatory ID/) });
    expect(rows.find((r) => r.id === 'c')?.meta).toMatch(/signature/);
    expect(rows.some((r) => r.id === 'd')).toBe(false);
    expect(formatBytes(24 * 1024)).toBe('24 KB');
    expect(formatBytes(null)).toBe('');
    expect(extOf('photo.jpeg', null)).toBe('JPG');
    expect(extOf('blob', null)).toBe('FILE');
  });

  it('numbers PDF versions per template and truncates sha256', () => {
    const sha = (c: string) => c.repeat(64);
    const v = pdfVersions([
      { id: '2', template_number: 1, name: 'b.pdf', sha256: sha('b'), created_at: '2026-10-29T08:00:00Z' },
      { id: '1', template_number: 1, name: 'a.pdf', sha256: 'c80d' + '0'.repeat(56) + '5b19', created_at: '2026-10-29T07:00:00Z' },
      { id: '3', template_number: 3, name: 'c.pdf', sha256: sha('c'), created_at: '2026-10-29T09:00:00Z' },
    ], [{ number: 1, label: 'Entry PDF' }]);
    expect(v.map((x) => [x.id, x.v, x.templateLabel])).toEqual([['3', 'v1', 'Document 3'], ['2', 'v2', 'Entry PDF'], ['1', 'v1', 'Entry PDF']]);
    expect(v[2].hash).toBe('c80d…5b19');
    expect(shortHash('nothex')).toBe('');
  });

  it('lists Store Room counts below the minimum in their label', () => {
    const sr = spec('store-room');
    const low = belowMinimum(sr, { _14INCX5HoleTIRESMIN50: '3', _13INCH4HOLETIRESMIN10: '12', _1450455HOLEBRAKEDMOQ12: '', OTHER: 'note' });
    expect(low).toEqual([{ name: '_14INCX5HoleTIRESMIN50', label: '14INC x 5 hole TIRES MIN 50', value: 3, min: 50, short: 47 }]);
    expect(belowMinimum(spec('job-card'), { Line1: '1' })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildEmail, entryDetailRows, fillTokens, resolveRecipients } from '@/lib/workflow/email-template';
import { actionPermission, allowedActions, findAction, internalRole, isTask, manualStatuses, publicRole, taskStatuses } from '@/lib/workflow/rules';
import { spec } from './specs';

const REVIEWER = 'Form Creator / Internal Reviewer';

describe('workflow rules', () => {
  it('inspection runs Incomplete -> Submitted -> Reviewed -> Approved by role', () => {
    const sp = spec('trailer-inspection-checklist');
    expect(publicRole(sp).name).toBe('Inspector');
    expect(internalRole(sp).name).toBe(REVIEWER);
    expect(allowedActions(sp, 'Incomplete', 'Inspector').map((a) => a.name)).toEqual(['SubmitInspection']);
    expect(allowedActions(sp, 'Incomplete', REVIEWER).map((a) => a.name)).toEqual([]);
    expect(allowedActions(sp, 'Submitted', REVIEWER).map((a) => a.name)).toEqual(['RequestReviewChanges', 'MarkReviewed']);
    expect(allowedActions(sp, 'Submitted', 'Inspector')).toEqual([]);
    expect(allowedActions(sp, 'Reviewed', REVIEWER).map((a) => a.name)).toEqual(['ApproveInspection']);
    expect(allowedActions(sp, 'Approved', REVIEWER)).toEqual([]);
    // Cognito behaviour kept on purpose: requesting changes leaves the status at Submitted.
    expect(findAction(sp, 'RequestReviewChanges')!.newStatus).toBe('Submitted');
  });

  it('generic forms: public Submit on new entries, internal Update afterwards', () => {
    const sp = spec('job-card');
    expect(allowedActions(sp, 'Incomplete', 'Public').map((a) => a.name)).toEqual(['Submit']);
    expect(allowedActions(sp, 'Submitted', 'Internal').map((a) => a.name)).toEqual(['Update']);
  });

  it('tasks: inspections waiting on review/approval and store room APPROVAL', () => {
    expect(taskStatuses(spec('trailer-inspection-checklist'))).toEqual(['Submitted', 'Reviewed']);
    expect(taskStatuses(spec('store-room'))).toEqual(['APPROVAL']);
    expect(taskStatuses(spec('deal'))).toEqual([]);
    expect(isTask(spec('job-card'), 'Submitted')).toBe(false);
  });

  it('store room submit moves to APPROVAL; staff may set APPROVED EMAILED by hand', () => {
    const sp = spec('store-room');
    expect(findAction(sp, 'Submit')!.newStatus).toBe('APPROVAL');
    expect(manualStatuses(sp)).toEqual(['APPROVAL', 'APPROVED EMAILED']);
  });

  it('review and approve steps need the reviewer permissions', () => {
    const sp = spec('trailer-inspection-checklist');
    expect(actionPermission(findAction(sp, 'MarkReviewed')!)).toBe('entries.review');
    expect(actionPermission(findAction(sp, 'RequestReviewChanges')!)).toBe('entries.review');
    expect(actionPermission(findAction(sp, 'ApproveInspection')!)).toBe('entries.approve');
    expect(actionPermission(findAction(spec('deal'), 'Update')!)).toBe('entries.write');
  });
});

describe('emails', () => {
  const base = { entryNumber: 7, status: 'Submitted', adminLink: 'https://app.example.invalid/admin/forms/x/entries/7' };

  it('configured inboxes replace literal spec addresses; field tokens resolve from the entry', () => {
    const sp = spec('trailer-inspection-checklist');
    const submit = findAction(sp, 'SubmitInspection')!.emails[0];
    expect(resolveRecipients(submit, {}, ['inbox@example.invalid'])).toEqual(['inbox@example.invalid']);
    expect(resolveRecipients(submit, {}, [])).toEqual([]);
    const reviewed = findAction(sp, 'MarkReviewed')!.emails[0];
    expect(resolveRecipients(reviewed, { InspectorEmail: 'inspector@example.invalid' }, ['ignored@example.invalid'])).toEqual(['inspector@example.invalid']);
    expect(resolveRecipients(reviewed, { InspectorEmail: 'not an email' }, [])).toEqual([]);
  });

  it('fills tokens and escapes values in HTML', () => {
    expect(fillTokens('<a href="[Entry.AdminLink]">#[Entry.Number]</a> [VINNO]', { ...base, data: { VINNO: '<b>x</b>' } }, true)).toBe(
      `<a href="${base.adminLink}">#7</a> &lt;b&gt;x&lt;/b&gt;`,
    );
  });

  it('entry details mask protected fields and never name files', () => {
    const list = entryDetailRows(spec('delivery-note'), { Email: 'c@example.invalid', TrailerVinNO: 'V1' }, { NATIS: 2, Signature: 1 });
    const rows = Object.fromEntries(list);
    expect(rows.Email).toBe('(protected)');
    expect(rows.NATIS).toBe('2 files');
    // Four delivery-note signatures share the label "Signature" (kept from Cognito); only one is signed here.
    expect(list.filter(([k]) => k === 'Signature').map(([, v]) => v)).toEqual(['', 'Signed', '', '']);
    expect(rows['Trailer Vin NO']).toBe('V1');
  });

  it('builds the inspection submitted email with the reviewer link and details', () => {
    const sp = spec('trailer-inspection-checklist');
    const e = buildEmail(findAction(sp, 'SubmitInspection')!.emails[0], 'SubmitInspection', {
      ...base, spec: sp, data: { InspectedByName: { First: 'Test', Last: 'Inspector' } }, configuredRecipients: ['inbox@example.invalid'],
      fileCounts: {}, roleLink: 'https://app.example.invalid/admin/forms/trailer-inspection-checklist/entries/7',
    });
    expect(e.subject).toBe('Trailer Inspection Submitted');
    expect(e.to).toEqual(['inbox@example.invalid']);
    expect(e.html).toContain('Open the entry');
    expect(e.text).toContain('Inspected By (Name): Test Inspector');
    expect(e.replyTo).toBe('sales@fueltrailers.co.za');
  });

  it('default subject when the spec has none', () => {
    const sp = spec('store-room');
    const e = buildEmail(findAction(sp, 'Submit')!.emails[0], 'Submit', { ...base, spec: sp, data: {}, configuredRecipients: ['f@example.invalid'], fileCounts: {} });
    expect(e.subject).toBe('STORE ROOM - Entry #7 (Submit)');
    expect(e.html).toContain(base.adminLink);
  });
});

// M8 Part B: pure builder rules (names, slugs, layout, palette, workflow, guards, import). Synthetic data only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fieldNameFromLabel, slugFromName, slugProblem } from '@/lib/forms/builder/names';
import { fromItems, move, setWidth, toItems, widthOf } from '@/lib/forms/builder/layout';
import { compatibleType, newField, PALETTE } from '@/lib/forms/builder/palette';
import { blankSpec, changeProblems, duplicateSpec, fieldsWithData, importSpec, specProblems, summaryFields, summaryFrom } from '@/lib/forms/builder/spec';
import { allowedWhenFor, readAllowedWhen, workflowProblems, workflowTemplate } from '@/lib/forms/builder/workflow';
import { parseAllowedWhen } from '@/lib/spec/expressions';
import { present } from '@/lib/spec/presentation';
import { inputFields, parseSpec, type FormSpec } from '@/lib/spec/types';
import { allowedActions, publicRole } from '@/lib/workflow/rules';
import { SLUGS, spec as kitSpec } from './specs';

const RAW = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/m8/engine-types.json'), 'utf8'));
const S: FormSpec = parseSpec(RAW);

describe('names and slugs', () => {
  it('field names come from labels once, unique', () => {
    expect(fieldNameFromLabel('Customer phone no.', [])).toBe('CustomerPhoneNo');
    expect(fieldNameFromLabel('Customer phone no.', ['CustomerPhoneNo'])).toBe('CustomerPhoneNo2');
    expect(fieldNameFromLabel('1st deposit', [])).toBe('F1stDeposit');
    expect(fieldNameFromLabel('???', [])).toBe('Field');
    expect(fieldNameFromLabel('Ünïcode wörd', [])).toBe('UnicodeWord');
  });

  it('slugs: lower-case, unique, never reserved', () => {
    expect(slugFromName('Site Visit Report!', [])).toBe('site-visit-report');
    expect(slugFromName('Site visit report', ['site-visit-report'])).toBe('site-visit-report-2');
    expect(slugFromName('New', [])).toBe('new-form');
    expect(slugFromName('Import', [])).toBe('import-form');
    expect(slugFromName('***', [])).toBe('form');
    expect(slugProblem('design', [])).toMatch(/reserved/);
    expect(slugProblem('Bad Slug', [])).toMatch(/lower-case/);
    expect(slugProblem('deal', ['deal'])).toMatch(/already/);
    expect(slugProblem('site-visit', [])).toBeNull();
  });
});

describe('layout', () => {
  it('round-trips the spec layout (same row, widths, page breaks)', () => {
    const items = toItems(S.fields);
    expect(items.find((i) => 'name' in i.field && i.field.name === 'Ref')!.sameRow).toBe(true);
    const back = fromItems(items);
    const pos = (fs: typeof S.fields) => fs.map((f) => ['name' in f ? f.name : f.type, f.row, 'col' in f ? f.col : null, 'span' in f ? f.span ?? 24 : null]);
    const again = fromItems(toItems(back));
    expect(pos(again)).toEqual(pos(back));
    expect(back.find((f) => f.type === 'pagebreak')!.row).toBeGreaterThan(back.find((f) => 'name' in f && f.name === 'RedNote')!.row);
  });

  it('same row only when it fits; reorder; widths', () => {
    const a = setWidth(newField('text', []), 'half');
    const b = setWidth(newField('text', ['Text']), 'half');
    const c = setWidth(newField('text', ['Text', 'Text2']), 'third');
    const f = fromItems([{ field: a, sameRow: false }, { field: b, sameRow: true }, { field: c, sameRow: true }]);
    expect(f.map((x) => [x.row, 'col' in x ? x.col : 0])).toEqual([[1, 1], [1, 13], [2, 1]]);
    expect(widthOf(f[2])).toBe('third');
    expect(move(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(move(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});

describe('palette', () => {
  it('every palette type makes a field the spec accepts, with unique names', () => {
    const fields = [];
    const taken: string[] = [];
    for (const p of PALETTE) {
      const f = newField(p.type, taken, { form: 'request-for-invoice', field: 'QuoteNo' });
      if ('name' in f) taken.push(f.name);
      fields.push(f);
    }
    const spec = { ...blankSpec({ name: 'All types', slug: 'all-types' }), fields: fromItems(fields.map((field) => ({ field, sameRow: false }))) };
    expect(() => parseSpec(spec)).not.toThrow();
    expect(new Set(taken).size).toBe(taken.length);
    expect(PALETTE.map((p) => p.type)).not.toContain('table');
  });

  it('type changes with data: only to text/textarea from string types', () => {
    expect(compatibleType('email', 'text')).toBe(true);
    expect(compatibleType('text', 'textarea')).toBe(true);
    expect(compatibleType('text', 'number')).toBe(false);
    expect(compatibleType('phone', 'text')).toBe(false);
  });
});

describe('workflow', () => {
  it('templates are valid and start entries', () => {
    for (const t of ['public-submit', 'internal-only'] as const) expect(workflowProblems(workflowTemplate(t))).toEqual([]);
    const spec = { ...blankSpec({ name: 'X', slug: 'x', template: 'internal-only' }) };
    expect(allowedActions(spec, 'Incomplete', publicRole(spec).name)).toEqual([]);
    expect(allowedActions(spec, 'Incomplete', 'Internal').map((a) => a.name)).toEqual(['Submit']);
  });

  it('"allowed when status is one of" round-trips and runs', () => {
    const e = allowedWhenFor({ statuses: ['Submitted', 'Reviewed'], role: 'Internal' });
    expect(e).toBe("status in ('Submitted', 'Reviewed') AND role == 'Internal'");
    expect(parseAllowedWhen(e)({ status: 'Reviewed', role: 'Internal' })).toBe(true);
    expect(parseAllowedWhen(e)({ status: 'Incomplete', role: 'Internal' })).toBe(false);
    expect(readAllowedWhen(e, [])).toEqual({ statuses: ['Submitted', 'Reviewed'], role: 'Internal' });
    expect(readAllowedWhen("status != 'Incomplete'", ['Incomplete', 'Submitted'])).toEqual({ statuses: ['Submitted'], role: null });
    expect(allowedWhenFor({ statuses: null, role: null })).toBe('always');
    expect(readAllowedWhen('nonsense', [])).toBeNull();
    // Every kit allowedWhen is readable by the editor.
    for (const s of SLUGS) for (const a of kitSpec(s).workflow.actions) expect(readAllowedWhen(a.allowedWhen, kitSpec(s).workflow.statuses.map((x) => x.name))).not.toBeNull();
  });

  it('problems: missing Incomplete, roles, unknown new status, no starting action', () => {
    const w = workflowTemplate('public-submit');
    expect(workflowProblems({ ...w, statuses: w.statuses.filter((s) => s.name !== 'Incomplete') })).toContain('The workflow needs the "Incomplete" status (new entries start there).');
    expect(workflowProblems({ ...w, roles: w.roles.filter((r) => !r.public) })).toContain('The workflow needs exactly one public role.');
    expect(workflowProblems({ ...w, actions: [{ ...w.actions[0], newStatus: 'Nope' }] }).join()).toMatch(/unknown status "Nope"/);
    expect(workflowProblems({ ...w, actions: [w.actions[1]] }).join()).toMatch(/No action can start/);
    for (const s of SLUGS) expect(workflowProblems(kitSpec(s).workflow)).toEqual([]);
  });
});

describe('specs: blank, duplicate, import, publish rules', () => {
  it('blank forms are builder forms: cognitoFormId 0, exact layout', () => {
    const b = blankSpec({ name: 'Site visit', slug: 'site-visit', encrypt: true });
    expect(b).toMatchObject({ cognitoFormId: 0, settings: { layout: 'exact', encryptEntries: true } });
    expect(specProblems(b, 'site-visit').problems).toEqual([]);
  });

  it('exact layout is not packed by the presentation layer (author widths win)', () => {
    const fields = fromItems([
      { field: setWidth(newField('text', []), 'half'), sameRow: false },
      { field: setWidth(newField('text', ['Text']), 'half'), sameRow: false },
    ]);
    const exact = { ...blankSpec({ name: 'X', slug: 'x' }), fields };
    expect(present(exact)[0].sections[0].rows.map((r) => r.cells.length)).toEqual([1, 1]);
    const packed = { ...exact, settings: { ...exact.settings, layout: undefined } };
    expect(present(packed)[0].sections[0].rows.map((r) => r.cells.length)).toEqual([2]);
  });

  it('duplicate copies the spec under a new slug, without Cognito ids', () => {
    const d = duplicateSpec(kitSpec('job-card'), { name: 'Job card copy', slug: 'job-card-copy' });
    expect(d).toMatchObject({ slug: 'job-card-copy', name: 'Job card copy', cognitoFormId: 0 });
    expect(inputFields(d).map((f) => f.name)).toEqual(inputFields(kitSpec('job-card')).map((f) => f.name));
  });

  it('import: exported JSON round-trips; bad JSON and bad specs are refused with reasons', () => {
    const r = importSpec(JSON.stringify(S), { slug: 'engine-copy', name: 'Engine copy' });
    expect('spec' in r && r.spec).toMatchObject({ slug: 'engine-copy', name: 'Engine copy', cognitoFormId: 0 });
    expect(importSpec('{nope', { slug: 'x' })).toEqual({ errors: ['The file is not valid JSON.'] });
    const bad = importSpec(JSON.stringify({ ...S, fields: [{ type: 'text' }] }), { slug: 'x' });
    expect('errors' in bad && bad.errors.length).toBeGreaterThan(0);
    for (const s of SLUGS) expect('spec' in importSpec(JSON.stringify(kitSpec(s)), { slug: `${s}-copy` })).toBe(true);
  });

  it('publish rules: slug fixed, unique names, valid summary tokens, lookups chosen', () => {
    expect(specProblems(S, 'other').problems).toContain('The slug of a form cannot change.');
    const dup = { ...S, fields: [...S.fields, { ...S.fields[1] }] };
    expect(specProblems(dup, S.slug).problems.join()).toMatch(/unique: Title/);
    expect(specProblems({ ...S, settings: { ...S.settings, entrySummary: '[Nope]' } }, S.slug).problems.join()).toMatch(/unknown field \[Nope\]/);
    const lk = { ...S, fields: [...S.fields, { ...newField('lookup', ['x']), row: 99 }] };
    expect(specProblems(lk, S.slug).problems.join()).toMatch(/choose the form and field/);
    expect(specProblems({ nope: 1 }, 'x').problems.length).toBeGreaterThan(0);
    expect(summaryFields(summaryFrom(['A', 'B']))).toEqual(['A', 'B']);
  });

  it('guards: no delete/rename/incompatible type change of a field with data; encryption fixed once entries exist', () => {
    const ctx = { withData: new Set(['Title', 'Phone', 'Extras']), hasEntries: true, encrypted: false };
    const without = { ...S, fields: S.fields.filter((f) => !('name' in f) || f.name !== 'Title') };
    expect(changeProblems(S, without, ctx).join()).toMatch(/"Title" \(Title\) has data: it cannot be deleted or renamed/);
    const renamed = { ...S, fields: S.fields.map((f) => ('name' in f && f.name === 'Title' ? { ...f, name: 'Heading' } : f)) };
    expect(changeProblems(S, renamed, ctx).join()).toMatch(/cannot be deleted or renamed/);
    const retyped = { ...S, fields: S.fields.map((f) => ('name' in f && f.name === 'Phone' ? { ...f, type: 'number' } : f)) } as FormSpec;
    expect(changeProblems(S, retyped, ctx).join()).toMatch(/type cannot change from phone to number/);
    const single = { ...S, fields: S.fields.map((f) => (f.type === 'choice' && f.name === 'Extras' ? { ...f, multi: false, style: 'radio' as const } : f)) };
    expect(changeProblems(S, single, ctx).join()).toMatch(/several choices to one/);
    // A field without data can go; relabel and reorder are fine.
    const ok = { ...S, fields: S.fields.filter((f) => !('name' in f) || f.name !== 'Notes').map((f) => ('name' in f && f.name === 'Title' ? { ...f, label: 'New label', row: 50 } : f)) };
    expect(changeProblems(S, ok, ctx)).toEqual([]);
    expect(changeProblems(S, { ...S, settings: { ...S.settings, encryptEntries: true } }, ctx).join()).toMatch(/only be turned on before the first entry/);
    expect(changeProblems({ ...S, settings: { ...S.settings, encryptEntries: true } }, S, { ...ctx, encrypted: true }).join()).toMatch(/cannot be turned off/);
    expect(changeProblems(S, { ...S, settings: { ...S.settings, encryptEntries: true } }, { ...ctx, hasEntries: false })).toEqual([]);
  });

  it('fieldsWithData: data keys, file keys, the checklist; every field of an encrypted form with entries', () => {
    expect(fieldsWithData(S, ['Title', 'Photo', 'Unknown'], { encrypted: false, hasEntries: true })).toEqual(new Set(['Title']));
    const cl = kitSpec('trailer-inspection-checklist');
    const section = inputFields(cl).find((f) => f.type === 'section')!.name;
    expect(fieldsWithData(cl, ['checklist'], { encrypted: false, hasEntries: true }).has(section)).toBe(true);
    expect(fieldsWithData(S, [], { encrypted: true, hasEntries: true }).size).toBe(inputFields(S).length);
  });
});

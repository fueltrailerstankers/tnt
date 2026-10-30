// Spec assembly and the publish rules of the builder. Pure.
import { ZodError } from 'zod';
import { parseShowWhen } from '@/lib/spec/expressions';
import { normaliseUrl } from '@/lib/spec/values';
import { FormSpec, inputFields, parseSpec, type FieldSpec } from '@/lib/spec/types';
import { isChecklistSection } from '@/lib/spec/visibility';
import { FIELD_NAME_RE } from './names';
import { compatibleType } from './palette';
import { workflowProblems, workflowTemplate, type WorkflowTemplate } from './workflow';

export interface NewFormOptions {
  name: string;
  slug: string;
  encrypt?: boolean;
  template?: WorkflowTemplate;
}

/** A new blank form: no fields yet, a workflow template, the entry PDF on, the author's layout kept exactly. */
export function blankSpec(o: NewFormOptions): FormSpec {
  return {
    slug: o.slug, cognitoFormId: 0, name: o.name, internalName: o.name.replace(/[^A-Za-z0-9]/g, '') || 'Form', entryCountAtExport: null,
    settings: { entrySummary: '', encryptEntries: o.encrypt ? true : undefined, layout: 'exact' },
    fields: [],
    workflow: workflowTemplate(o.template ?? 'public-submit'),
    documents: [{ number: 1, mode: 'view', output: 'pdf', includeTitle: true, includeLogo: true }],
  };
}

/** A copy of an existing spec under a new name and slug (no entries are copied; Cognito ids dropped). */
export function duplicateSpec(src: FormSpec, o: { name: string; slug: string }): FormSpec {
  const copy = structuredClone(src);
  return { ...copy, slug: o.slug, name: o.name, internalName: o.name.replace(/[^A-Za-z0-9]/g, '') || copy.internalName, cognitoFormId: 0, entryCountAtExport: null };
}

/** Human-readable zod issues ("fields.3.showWhen: ..."), first few only. */
export function issues(e: unknown, max = 8): string[] {
  if (e instanceof ZodError) return e.issues.slice(0, max).map((i) => `${i.path.join('.') || 'spec'}: ${i.message}`);
  return [e instanceof Error ? e.message : 'The form definition is not valid.'];
}

/** Parses an uploaded FormSpec JSON (exported here or from the kit). The slug and name are the caller's. */
export function importSpec(text: string, o: { name?: string; slug: string }): { spec: FormSpec } | { errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { errors: ['The file is not valid JSON.'] };
  }
  if (!raw || typeof raw !== 'object') return { errors: ['The file is not a form definition.'] };
  const r = raw as Record<string, unknown>;
  const candidate = { ...r, slug: o.slug, name: o.name?.trim() || r.name, cognitoFormId: 0, entryCountAtExport: null };
  const parsed = FormSpec.safeParse(candidate);
  if (!parsed.success) return { errors: issues(parsed.error) };
  return { spec: parsed.data };
}

/** Names of the fields that hold data, from form_data_keys (data keys + file field keys). */
export function fieldsWithData(spec: FormSpec, keys: Iterable<string>, opts: { encrypted: boolean; hasEntries: boolean }): Set<string> {
  const set = new Set(keys);
  const out = new Set<string>();
  for (const f of inputFields(spec)) {
    if (opts.encrypted && opts.hasEntries) out.add(f.name); // data is sealed: assume every field holds some
    else if (set.has(f.name) || (isChecklistSection(f) && set.has('checklist'))) out.add(f.name);
  }
  return out;
}

export interface ChangeContext {
  /** Field names of the published spec that hold data in some entry. */
  withData: Set<string>;
  hasEntries: boolean;
  /** forms.encrypt_entries now. */
  encrypted: boolean;
}

/** Guards between the published spec and the next one. Empty when the change is safe. */
export function changeProblems(prev: FormSpec, next: FormSpec, ctx: ChangeContext): string[] {
  const out: string[] = [];
  const nextBy = new Map(inputFields(next).map((f) => [f.name, f]));
  for (const f of inputFields(prev)) {
    if (!ctx.withData.has(f.name)) continue;
    const n = nextBy.get(f.name);
    if (!n) {
      out.push(`"${f.label.trim() || f.name}" (${f.name}) has data: it cannot be deleted or renamed. Make it internal only or read only instead.`);
      continue;
    }
    if (!compatibleType(f.type, n.type)) out.push(`"${f.label.trim() || f.name}" has data: its type cannot change from ${f.type} to ${n.type}.`);
    else if (f.type === 'choice' && n.type === 'choice' && f.multi && !n.multi) out.push(`"${f.label.trim() || f.name}" has data: it cannot change from several choices to one.`);
    else if ((f.type === 'name' || f.type === 'address') && (n.type === 'name' || n.type === 'address')) {
      const gone = f.parts.filter((x) => !n.parts.includes(x));
      if (gone.length) out.push(`"${f.label.trim() || f.name}" has data: its parts cannot be removed (${gone.join(', ')}).`);
    }
  }
  if (ctx.hasEntries && !!next.settings.encryptEntries !== ctx.encrypted) {
    out.push(ctx.encrypted ? 'Encryption cannot be turned off once the form has entries.' : 'Encryption can only be turned on before the first entry.');
  }
  return out;
}

/** Fields of other forms a lookup may show: source slug -> field names. */
export type LookupSources = Map<string, Set<string>>;

/** Forms that are always encrypted (the kit's DEAL and Delivery Note; also enforced in the database, 0022). */
export const ALWAYS_ENCRYPTED = new Set(['deal', 'delivery-note']);

/** Builder rules on top of parseSpec: field names, a public/internal workflow, the form's own slug. */
export function specProblems(next: unknown, slug: string, sources?: LookupSources): { spec?: FormSpec; problems: string[] } {
  let spec: FormSpec;
  try {
    spec = parseSpec(next);
  } catch (e) {
    return { problems: issues(e) };
  }
  const problems: string[] = [];
  if (spec.slug !== slug) problems.push('The slug of a form cannot change.');
  const names = inputFields(spec).map((f) => f.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) problems.push(`Field names must be unique: ${[...new Set(dupes)].join(', ')}.`);
  for (const n of names) if (!FIELD_NAME_RE.test(n) || n === 'checklist') problems.push(`"${n}" is not a valid field name.`);
  if (!spec.name.trim()) problems.push('The form needs a name.');
  for (const f of spec.fields) {
    if (f.type === 'choice' && new Set(f.options).size !== f.options.length) problems.push(`"${f.label}": options must be unique.`);
    if (f.type === 'choice' && f.options.some((o) => !o.trim() || o === '__other__')) problems.push(`"${f.label}": options cannot be empty.`);
    if (f.type === 'url' && f.default && !normaliseUrl(f.default)) problems.push(`"${f.label}": the default must be an https:// link.`);
    if (f.type === 'lookup') {
      if (!f.lookup.sourceForm || !f.lookup.displayField) problems.push(`"${f.label}": choose the form and field to look up.`);
      else if (!FIELD_NAME_RE.test(f.lookup.displayField) || (sources && !sources.get(f.lookup.sourceForm)?.has(f.lookup.displayField))) {
        problems.push(`"${f.label}": the field to show is not a field of the chosen form.`);
      }
    }
  }
  // A field the public sees may not depend on an internal-only field (its rule would expose it).
  const internal = new Set(inputFields(spec).filter((f) => 'internalOnly' in f && f.internalOnly).map((f) => f.name));
  for (const f of spec.fields) {
    if (!('showWhen' in f) || !f.showWhen || ('internalOnly' in f && f.internalOnly)) continue;
    const refs = parseShowWhen(f.showWhen).fields.filter((n) => internal.has(n));
    if (refs.length) problems.push(`"${'label' in f ? f.label : f.type}": a show-when rule of a public field cannot use the internal-only field ${refs[0]}.`);
  }
  if (ALWAYS_ENCRYPTED.has(spec.slug) && !spec.settings.encryptEntries) problems.push('This form is always encrypted.');
  const tokens = [...spec.settings.entrySummary.matchAll(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g)].map((m) => m[1]);
  for (const t of tokens) if (!names.includes(t)) problems.push(`The entry summary uses an unknown field [${t}].`);
  problems.push(...workflowProblems(spec.workflow));
  return { spec, problems };
}

/** Entry summary template from picked field names: "[A] [B]". */
export function summaryFrom(names: string[]): string {
  return names.map((n) => `[${n}]`).join(' ');
}

/** Field names an entry summary uses. */
export function summaryFields(template: string): string[] {
  return [...template.matchAll(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g)].map((m) => m[1]);
}

export type { FieldSpec };

// FormSpec: the shape of docs/source/tt-forms/spec/forms/*.json (seeded into forms.spec).
// Parsed strictly enough that a spec change the engine cannot handle fails loudly in tests.
// Field `name` is the Cognito FieldName and the key in entries.data. Never rename it.
import { z } from 'zod';
import { showWhenProblems } from './visibility';

const grid = { row: z.number().int().positive(), col: z.number().int().min(1).max(24).optional(), span: z.number().int().min(1).max(24).optional() };
const named = { name: z.string().min(1), label: z.string(), note: z.string().optional(), hideLabel: z.boolean().optional() };

const customError = z.object({ when: z.string(), cognitoExpr: z.string().optional(), message: z.string() });

// --- M8 options -------------------------------------------------------------------------------------
// All optional, so the kit specs parse and behave exactly as before. `note` stays an implementer's note
// (never shown); `help` is the text under the field.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Options every input field accepts. */
const common = {
  /** Validated server-side in validateEntry (and client-side by the renderer). */
  required: z.boolean().optional(),
  help: z.string().optional(),
  /** Shown but not editable by the public role (server keeps the saved or default value). */
  readOnly: z.boolean().optional(),
  /** Not on the public form at all; staff only (server keeps the saved or default value). */
  internalOnly: z.boolean().optional(),
  /** Show-when rule (lib/spec/expressions parseShowWhen). Hidden fields are neither validated nor saved. */
  showWhen: z.string().optional(),
};
const placeholder = { placeholder: z.string().optional() };
const lengths = { minLength: z.number().int().min(0).optional(), maxLength: z.number().int().positive().optional() };
const numRange = { min: z.number().optional(), max: z.number().optional() };
const isoDate = z.string().regex(DATE_RE);
const hhmm = z.string().regex(TIME_RE);
const currencyCode = z.string().regex(/^[A-Z]{3}$/);

/** Text pattern presets: letters/numbers (and spaces) only, or stored in upper case. */
export const TEXT_PATTERNS = ['none', 'alphanumeric', 'uppercase'] as const;

export const TextField = z.object({
  ...grid, ...named, ...common, ...placeholder, ...lengths, type: z.literal('text'), customError: customError.optional(),
  default: z.string().optional(), pattern: z.enum(TEXT_PATTERNS).optional(),
});
export const TextareaField = z.object({
  ...grid, ...named, ...common, ...placeholder, ...lengths, type: z.literal('textarea'),
  default: z.string().optional(), rows: z.number().int().min(1).max(30).optional(),
});
export const EmailField = z.object({
  ...grid, ...named, ...common, ...placeholder, type: z.literal('email'),
  default: z.string().optional(), protected: z.boolean().optional(),
});
// default 'today': pre-filled with today's date in the org timezone on a new entry; still editable.
export const DateField = z.object({
  ...grid, ...named, ...common, type: z.literal('date'),
  default: z.union([z.literal('today'), isoDate]).optional(), min: isoDate.optional(), max: isoDate.optional(),
});
export const NumberField = z.object({
  ...grid, ...named, ...common, ...placeholder, ...numRange, type: z.literal('number'),
  integer: z.boolean().optional(), decimals: z.number().int().optional(), default: z.number().optional(),
});
export const ChoiceField = z.object({
  ...grid, ...named, ...common, type: z.literal('choice'),
  style: z.enum(['dropdown', 'checkboxes', 'radio']), multi: z.boolean().optional(),
  options: z.array(z.string()).min(1), default: z.string().optional(),
  /** Adds an "Other" option with a free-text box; the typed text is stored as the value. */
  other: z.boolean().optional(),
});
export const FileField = z.object({
  ...grid, ...named, ...common, type: z.literal('file'),
  multi: z.boolean().optional(), maxFiles: z.number().int().positive().optional(), accept: z.string().optional(),
  customError: customError.optional(),
});
export const SignatureField = z.object({ ...grid, ...named, ...common, type: z.literal('signature'), mode: z.literal('draw').optional(), purpose: z.string().optional() });
export const NameField = z.object({ ...grid, ...named, ...common, type: z.literal('name'), parts: z.array(z.string()) });
export const AddressField = z.object({ ...grid, ...named, ...common, type: z.literal('address'), parts: z.array(z.string()) });
export const LookupField = z.object({
  ...grid, ...named, ...common, type: z.literal('lookup'), style: z.literal('dropdown'),
  lookup: z.object({ sourceForm: z.string(), displayField: z.string(), cognitoSourceFormId: z.number().optional(), note: z.string().optional() }),
});
// Delivery Note "table": rebuilt as a read-only customer panel for the looked-up RFI entry.
export const TableField = z.object({
  ...grid, name: z.string(), label: z.string(), type: z.literal('table'),
  columns: z.array(z.unknown()), rebuildAs: z.string().optional(), cognitoFieldName: z.string().optional(), note: z.string().optional(),
});
// Two kinds of section: the inspection checklist (kit: has `children`, items come from spec.checklist) and
// the M8 heading (no `children`): title + optional description that groups the fields after it, up to the
// next heading or page break. A heading's showWhen hides its whole group.
export const SectionField = z.object({
  ...grid, ...named, type: z.literal('section'), children: z.unknown().optional(),
  description: z.string().optional(), showWhen: z.string().optional(),
});
export const ContentField = z.object({
  ...grid, type: z.literal('content'),
  contentRef: z.string().optional(), html: z.string().optional(), note: z.string().optional(), showWhen: z.string().optional(),
});
export const PageBreakField = z.object({
  row: z.number().int().positive(), type: z.literal('pagebreak'),
  nextButton: z.string(), pageTitle: z.string().optional(), showBackButton: z.boolean().optional(), backButton: z.string().optional(),
});

// --- M8 field types ---------------------------------------------------------------------------------
/** Stored as { phone: as typed, digits: digits only } so the grid search finds either form. 9-15 digits. */
export const PhoneField = z.object({ ...grid, ...named, ...common, ...placeholder, type: z.literal('phone'), default: z.string().optional() });
/** https links only. */
export const UrlField = z.object({ ...grid, ...named, ...common, ...placeholder, type: z.literal('url'), default: z.string().optional() });
/** Stored as { amount, currency } (non-negotiable 7). currency defaults to the org currency. */
export const CurrencyField = z.object({
  ...grid, ...named, ...common, ...placeholder, ...numRange, type: z.literal('currency'),
  currency: currencyCode.optional(), default: z.number().optional(),
});
/** Wall-clock HH:MM (org timezone). default 'now' = the current time in the org timezone. */
export const TimeField = z.object({
  ...grid, ...named, ...common, type: z.literal('time'),
  default: z.union([z.literal('now'), hhmm]).optional(), min: hhmm.optional(), max: hhmm.optional(),
});
/** Date and time entered and shown in the org timezone, stored as a UTC ISO instant. */
export const DateTimeField = z.object({ ...grid, ...named, ...common, type: z.literal('datetime'), default: z.literal('now').optional() });
/** Stored as true/false. radio (default): Yes/No, required = answered. toggle: a switch, required = must be Yes. */
export const YesNoField = z.object({
  ...grid, ...named, ...common, type: z.literal('yesno'),
  style: z.enum(['radio', 'toggle']).optional(), default: z.boolean().optional(),
});
/** 1-5, stored as an integer. */
export const RatingField = z.object({ ...grid, ...named, ...common, type: z.literal('rating'), default: z.number().int().min(1).max(5).optional() });

export const FieldSpec = z.discriminatedUnion('type', [
  TextField, TextareaField, EmailField, DateField, NumberField, ChoiceField, FileField, SignatureField,
  NameField, AddressField, LookupField, TableField, SectionField, ContentField, PageBreakField,
  PhoneField, UrlField, CurrencyField, TimeField, DateTimeField, YesNoField, RatingField,
]);
export type FieldSpec = z.infer<typeof FieldSpec>;
export type FieldType = FieldSpec['type'];
export type InputField = Exclude<FieldSpec, z.infer<typeof ContentField> | z.infer<typeof PageBreakField>>;
export type ContentField = z.infer<typeof ContentField>;
export type PageBreakField = z.infer<typeof PageBreakField>;
export type SectionField = z.infer<typeof SectionField>;
/** Input fields that hold a value in entries.data and take the M8 options (not tables or sections). */
export type ValueField = Exclude<InputField, z.infer<typeof TableField> | SectionField>;

const ChecklistItem = z.object({
  itemNo: z.number().int().positive(),
  label: z.string(),
  cognitoFieldSetId: z.string().optional(),
  fields: z.array(z.object({
    name: z.enum(['fail', 'pass', 'comments']), cognitoName: z.string(), label: z.string(),
    type: z.enum(['yesno', 'textarea']), style: z.string().optional(), row: z.number(), col: z.number(), span: z.number(),
  })),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

const Email = z.object({
  from: z.string().optional(),
  to: z.array(z.string()).min(1),
  subject: z.string().optional(),
  body: z.string().optional(),
  includeEntryDetails: z.boolean().optional(),
  includeReceipt: z.boolean().optional(),
  includeAttachments: z.boolean().optional(),
  includeDocumentAttachments: z.boolean().optional(),
  attachDocuments: z.array(z.number().int()).optional(),
  linkForRole: z.string().optional(),
});
export type EmailSpec = z.infer<typeof Email>;

const Action = z.object({
  id: z.number().int(),
  name: z.string(),
  button: z.string(),
  allowedWhen: z.string(),
  newStatus: z.string().optional(),
  confirmation: z.string().optional(),
  includeEntryDetails: z.boolean().optional(),
  emails: z.array(Email),
  note: z.string().optional(),
});
export type ActionSpec = z.infer<typeof Action>;

const Role = z.object({ id: z.number().int(), name: z.string(), public: z.boolean().optional(), internal: z.boolean().optional() });
export type RoleSpec = z.infer<typeof Role>;
const Status = z.object({
  id: z.number().int(), name: z.string(), color: z.string(),
  archived: z.boolean().optional(), replacedBy: z.string().optional(), note: z.string().optional(),
});
export type StatusSpec = z.infer<typeof Status>;

const DocumentSpec = z.object({
  number: z.number().int(),
  mode: z.enum(['view', 'edit', 'custom']),
  name: z.string().optional(),
  output: z.literal('pdf'),
  includeBlankFields: z.boolean().optional(),
  includeLogo: z.boolean().optional(),
  includeTitle: z.boolean().optional(),
  template: z.string().optional(),
  note: z.string().optional(),
});
export type DocumentSpec = z.infer<typeof DocumentSpec>;

/**
 * Slugs a form may never take: fixed route segments next to /admin/forms/<slug> (import is the in-app Cognito
 * import, new/design are the M8 builder) and a few kept for later. Add any new fixed segment here.
 */
export const RESERVED_FORM_SLUGS: ReadonlySet<string> = new Set([
  'import', 'new', 'design', 'create', 'settings', 'export', 'entries', 'versions', 'archive', 'archived', 'templates', 'builder',
]);

export function isReservedFormSlug(slug: string): boolean {
  return RESERVED_FORM_SLUGS.has(slug.trim().toLowerCase());
}

export const FormSpec = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).refine((s) => !isReservedFormSlug(s), { message: 'This slug is reserved for a page of the app.' }),
  cognitoFormId: z.number().int(),
  name: z.string(),
  internalName: z.string(),
  entryCountAtExport: z.number().int().nullable(),
  settings: z.object({
    entrySummary: z.string(),
    encryptEntries: z.boolean().optional(),
    progressBar: z.string().optional(),
    preventLookup: z.boolean().optional(),
    hasLookups: z.boolean().optional(),
    isLookupSourceFor: z.array(z.string()).optional(),
  }),
  fields: z.array(FieldSpec),
  workflow: z.object({ roles: z.array(Role), statuses: z.array(Status), actions: z.array(Action) }),
  documents: z.array(DocumentSpec),
  checklist: z.array(ChecklistItem).optional(),
}).superRefine((spec, ctx) => {
  // M8: a show-when rule must parse, name existing fields and not depend on itself (directly or not).
  for (const p of showWhenProblems(spec as FormSpec)) ctx.addIssue({ code: 'custom', path: ['fields', p.index, 'showWhen'], message: p.message });
});
export type FormSpec = z.infer<typeof FormSpec>;

export function parseSpec(raw: unknown): FormSpec {
  return FormSpec.parse(raw);
}

export function isInput(f: FieldSpec): f is InputField {
  return f.type !== 'content' && f.type !== 'pagebreak';
}

/** Fields whose values live in entry_files rather than entries.data. */
export function isFileLike(f: FieldSpec): boolean {
  return f.type === 'file' || f.type === 'signature';
}

export function inputFields(spec: FormSpec): InputField[] {
  return spec.fields.filter(isInput);
}

export function fieldByName(spec: FormSpec, name: string): InputField | undefined {
  return inputFields(spec).find((f) => f.name === name);
}

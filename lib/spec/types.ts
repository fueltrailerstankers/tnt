// FormSpec: the shape of docs/source/tt-forms/spec/forms/*.json (seeded into forms.spec).
// Parsed strictly enough that a spec change the engine cannot handle fails loudly in tests.
// Field `name` is the Cognito FieldName and the key in entries.data. Never rename it.
import { z } from 'zod';

const grid = { row: z.number().int().positive(), col: z.number().int().min(1).max(24).optional(), span: z.number().int().min(1).max(24).optional() };
const named = { name: z.string().min(1), label: z.string(), note: z.string().optional(), hideLabel: z.boolean().optional() };

const customError = z.object({ when: z.string(), cognitoExpr: z.string().optional(), message: z.string() });

export const TextField = z.object({ ...grid, ...named, type: z.literal('text'), customError: customError.optional() });
export const TextareaField = z.object({ ...grid, ...named, type: z.literal('textarea') });
export const EmailField = z.object({
  ...grid, ...named, type: z.literal('email'),
  required: z.boolean().optional(), default: z.string().optional(), protected: z.boolean().optional(),
});
export const DateField = z.object({ ...grid, ...named, type: z.literal('date') });
export const NumberField = z.object({ ...grid, ...named, type: z.literal('number'), integer: z.boolean().optional(), decimals: z.number().int().optional() });
export const ChoiceField = z.object({
  ...grid, ...named, type: z.literal('choice'),
  style: z.enum(['dropdown', 'checkboxes', 'radio']), multi: z.boolean().optional(),
  options: z.array(z.string()).min(1), default: z.string().optional(),
});
export const FileField = z.object({
  ...grid, ...named, type: z.literal('file'),
  multi: z.boolean().optional(), maxFiles: z.number().int().positive().optional(), accept: z.string().optional(),
  customError: customError.optional(),
});
export const SignatureField = z.object({ ...grid, ...named, type: z.literal('signature'), mode: z.literal('draw').optional(), purpose: z.string().optional() });
export const NameField = z.object({ ...grid, ...named, type: z.literal('name'), parts: z.array(z.string()), required: z.boolean().optional() });
export const AddressField = z.object({ ...grid, ...named, type: z.literal('address'), parts: z.array(z.string()) });
export const LookupField = z.object({
  ...grid, ...named, type: z.literal('lookup'), style: z.literal('dropdown'),
  lookup: z.object({ sourceForm: z.string(), displayField: z.string(), cognitoSourceFormId: z.number().optional(), note: z.string().optional() }),
});
// Delivery Note "table": rebuilt as a read-only customer panel for the looked-up RFI entry.
export const TableField = z.object({
  ...grid, name: z.string(), label: z.string(), type: z.literal('table'),
  columns: z.array(z.unknown()), rebuildAs: z.string().optional(), cognitoFieldName: z.string().optional(), note: z.string().optional(),
});
// Inspection checklist section. Its items come from spec.checklist.
export const SectionField = z.object({ ...grid, ...named, type: z.literal('section'), children: z.unknown().optional() });
export const ContentField = z.object({
  ...grid, type: z.literal('content'),
  contentRef: z.string().optional(), html: z.string().optional(), note: z.string().optional(),
});
export const PageBreakField = z.object({
  row: z.number().int().positive(), type: z.literal('pagebreak'),
  nextButton: z.string(), pageTitle: z.string().optional(), showBackButton: z.boolean().optional(), backButton: z.string().optional(),
});

export const FieldSpec = z.discriminatedUnion('type', [
  TextField, TextareaField, EmailField, DateField, NumberField, ChoiceField, FileField, SignatureField,
  NameField, AddressField, LookupField, TableField, SectionField, ContentField, PageBreakField,
]);
export type FieldSpec = z.infer<typeof FieldSpec>;
export type FieldType = FieldSpec['type'];
export type InputField = Exclude<FieldSpec, z.infer<typeof ContentField> | z.infer<typeof PageBreakField>>;
export type ContentField = z.infer<typeof ContentField>;
export type PageBreakField = z.infer<typeof PageBreakField>;

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

export const FormSpec = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
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

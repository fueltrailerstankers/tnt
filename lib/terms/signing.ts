// Which legal text a form's signatures agree to, and who signs each pad (handoff rule 12). Pure.
import { contentSource } from '@/lib/spec/content';
import type { ContentField, FormSpec } from '@/lib/spec/types';
import type { TermsBlock } from './versions';

export type SignerRole = 'customer' | 'sales_rep';

interface SigningDef {
  /** terms_versions.key */
  key: string;
  /** Content blocks by spec row, in the order the signer reads them. */
  blocks: Array<{ id: string; row: number }>;
  signers: Record<string, SignerRole>;
}

// Delivery Note: the trading terms + warranty, signatory declaration, polyurethane tanks waiver and proof of
// receipt, signed by the customer four times and by the sales rep once.
export const SIGNING: Record<string, SigningDef> = {
  'delivery-note': {
    key: 'delivery-note',
    blocks: [
      { id: 'terms', row: 4 },
      { id: 'declaration', row: 5 },
      { id: 'waiver', row: 6 },
      { id: 'receipt', row: 8 },
    ],
    signers: { Signature4: 'customer', Signature: 'customer', Signature2: 'customer', Signature3: 'customer', SalesRepSignature: 'sales_rep' },
  },
};

/** The exact source text of each legal block (verbatim kit markdown or spec html). Throws if the spec changed. */
export function termsBlocksFor(spec: FormSpec): TermsBlock[] {
  const def = SIGNING[spec.slug];
  if (!def) return [];
  return def.blocks.map(({ id, row }) => {
    const field = spec.fields.find((f): f is ContentField => f.type === 'content' && f.row === row);
    if (!field) throw new Error(`terms: ${spec.slug} has no content block on row ${row}`);
    return { id, text: contentSource(field) };
  });
}

/** Signature metadata the server stores on a new signature row (time is the server's receive time). */
export function signatureMeta(slug: string, field: string, termsVersionId: string | null, signedAt: string, method: SignMethod = 'draw') {
  const role = SIGNING[slug]?.signers[field];
  if (!role) return null;
  return { signed_at: signedAt, signer_role: role, sign_method: method, terms_version_id: termsVersionId };
}

export type SignMethod = 'draw' | 'type';

/** How a pad was signed, posted as sigm.<Field> by the signature pad: 'type' or (default) 'draw'. */
export function signMethodOf(fd: { get(name: string): unknown }, field: string): SignMethod {
  return fd.get(`sigm.${field}`) === 'type' ? 'type' : 'draw';
}

import { describe, expect, it, vi } from 'vitest';
import { contentSource } from '@/lib/spec/content';
import { signatureMeta, SIGNING, termsBlocksFor } from '@/lib/terms/signing';
import { spec } from './specs';

vi.mock('server-only', () => ({}));
const { termsSha256 } = await import('@/lib/terms/versions');

describe('Delivery Note signing (rule 12)', () => {
  it('collects the four legal blocks verbatim, in reading order', () => {
    const s = spec('delivery-note');
    const blocks = termsBlocksFor(s);
    expect(blocks.map((b) => b.id)).toEqual(['terms', 'declaration', 'waiver', 'receipt']);
    expect(blocks[0].text).toContain('STANDARD TRADING TERMS AND CONDITIONS.');
    expect(blocks[2].text).toContain('POLYURETHANE TANKS WAIVER');
    expect(blocks[1].text).toContain('documetns'); // kit typo kept verbatim
    const byRow = (row: number) => contentSource(s.fields.find((f) => f.type === 'content' && f.row === row) as never);
    expect(blocks[3].text).toBe(byRow(8));
    // Same text, same version.
    expect(termsSha256(termsBlocksFor(s))).toBe(termsSha256(blocks));
  });

  it('maps every signature pad to a signer role, server time and the version', () => {
    const signers = Object.keys(SIGNING['delivery-note'].signers).sort();
    expect(signers).toEqual(['SalesRepSignature', 'Signature', 'Signature2', 'Signature3', 'Signature4']);
    expect(signatureMeta('delivery-note', 'SalesRepSignature', 'v1', '2026-10-30T10:00:00.000Z')).toEqual({
      signed_at: '2026-10-30T10:00:00.000Z', signer_role: 'sales_rep', sign_method: 'draw', terms_version_id: 'v1',
    });
    expect(signatureMeta('delivery-note', 'Signature4', 'v1', 't')?.signer_role).toBe('customer');
    expect(signatureMeta('trailer-inspection-checklist', 'InspectorSignature', null, 't')).toBeNull();
  });

  it('other forms have no terms', () => {
    expect(termsBlocksFor(spec('deal'))).toEqual([]);
  });
});

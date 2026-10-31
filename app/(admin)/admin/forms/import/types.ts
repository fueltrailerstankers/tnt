// Shapes passed between the import page's server actions and its client components. No secrets, no entry data:
// form names and counts only.

export interface ActionState {
  ok?: string;
  error?: string;
}

export type ConnectionView =
  | {
      ok: true;
      at: string;
      /** Whether the key may read entries (probed on one mapped form); null when no form maps. */
      entryAccess: 'ok' | 'denied' | null;
      forms: Array<{
        cognitoId: number | null;
        name: string;
        /** From Cognito's form list when it carries a count; null otherwise (the dry run counts them). */
        entries: number | null;
        platform: { slug: string; name: string; expected: number | null } | null;
      }>;
      /** Platform forms that Cognito did not list. */
      missing: Array<{ slug: string; name: string }>;
    }
  | { ok: false; at: string; error: string };

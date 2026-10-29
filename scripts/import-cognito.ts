/**
 * Cognito history import (M5). Dry-run by default; see docs/M5.md before running --apply.
 *
 *   pnpm import:cognito --form all --dry-run
 *   pnpm import:cognito --form request-for-invoice --apply --limit 30
 *   pnpm import:cognito --form all --apply [--since 2026-01-01] [--json]
 *
 * Options:
 *   --form <slug|all>            form slug, or all (imported in order: RFI before Delivery Note)
 *   --dry-run | --apply          dry-run (default) reads Cognito and the platform and writes nothing
 *   --limit N                    import at most N new entries per form
 *   --since <YYYY-MM-DD>         only entries created on or after this date (UTC)
 *   --allow-unresolved-lookups   import a Delivery Note whose RFI is not imported (lookup left empty)
 *   --list-mode by-number|list   how entries are read from Cognito (docs/M5.md A2/A3); default by-number
 *   --max-number N               by-number: highest entry number to try
 *   --concurrency N              entries written in parallel (default 4)
 *   --json                       print the report as JSON
 *
 * Env (.env.local or shell): COGNITO_API_KEY; NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (without
 * them a dry-run runs offline against the kit specs and cannot tell what is already imported);
 * ENTRY_ENCRYPTION_KEY for --apply on DEAL / Delivery Note; ORG_ID when there is more than one org.
 *
 * Output is counts only: never names, emails, ID numbers, file names or field values.
 * Runs with the react-server condition (see package.json) so it can use the app's own sealData.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { sealData } from '@/lib/forms/entries';
import { parseKey } from '@/lib/security/crypto';
import { parseSpec } from '@/lib/spec/types';
import { HttpCognitoSource } from '@/lib/import/cognito/api';
import { IMPORT_ORDER, orderForms, runImport } from '@/lib/import/cognito/importer';
import { MemorySink, formRecordFromSpec } from '@/lib/import/cognito/memory-sink';
import { formatReport } from '@/lib/import/cognito/report';
import type { ImportSink } from '@/lib/import/cognito/sink';
import { SupabaseSink } from '@/lib/import/cognito/supabase-sink';

config({ path: '.env.local' });

const SPEC_DIR = path.resolve(process.cwd(), 'docs/source/tt-forms/spec/forms');
const ENCRYPTED = new Set(['deal', 'delivery-note']);

const posInt = z.coerce.number().int().positive();

async function main() {
  const { values } = parseArgs({
    options: {
      form: { type: 'string' },
      'dry-run': { type: 'boolean' },
      apply: { type: 'boolean' },
      limit: { type: 'string' },
      since: { type: 'string' },
      'allow-unresolved-lookups': { type: 'boolean' },
      'list-mode': { type: 'string' },
      'max-number': { type: 'string' },
      concurrency: { type: 'string' },
      json: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.apply && values['dry-run']) throw new Error('Choose one of --dry-run or --apply');
  const apply = values.apply === true;
  const formArg = values.form;
  if (!formArg) throw new Error('--form <slug|all> is required');
  const known: readonly string[] = IMPORT_ORDER;
  const slugs = formArg === 'all' ? [...IMPORT_ORDER] : formArg.split(',').map((s) => s.trim());
  for (const s of slugs) if (!known.includes(s)) throw new Error(`Unknown form: ${s}`);
  const limit = values.limit !== undefined ? posInt.parse(values.limit) : undefined;
  const maxNumber = values['max-number'] !== undefined ? posInt.parse(values['max-number']) : undefined;
  const concurrency = values.concurrency !== undefined ? posInt.parse(values.concurrency) : undefined;
  let since: Date | undefined;
  if (values.since !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.since)) throw new Error('--since must be YYYY-MM-DD');
    since = new Date(`${values.since}T00:00:00Z`);
  }
  const listMode = z.enum(['by-number', 'list']).parse(values['list-mode'] ?? 'by-number');

  const env = z.object({
    COGNITO_API_KEY: z.string().min(1, 'COGNITO_API_KEY is not set'),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    ORG_ID: z.string().uuid().optional(),
  }).parse(process.env);

  const notes: string[] = [];
  let sink: ImportSink;
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const q = db.from('orgs').select('id');
    const { data: orgs, error } = await (env.ORG_ID ? q.eq('id', env.ORG_ID) : q);
    if (error) throw new Error('Could not read orgs');
    if (!orgs || orgs.length !== 1) throw new Error('Expected exactly one org; set ORG_ID to choose.');
    sink = new SupabaseSink(db, orgs[0].id as string);
  } else {
    if (apply) throw new Error('--apply needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    const specs = readdirSync(SPEC_DIR).filter((f) => f.endsWith('.json')).map((f) => parseSpec(JSON.parse(readFileSync(path.join(SPEC_DIR, f), 'utf8'))));
    sink = new MemorySink('offline', specs.map((s) => formRecordFromSpec(s, `offline-${s.slug}`, 'offline')));
    notes.push('offline dry-run (no Supabase env): "already imported" is always 0 and number clashes are not checked.');
  }

  // Fail before any write rather than half-way through: encrypted forms need the key.
  if (apply && slugs.some((s) => ENCRYPTED.has(s))) parseKey(process.env.ENTRY_ENCRYPTION_KEY, 'ENTRY_ENCRYPTION_KEY');

  const source = new HttpCognitoSource({ apiKey: env.COGNITO_API_KEY, listMode, maxNumber });
  const report = await runImport({ source, sink, seal: sealData }, {
    forms: orderForms(slugs), apply, limit, since, concurrency, allowUnresolvedLookups: values['allow-unresolved-lookups'] === true,
  });
  report.notes.unshift(...notes);
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
  if (report.forms.some((f) => Object.keys(f.failed).length)) process.exitCode = 2;
}

main().catch((e: unknown) => {
  // Messages are built from codes, statuses and option names only (see api.ts / supabase-sink.ts).
  console.error(e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e instanceof Error ? e.message : 'import failed');
  process.exit(1);
});

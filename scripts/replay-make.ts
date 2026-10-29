// Make parity harness. Usage:
//   pnpm tsx scripts/replay-make.ts <recordings.json> [--json]
// Reads recorded Make executions (inputs and Make's Xero requests; format in docs/M3.md), runs the M3 planners
// in dry run, and prints a diff of planned requests vs Make's. No network, no database, no Make access.
// Exit code: 0 when every execution matches, 1 when any differs, 2 on a bad file.
// Output redacts personal data; do not paste recordings themselves into tickets or chats.
import { readFileSync } from 'node:fs';
import { parseReplayFile, replay } from '../lib/integrations/xero/write/replay';

function main(argv: string[]): number {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: tsx scripts/replay-make.ts <recordings.json> [--json]');
    return 2;
  }
  let parsed;
  try {
    parsed = parseReplayFile(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    console.error(`cannot read ${file}: ${e instanceof Error ? e.message : 'invalid'}`);
    return 2;
  }
  const r = replay(parsed);
  if (argv.includes('--json')) console.log(JSON.stringify({ matched: r.matched, differing: r.differing, reports: r.reports }, null, 2));
  else console.log(r.text);
  return r.differing ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));

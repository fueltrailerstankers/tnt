import { Alert } from '@/components/ui/Alert';
import { requirePerm } from '@/lib/security/require';
import { parseFilter, TASK_FILTERS } from '@/lib/tasks/build';
import { loadTasks } from '@/lib/tasks/load';
import { TaskList } from './TaskList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tasks · Trailers & Tankers' };

/**
 * Things waiting on the signed-in member (handoff Tasks): inspections to review or approve, Store Room counts to
 * approve, failed jobs and new leads assigned to them. Only rows they can act on appear.
 */
export default async function Tasks({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  const member = await requirePerm('tasks.read');
  const sp = await searchParams;
  const { rows, filters, failed } = await loadTasks(member, new Date());
  const missing = TASK_FILTERS.filter((f) => (failed as string[]).includes(f.value)).map((f) => f.label.toLowerCase());

  return (
    <section aria-labelledby="tasks-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 id="tasks-title" tabIndex={-1} className="m-0 text-h1">Tasks</h1>
        <p className="m-0 text-small text-fg-muted">Things waiting on you. Oldest first.</p>
      </div>
      {missing.length ? (
        <Alert tone="warning" title="Some tasks could not be loaded">
          <p className="text-small">Missing: {missing.join(', ')}. Reload the page to try again.</p>
        </Alert>
      ) : null}
      <TaskList rows={rows} filters={filters} initialFilter={parseFilter(sp.filter, filters)} />
    </section>
  );
}

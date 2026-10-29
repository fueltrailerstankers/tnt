// Supabase/PostgREST returns at most 1000 rows per request. Fetches every page of an ordered query.
export const PAGE_ROWS = 1000;

export async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await fetchPage(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_ROWS) return out;
  }
}

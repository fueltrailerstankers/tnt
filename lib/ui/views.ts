// Saved-view names and column visibility for list pages. Pure.

export const VIEW_NAME_MAX = 60;

export interface ViewLike { id: string; label: string }

/** Trimmed, single-spaced name, or an error message for the Save view dialog. */
export function checkViewName(raw: string, existing: readonly ViewLike[]): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, message: 'Give the view a name.' };
  if (name.length > VIEW_NAME_MAX) return { ok: false, message: `Use ${VIEW_NAME_MAX} characters or fewer.` };
  if (existing.some((v) => v.label.trim().toLowerCase() === name.toLowerCase())) return { ok: false, message: 'A view with this name already exists.' };
  return { ok: true, name };
}

export interface ColumnState { key: string; visible: boolean; required?: boolean }

/** Visible column keys after toggling one; required columns always stay visible and order is kept. */
export function toggleColumn(columns: readonly ColumnState[], key: string, visible: boolean): string[] {
  return columns.filter((c) => c.required || (c.key === key ? visible : c.visible)).map((c) => c.key);
}

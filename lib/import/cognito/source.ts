// The Cognito side of the history import. Everything that touches Cognito goes through CognitoSource,
// so the real REST shape (see api.ts and docs/M5.md "API assumptions") can be corrected without
// touching the mapper or the importer. Tests use an in-memory implementation; they never call Cognito.

/** A raw Cognito entry as JSON. Field values are keyed by Cognito FieldName (= our spec field `name`). */
export type CognitoEntry = Record<string, unknown>;

/** Which form to read. `cognitoFormId` and `internalName` come from the kit spec. */
export interface CognitoFormRef {
  slug: string;
  cognitoFormId: number;
  internalName: string;
}

export interface ListOptions {
  /** Hint only: the importer filters on Entry.DateCreated itself, so a source may ignore it. */
  since?: Date;
}

/**
 * Where a file or signature can be fetched from. Built by the mapper from the entry JSON.
 * ASSUMPTION (docs/M5.md A6, A7): file values carry an `Id` and/or a `File` URL; signatures carry a PNG
 * (URL or data URL) and/or an SVG string.
 */
export interface CognitoFileRef {
  id: string | null;
  url: string | null;
  /** Inline content (data URL or SVG markup in the entry JSON). Never downloaded. */
  inline: { base64: string; contentType: string } | null;
}

export interface DownloadedFile {
  bytes: Uint8Array;
  contentType: string | null;
}

/**
 * Where a resumed read continues. JSON-safe (stored in import_runs.cursor), never entry data.
 * - number: by-number walk (A2): the next Entry.Number to try and the consecutive misses so far.
 * - skip:   list endpoint (A3): entries already read.
 * - index:  any other source: entries already read; a resume reads them again and skips them.
 */
export type SourcePosition =
  | { kind: 'number'; next: number; misses: number }
  | { kind: 'skip'; n: number }
  | { kind: 'index'; n: number };

/** One step of a resumable read. `entry` is null for a probe that found nothing (a deleted entry number). */
export interface PositionedEntry {
  entry: CognitoEntry | null;
  /** Resume here to continue after this step. */
  position: SourcePosition;
}

export interface CognitoSource {
  /** Every entry of a form, oldest first where the source can tell. */
  listEntries(form: CognitoFormRef, opts: ListOptions): AsyncIterable<CognitoEntry>;
  /**
   * Optional resumable read: the same entries as listEntries, each with the position after it, starting at `from`.
   * Sources without it are resumed by re-reading and skipping (see importer.ts `positioned`).
   */
  listPositioned?(form: CognitoFormRef, opts: ListOptions & { from?: SourcePosition | null }): AsyncIterable<PositionedEntry>;
  /** Bytes of one file or signature. Throws on failure; the importer turns that into a reason code. */
  downloadFile(ref: CognitoFileRef): Promise<DownloadedFile>;
}

/** A form as Cognito lists it (A14). Names are form names (schema), not entry data. */
export interface CognitoFormInfo {
  id: number | null;
  name: string;
  internalName: string | null;
  /** Entry count when Cognito reports one in the form list; null when it does not (the dry run counts them). */
  entryCount: number | null;
}

/**
 * Thrown by a source when the current step must stop now: its time is up ('step_deadline'), or Cognito asks to wait
 * longer than the step has left ('cognito_rate_limited' for 429, 'cognito_unavailable' for 5xx; retryAfterMs is the
 * wait it asked for). It is not an entry failure: the importer aborts the step without counting or passing the entry,
 * and the run continues later from its last checkpoint.
 */
export class SourceDeadlineError extends Error {
  constructor(readonly code: 'step_deadline' | 'cognito_rate_limited' | 'cognito_unavailable', readonly retryAfterMs = 0) {
    super(code);
    this.name = 'SourceDeadlineError';
  }
}

/** A file larger than the cap (declared Content-Length, or counted while streaming). The download stops there. */
export class FileTooLargeError extends Error {
  constructor() {
    super('file too large');
    this.name = 'FileTooLargeError';
  }
}

/** Decodes inline content without any network access. Shared by every source. */
export function decodeInline(ref: CognitoFileRef): DownloadedFile | null {
  if (!ref.inline) return null;
  return { bytes: new Uint8Array(Buffer.from(ref.inline.base64, 'base64')), contentType: ref.inline.contentType };
}

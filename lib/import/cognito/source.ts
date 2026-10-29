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

export interface CognitoSource {
  /** Every entry of a form, oldest first where the source can tell. */
  listEntries(form: CognitoFormRef, opts: ListOptions): AsyncIterable<CognitoEntry>;
  /** Bytes of one file or signature. Throws on failure; the importer turns that into a reason code. */
  downloadFile(ref: CognitoFileRef): Promise<DownloadedFile>;
}

/** Decodes inline content without any network access. Shared by every source. */
export function decodeInline(ref: CognitoFileRef): DownloadedFile | null {
  if (!ref.inline) return null;
  return { bytes: new Uint8Array(Buffer.from(ref.inline.base64, 'base64')), contentType: ref.inline.contentType };
}

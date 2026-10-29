import type { LookupOption } from '@/lib/forms/lookup-types';

export interface SubmitState {
  message?: string;
  errors?: Record<string, string>;
  /** Bumped on every server response so the client can react even when the message repeats. */
  at?: number;
}

export interface ExistingFile {
  id: string;
  name: string;
  url?: string | null;
}

export interface UploadTicket {
  name: string;
  size: number;
  type: string;
  path: string;
  token: string;
}

export type UploadFn = (field: string, files: Array<{ name: string; size: number; type: string }>) => Promise<{ tickets?: UploadTicket[]; error?: string }>;

export type LookupConfig =
  | { mode: 'list'; options: LookupOption[]; panel: (id: string) => Promise<Array<[string, string]>> }
  | { mode: 'exact'; find: (value: string) => Promise<{ option: LookupOption; panel: Array<[string, string]> } | null> };

export interface ActionButton {
  name: string;
  label: string;
}

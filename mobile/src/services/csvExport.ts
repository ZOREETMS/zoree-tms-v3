/**
 * csvExport — build CSV from row arrays + share/save via the OS share
 * sheet.
 *
 * Why a service:
 *   - Multiple screens (Item Master, Locations, Shipments, Rates, …)
 *     all need the same export pattern. Sharing one implementation
 *     keeps the CSV escape rules consistent (Rule 6).
 *
 * QA #316 / #320 / #323 / #329 — earlier revisions of this module
 * called Share.share() with the CSV text in `message`, which opened
 * the share sheet with no file attached. Users (and QA) read that as
 * "share opens instead of downloading" because the sheet's "Save to
 * Files" / "Save to Drive" options were not offered without a real
 * file URL to attach. Mobile has no SAF-style file save picker, so the
 * fix is to write the CSV to a documents-directory file and hand that
 * URI to expo-sharing.shareAsync — which on both iOS and Android
 * surfaces Save-to-Files / Save-to-Drive / Mail-with-attachment as
 * first-class options. The previous text-only Share.share is retained
 * as a fallback for older app builds that haven't pulled in
 * expo-file-system / expo-sharing yet (the require() catches the
 * "module not found" case).
 */

import { Share, Platform } from 'react-native';

/**
 * Lazy import of expo-file-system + expo-sharing. Keeps this module
 * loadable in environments where the native modules aren't present
 * yet (older builds, Jest unit tests, story renders) by falling back
 * to the legacy text-only Share.share path. The TypeScript surface
 * stays unchanged.
 */
type FsModule = {
  documentDirectory: string | null;
  writeAsStringAsync: (
    uri: string,
    contents: string,
    options?: { encoding?: string },
  ) => Promise<void>;
  EncodingType?: { UTF8: string };
};
type SharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (
    uri: string,
    opts?: { mimeType?: string; dialogTitle?: string; UTI?: string },
  ) => Promise<void>;
};

let cachedFs: FsModule | null | undefined;
let cachedSharing: SharingModule | null | undefined;

function getFs(): FsModule | null {
  if (cachedFs !== undefined) return cachedFs;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedFs = require('expo-file-system') as FsModule;
  } catch {
    cachedFs = null;
  }
  return cachedFs;
}

function getSharing(): SharingModule | null {
  if (cachedSharing !== undefined) return cachedSharing;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedSharing = require('expo-sharing') as SharingModule;
  } catch {
    cachedSharing = null;
  }
  return cachedSharing;
}

export interface ExportColumn<T> {
  key: keyof T | string;
  header: string;
  /** Optional value extractor for derived columns (e.g. rate_id). */
  value?: (row: T) => unknown;
}

function escapeCell(val: unknown): string {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a CSV string from rows + a column spec. Header row is always
 * emitted. Empty input returns just the header so the receiver sees a
 * valid (if empty) CSV.
 */
export function buildCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const body = (rows || [])
    .map((row) =>
      columns
        .map((c) =>
          escapeCell(c.value ? c.value(row) : (row as any)?.[c.key]),
        )
        .join(','),
    )
    .join('\n');
  return body ? `${header}\n${body}` : header;
}

/**
 * Share a CSV via the OS share sheet. `title` is shown by some
 * receivers (mail subject, etc.); `filename` is used as both the
 * on-disk filename AND the share sheet's dialog title.
 *
 * QA #316 / #320 / #323 / #329 — preferred path now writes the CSV to
 * `FileSystem.documentDirectory` and hands the file URI to
 * `Sharing.shareAsync`. That gives users Save-to-Files /
 * Save-to-Drive / mail-with-attachment from the share sheet — what
 * testers expect when they say "download". Falls back to the legacy
 * Share.share(text) path when the Expo modules aren't installed
 * (keeps unit tests + older builds running unchanged).
 */
export async function shareCsv(
  csv: string,
  opts: { title?: string; filename?: string } = {},
): Promise<void> {
  const { title = 'Export', filename = 'export.csv' } = opts;

  const fs = getFs();
  const sharing = getSharing();
  if (fs && fs.documentDirectory && sharing) {
    try {
      const available = await sharing.isAvailableAsync();
      if (available) {
        const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const uri = `${fs.documentDirectory}${safeName}`;
        await fs.writeAsStringAsync(
          uri,
          csv,
          // Default encoding is UTF8 in expo-file-system; pass the enum
          // explicitly when it's exposed so behaviour stays stable
          // across SDK versions.
          fs.EncodingType ? { encoding: fs.EncodingType.UTF8 } : undefined,
        );
        await sharing.shareAsync(uri, {
          mimeType: 'text/csv',
          dialogTitle: title,
          // iOS UTI for CSV; ignored on Android.
          UTI: 'public.comma-separated-values-text',
        });
        return;
      }
    } catch (err) {
      // Fall through to the legacy text share — better degraded UX
      // than a hard failure.
      // eslint-disable-next-line no-console
      console.warn('[csvExport] file-share path failed, falling back to text share:', err);
    }
  }

  await Share.share(
    {
      title,
      message: csv,
      ...(Platform.OS === 'ios' ? { subject: filename } : {}),
    },
    { dialogTitle: title },
  );
}

/**
 * Convenience: build + share in one call.
 */
export async function exportRowsAsCsv<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  opts: { title?: string; filename?: string } = {},
): Promise<void> {
  const csv = buildCsv(rows, columns);
  await shareCsv(csv, opts);
}

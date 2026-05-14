/**
 * csvExport — build CSV from row arrays + share via the OS share sheet.
 *
 * Why a service:
 *   - Multiple screens (Item Master, Locations, Shipments, Rates, …)
 *     all need the same export pattern. Sharing one implementation
 *     keeps the CSV escape rules consistent (Rule 6).
 *   - Mobile has no native "Save as CSV" picker. The OS Share API
 *     accepts a text body that the user can route to mail, Files, or
 *     a cloud doc app. Acceptable mobile UX without adding new deps
 *     like expo-file-system / expo-sharing.
 *
 * Limitations:
 *   - The receiving app decides what to do with the CSV string. Some
 *     mail clients will paste it inline; the user can then save the
 *     attachment from there. Good enough for QA #270 (Export option
 *     was just missing) without expanding the mobile bundle.
 */

import { Share, Platform } from 'react-native';

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
 * receivers (mail subject, etc.); `filename` is used as the share
 * title where the platform exposes one.
 */
export async function shareCsv(
  csv: string,
  opts: { title?: string; filename?: string } = {},
): Promise<void> {
  const { title = 'Export', filename = 'export.csv' } = opts;
  await Share.share(
    {
      title,
      message: csv,
      // iOS supports a `url` field for file-style shares but we don't
      // have file storage in scope; sticking to text/message keeps this
      // dependency-free.
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

/**
 * Saving a file, on a phone and in a browser.
 *
 * A blob plus an `<a download>` is the web answer, but inside the Capacitor
 * WebView that silently does nothing — there is no browser download manager to
 * catch it. On a device the file is written to app storage and handed to the
 * system share sheet instead, which is what lets you drop it into Drive, mail
 * it to yourself, or open it in a spreadsheet app.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type SaveResult =
  | { ok: true; how: 'download' | 'share' }
  | { ok: false; error: string };

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function saveOnDevice(
  filename: string,
  contents: string,
  title: string,
): Promise<SaveResult> {
  // Cache, not Documents: the file is a hand-off to the share sheet, and this
  // way the OS is free to reclaim it without the user having to tidy up.
  const written = await Filesystem.writeFile({
    path: filename,
    data: contents,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  await Share.share({ title, url: written.uri, dialogTitle: title });
  return { ok: true, how: 'share' };
}

function saveInBrowser(filename: string, contents: string, mimeType: string): SaveResult {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking straight away cancels the download on some mobile browsers.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { ok: true, how: 'download' };
}

export async function saveTextFile(
  filename: string,
  contents: string,
  options: { mimeType?: string; title?: string } = {},
): Promise<SaveResult> {
  const mimeType = options.mimeType ?? 'text/csv';
  const title = options.title ?? filename;

  try {
    if (isNative()) return await saveOnDevice(filename, contents, title);
    return saveInBrowser(filename, contents, mimeType);
  } catch (error) {
    // A cancelled share sheet lands here too, and is not worth alarming
    // anybody about.
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) return { ok: false, error: 'cancelled' };
    return { ok: false, error: message || 'The file could not be saved.' };
  }
}

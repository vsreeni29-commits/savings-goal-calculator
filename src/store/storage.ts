/**
 * Where the plan lives between sessions.
 *
 * On a phone build this is Capacitor Preferences, which survives app updates
 * and is not cleared by the WebView. In a browser it is localStorage. Both are
 * wrapped in the same async interface so the store does not care which one it
 * got, and every call is guarded — storage being unavailable (private mode, a
 * full disk) must degrade to an in-memory session, never a crash.
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export const STORAGE_KEY = 'goalvault.data.v1';

const memory = new Map<string, string>();

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function readRaw(key: string = STORAGE_KEY): Promise<string | null> {
  try {
    if (isNative()) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    }
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function writeRaw(value: string, key: string = STORAGE_KEY): Promise<void> {
  memory.set(key, value);
  try {
    if (isNative()) {
      await Preferences.set({ key, value });
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // Kept in memory for this session; the export screen is the way out.
  }
}

export async function clearRaw(key: string = STORAGE_KEY): Promise<void> {
  memory.delete(key);
  try {
    if (isNative()) {
      await Preferences.remove({ key });
      return;
    }
    window.localStorage.removeItem(key);
  } catch {
    // Nothing else to try.
  }
}

/**
 * The desktop app's media store for note pictures.
 *
 * The bytes live in a table of the SQLite file, reached through two
 * commands (`todo_media_write`, `todo_media_read`), and the web view draws
 * a picture from the app's own `todo-media` scheme, which Rust serves out
 * of the same table. Base64 across the bridge, because the invoke channel
 * carries JSON.
 */

import { setTodoMediaStore, type TodoMediaFile } from "./media-store";

export const TODO_MEDIA_SCHEME = "todo-media";

type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

type TauriInternals = {
  invoke?: TauriInvoke;
  convertFileSrc?: (path: string, protocol: string) => string;
};

function internals(): TauriInternals | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __TAURI__?: { core?: TauriInternals };
    __TAURI_INTERNALS__?: TauriInternals;
  };
  return w.__TAURI_INTERNALS__ ?? w.__TAURI__?.core ?? null;
}

function invoke(): TauriInvoke {
  const fn = internals()?.invoke;
  if (!fn) throw new Error("The media store needs the desktop app.");
  return fn;
}

/**
 * Where the web view reads a stored picture. Tauri shapes the address for
 * the platform: a scheme of its own on macOS, a `.localhost` host on
 * Windows. Without Tauri to ask, the macOS shape.
 */
export function tauriMediaSrc(id: string): string {
  const convert = internals()?.convertFileSrc;
  if (convert) return convert(id, TODO_MEDIA_SCHEME);
  return `${TODO_MEDIA_SCHEME}://localhost/${encodeURIComponent(id)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let installed = false;

export function installTauriMediaStore() {
  if (installed) return;
  installed = true;
  setTodoMediaStore({
    async write(input) {
      const stored = (await invoke()("todo_media_write", {
        bytesBase64: bytesToBase64(input.bytes),
        contentType: input.contentType,
        filename: input.filename,
        width: input.width ?? null,
        height: input.height ?? null,
      })) as TodoMediaFile;
      return stored;
    },
    async read(id) {
      const found = (await invoke()("todo_media_read", { id })) as {
        bytesBase64: string;
        contentType: string;
        filename: string;
      } | null;
      if (!found) return null;
      return {
        bytes: base64ToBytes(found.bytesBase64),
        contentType: found.contentType,
        filename: found.filename,
      };
    },
  });
}

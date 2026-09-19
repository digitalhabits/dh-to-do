/**
 * Where a picture in a note lives when Basecamp does not hold it.
 *
 * A picture in a note on a Basecamp-linked list is a file Basecamp has
 * signed, named in the note by its sgid. A task on no list, or on a list
 * Basecamp does not know, has no such place. So the bytes go to a store of
 * this app's own: the planner's private bucket, or a table in the desktop
 * app's SQLite file. The note names the picture by its id, on a
 * `<bc-attachment data-dh-media="…">` tag. Basecamp strips the attribute
 * and never sees the picture.
 *
 * When such a task reaches a linked list, the sync gives each picture to
 * Basecamp and writes the sgid onto the tag (`attachLocalMedia` in
 * basecamp.ts). The id stays on the tag, so the picture draws from the
 * local copy until a pull brings Basecamp's own address.
 *
 * The same seam as the database driver: one store interface, and each app
 * installs its own. The tag helpers here use no DOM, because the sync runs
 * on the planner's server as well as in the desktop app's web view.
 */

/** The attribute that names a picture in the local store. */
export const NOTE_MEDIA_ATTR = "data-dh-media";

/** What a note picture can be. Basecamp draws the same set. */
export const NOTE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** Room for a photograph, not for a video. The Basecamp path allows the same. */
export const NOTE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export type TodoMediaFile = {
  id: string;
  contentType: string;
  filename: string;
  filesize: number;
  width: number | null;
  height: number | null;
};

export type TodoMediaStore = {
  write(
    input: {
      bytes: Uint8Array;
      contentType: string;
      filename: string;
      width?: number | null;
      height?: number | null;
    },
    /** Who put it there, where the store keeps that. */
    owner: string | null
  ): Promise<TodoMediaFile>;
  read(
    id: string
  ): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null>;
};

let store: TodoMediaStore | null = null;

export function setTodoMediaStore(next: TodoMediaStore) {
  store = next;
}

export function hasTodoMediaStore(): boolean {
  return store !== null;
}

export function todoMediaStore(): TodoMediaStore {
  if (!store) {
    throw new Error(
      "No To-Do media store installed. Server code imports server-store; " +
        "the standalone app installs the SQLite media store in standalone-api."
    );
  }
  return store;
}

const TAG_RE = /<bc-attachment\b[^>]*>/gi;
const MEDIA_RE = /\bdata-dh-media="([^"]*)"/i;
const SGID_RE = /\bsgid="/i;

/** The ids of the pictures a note holds in the local store, in order. */
export function noteMediaIds(html: string | null | undefined): string[] {
  if (!html) return [];
  const ids: string[] = [];
  for (const tag of html.match(TAG_RE) ?? []) {
    const m = MEDIA_RE.exec(tag);
    if (m?.[1]) ids.push(m[1]);
  }
  return ids;
}

/** The local pictures Basecamp has not been given yet, in order. */
export function noteMediaWithoutSgid(html: string | null | undefined): string[] {
  if (!html) return [];
  const ids: string[] = [];
  for (const tag of html.match(TAG_RE) ?? []) {
    const m = MEDIA_RE.exec(tag);
    if (m?.[1] && !SGID_RE.test(tag)) ids.push(m[1]);
  }
  return ids;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * The same note, with the sgid Basecamp gave one of its local pictures.
 * The id stays on the tag: the local copy is what draws until a pull
 * brings Basecamp's own address.
 */
export function noteWithSgid(html: string, mediaId: string, sgid: string): string {
  return html.replace(TAG_RE, (tag) => {
    const m = MEDIA_RE.exec(tag);
    if (m?.[1] !== mediaId || SGID_RE.test(tag)) return tag;
    return tag.replace(/^<bc-attachment\b/i, `<bc-attachment sgid="${escapeAttr(sgid)}"`);
  });
}

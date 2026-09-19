/**
 * The pictures in a backup file.
 *
 * A note picture and an avatar photo are kept in the app's own store: the
 * planner's private bucket, or a table in the desktop app's SQLite file.
 * The board names them only by id. A file with the ids and not the bytes
 * brings a board to another computer with its pictures missing.
 *
 * So Export puts the bytes in the file, and Import stores each picture again
 * before the board goes in. The store gives each one a new id, and the notes
 * and the avatars are changed to name the new ids. The planner and the
 * desktop app both do this in the page, so a file moves either way.
 */

import { NOTE_MEDIA_ATTR, noteMediaIds } from "./media-store";
import type { TodoPerson, TodoTask } from "./types";

/** One picture, as it goes in the file. */
export type BackupMedia = {
  id: string;
  contentType: string;
  filename: string;
  /** The bytes, in base64. */
  data: string;
};

/**
 * The picture a person's photo address names, if it is one of ours.
 *
 * The address has one of three forms, by where it was made:
 * `todo-media://localhost/<id>` (desktop app, macOS),
 * `http://todo-media.localhost/<id>` (desktop app, Windows) and
 * `/api/media/<id>` (planner). A Basecamp avatar is not ours and answers null.
 */
export function mediaIdOfPhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m =
    /^todo-media:\/\/localhost\/([^/?#]+)$/.exec(url) ??
    /^https?:\/\/todo-media\.localhost\/([^/?#]+)$/.exec(url) ??
    /^\/api\/media\/([^/?#]+)$/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Every picture the board names, once each. */
export function boardMediaIds(state: {
  tasks: Pick<TodoTask, "notesHtml">[];
  people: Pick<TodoPerson, "photoUrl">[];
}): string[] {
  const ids = new Set<string>();
  for (const task of state.tasks) {
    for (const id of noteMediaIds(task.notesHtml)) ids.add(id);
  }
  for (const person of state.people) {
    const id = mediaIdOfPhotoUrl(person.photoUrl);
    if (id) ids.add(id);
  }
  return [...ids];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The pictures of a file, with the junk left out. */
export function backupMediaOf(payload: Record<string, unknown>): BackupMedia[] {
  if (!Array.isArray(payload.media)) return [];
  return payload.media.filter(
    (m): m is BackupMedia =>
      Boolean(m) &&
      typeof m === "object" &&
      typeof (m as BackupMedia).id === "string" &&
      typeof (m as BackupMedia).data === "string" &&
      typeof (m as BackupMedia).contentType === "string"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The file again, naming the pictures by their new ids, and without the
 * bytes: they are stored already. A picture that could not be stored keeps
 * its old id; it draws as missing, as it would have without this.
 *
 * `photoUrlOf` makes the address this app draws a picture from.
 */
export function withNewMediaIds(
  payload: Record<string, unknown>,
  newIds: Map<string, string>,
  photoUrlOf: (mediaId: string) => string
): Record<string, unknown> {
  const { media: _media, ...rest } = payload;
  if (newIds.size === 0) return rest;
  const renameNote = (html: string) => {
    let out = html;
    for (const [oldId, newId] of newIds) {
      out = out.replace(
        new RegExp(`${NOTE_MEDIA_ATTR}="${escapeRegExp(oldId)}"`, "g"),
        `${NOTE_MEDIA_ATTR}="${newId}"`
      );
    }
    return out;
  };
  const tasks = Array.isArray(rest.tasks)
    ? rest.tasks.map((task) => {
        if (!task || typeof task !== "object") return task;
        const notes = (task as { notesHtml?: unknown }).notesHtml;
        return typeof notes === "string"
          ? { ...task, notesHtml: renameNote(notes) }
          : task;
      })
    : rest.tasks;
  const people = Array.isArray(rest.people)
    ? rest.people.map((person) => {
        if (!person || typeof person !== "object") return person;
        const oldId = mediaIdOfPhotoUrl(
          (person as { photoUrl?: string | null }).photoUrl
        );
        const newId = oldId ? newIds.get(oldId) : undefined;
        return newId ? { ...person, photoUrl: photoUrlOf(newId) } : person;
      })
    : rest.people;
  return { ...rest, tasks, people };
}

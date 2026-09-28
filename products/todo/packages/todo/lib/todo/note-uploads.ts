/**
 * Where a note's pictures go, and the uploads that take them there.
 *
 * The notes editor calls an UploadImage with each picture pasted or
 * dropped into a note. Which one it gets depends on where the note lives:
 * see uploaderForTaskOn.
 */

import { toast } from "sonner";

import type { UploadImage } from "@/components/todo/TrixNotesEditor";

import { noteMediaSrc } from "./basecamp-image";
import { todoMediaStore } from "./media-store";
import { isStandaloneTodo } from "./product-flavor";
import { savedLangT } from "./saved-prefs";
import { installTauriMediaStore } from "./tauri-media";
import type { TodoList, TodoTask } from "./types";

/**
 * Give a picture to Basecamp, so a note can name it.
 *
 * The bytes go through the planner, which holds the token. What comes back
 * is the sgid, which is the only way rich text there can refer to a file,
 * and the blob id, so the picture can be drawn straight away instead of
 * after a sync.
 *
 * Sent with XMLHttpRequest rather than fetch, for the one thing fetch
 * cannot do: say how far a upload has got. A picture over a slow line took
 * twenty seconds here, and a bar frozen part-way through reads as broken
 * even while the bytes are moving.
 */
export const uploadBasecampImage: UploadImage = async (file, onProgress) => {
  const res = await new Promise<{ ok: boolean; status: number; text: string }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        "POST",
        `/api/todo/basecamp-attachment?name=${encodeURIComponent(file.name)}`
      );
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        // Up to 90: the bytes are there, but Basecamp has not answered yet.
        onProgress(Math.round((event.loaded / event.total) * 90));
      });
      xhr.addEventListener("load", () =>
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          text: xhr.responseText,
        })
      );
      xhr.addEventListener("error", () => reject(new Error("network")));
      xhr.addEventListener("abort", () => reject(new Error("aborted")));
      xhr.send(file);
    }
  );
  const body = ((): {
    sgid?: string;
    blobId?: string | null;
    contentType?: string;
    filename?: string;
    filesize?: number;
    width?: number | null;
    height?: number | null;
    error?: string;
  } => {
    try {
      return JSON.parse(res.text);
    } catch {
      return {};
    }
  })();
  if (!res.ok || !body.sgid) {
    toast.error(body.error ?? savedLangT()("pictureAddFailed"));
    throw new Error(body.error ?? "upload failed");
  }
  return {
    sgid: body.sgid,
    blobId: body.blobId ?? null,
    contentType: body.contentType,
    filename: body.filename,
    filesize: body.filesize,
    width: body.width,
    height: body.height,
  };
};

/** The picture's size, for the note to lay it out before it loads. */
export async function imageSize(
  file: File
): Promise<{ width: number | null; height: number | null }> {
  if (typeof createImageBitmap !== "function") return { width: null, height: null };
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

/**
 * A picture into the app's own store, for a note Basecamp does not hold.
 *
 * The planner keeps it in its private bucket, through /api/todo/media; the
 * desktop app keeps it in its SQLite file. Either way the note names the
 * picture by the id that comes back and draws it from where this app can
 * read it. When the task reaches a Basecamp-linked list, the sync gives
 * the picture to Basecamp. See media-store.ts.
 */
export const uploadLocalNoteImage: UploadImage = async (file, onProgress) => {
  const filename = file.name || "image";
  const size = await imageSize(file);
  let mediaId: string;
  if (isStandaloneTodo()) {
    installTauriMediaStore();
    onProgress(20);
    const stored = await todoMediaStore().write(
      {
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type,
        filename,
        ...size,
      },
      null
    );
    mediaId = stored.id;
  } else {
    const res = await new Promise<{ ok: boolean; text: string }>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/todo/media?name=${encodeURIComponent(filename)}`);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          onProgress(Math.round((event.loaded / event.total) * 90));
        });
        xhr.addEventListener("load", () =>
          resolve({ ok: xhr.status >= 200 && xhr.status < 300, text: xhr.responseText })
        );
        xhr.addEventListener("error", () => reject(new Error("network")));
        xhr.addEventListener("abort", () => reject(new Error("aborted")));
        xhr.send(file);
      }
    );
    const body = ((): { mediaId?: string; error?: string } => {
      try {
        return JSON.parse(res.text);
      } catch {
        return {};
      }
    })();
    if (!res.ok || !body.mediaId) {
      toast.error(body.error ?? savedLangT()("pictureAddFailed"));
      throw new Error(body.error ?? "upload failed");
    }
    mediaId = body.mediaId;
  }
  return {
    mediaId,
    url: noteMediaSrc(mediaId),
    contentType: file.type,
    filename,
    filesize: file.size,
    width: size.width,
    height: size.height,
  };
};


/**
 * Where this task's note sends a picture.
 *
 * On a Basecamp-linked list, in the planner, straight to Basecamp: a
 * picture there is a file it has signed, named by an sgid. Anywhere
 * else — a task on no list, an unlinked list, the desktop app — to the
 * app's own store, and the sync gives it to Basecamp if the task ever
 * reaches a linked list.
 */
export function uploaderForTaskOn(
  task: Pick<TodoTask, "listId" | "parentTaskId">,
  lists: TodoList[]
): UploadImage {
  if (isStandaloneTodo()) return uploadLocalNoteImage;
  /*
    A subtask's note never reaches Basecamp: a step there holds a title
    and a tick, and no notes. A picture given to Basecamp from one was
    signed and then never expanded, so the only copy this app could draw
    was the one the upload kept in the server's memory — and on the
    live site that memory is a different process by the next request.
    The picture 404ed as soon as it was pasted. The app's own store is
    the picture's home for every subtask, linked list or not.
  */
  if (task.parentTaskId) return uploadLocalNoteImage;
  return uploaderForListOn(task.listId, lists);
}

/**
 * Where a note on this list sends a picture. The half of the rule above
 * that a task not yet made can ask: the add row writes its note before
 * there is a task, and knows only the list it will go on.
 */
export function uploaderForListOn(listId: string | null, lists: TodoList[]): UploadImage {
  if (isStandaloneTodo()) return uploadLocalNoteImage;
  const list = lists.find((l) => l.id === listId);
  if (!list?.basecampProjectId || !list?.basecampListId) {
    return uploadLocalNoteImage;
  }
  return uploadBasecampImage;
}

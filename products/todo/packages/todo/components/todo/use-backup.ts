"use client";

import type * as React from "react";
import { toast } from "sonner";

import type { ConfirmModalState } from "@/components/todo/use-task-actions";
import type { TodoApi } from "@/components/todo/use-write-tracking";
import { buildTodoBackup, todoBackupFileName } from "@/lib/todo/backup";
import {
  backupMediaOf,
  base64ToBytes,
  boardMediaIds,
  bytesToBase64,
  withNewMediaIds,
  type BackupMedia,
} from "@/lib/todo/backup-media";
import { noteMediaSrc } from "@/lib/todo/basecamp-image";
import { describeError } from "@/lib/todo/errors";
import { fillText } from "@/lib/todo/i18n";
import { todoMediaStore } from "@/lib/todo/media-store";
import { uploadLocalNoteImage } from "@/lib/todo/note-uploads";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { installTauriMediaStore } from "@/lib/todo/tauri-media";
import type { TodoState } from "@/lib/todo/types";

/**
 * The backup: the board and its pictures out to a file, and a file in
 * again after a question.
 */
export function useBackup({
  state,
  api,
  refresh,
  t,
  setSettingsOpen,
  setConfirmModal,
}: {
  state: TodoState;
  api: TodoApi;
  refresh: () => Promise<void>;
  t: (key: string) => string;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
}) {
  /** A picture from this app's store, for the backup file. */
  async function readMediaForBackup(id: string): Promise<BackupMedia | null> {
    try {
      if (isStandaloneTodo()) {
        installTauriMediaStore();
        const found = await todoMediaStore().read(id);
        if (!found) return null;
        return {
          id,
          contentType: found.contentType,
          filename: found.filename,
          data: bytesToBase64(found.bytes),
        };
      }
      const res = await fetch(noteMediaSrc(id));
      if (!res.ok) return null;
      return {
        id,
        contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
        filename: "",
        data: bytesToBase64(new Uint8Array(await res.arrayBuffer())),
      };
    } catch {
      return null;
    }
  }

  async function exportData() {
    const now = new Date();
    // The pictures go in the file too, so the board keeps them on another
    // computer. See backup-media.ts.
    const ids = boardMediaIds(state);
    const media = (await Promise.all(ids.map(readMediaForBackup))).filter(
      (m): m is BackupMedia => m !== null
    );
    if (media.length < ids.length) {
      toast.warning(t("exportMissingPictures"));
    }
    const backup = buildTodoBackup(state, now, media);
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = todoBackupFileName(now);
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The file's pictures into this app's store, before the board goes in.
   * Answers the file with the notes and the avatars naming the new ids.
   */
  async function storeBackupMedia(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const media = backupMediaOf(payload);
    const newIds = new Map<string, string>();
    for (const item of media) {
      try {
        const file = new File([base64ToBytes(item.data)], item.filename || "image", {
          type: item.contentType,
        });
        const stored = await uploadLocalNoteImage(file, () => {});
        if (stored.mediaId) newIds.set(item.id, stored.mediaId);
      } catch {
        // Left with its old id: it draws as missing, and the rest go in.
      }
    }
    return withNewMediaIds(payload, newIds, noteMediaSrc);
  }

  function importData(file: File) {
    void file.text().then((text) => {
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        toast.error(t("backupNotJson"));
        return;
      }
      setSettingsOpen(false);
      setConfirmModal({
        title: t("importConfirmTitle"),
        message: t("importConfirmMessage"),
        confirmLabel: t("importLabel"),
        onConfirm: () => {
          void storeBackupMedia(payload as Record<string, unknown>)
            .then((withMedia) => api("/api/todo/import", "POST", withMedia))
            .then((json) => {
              const c = json.imported as { lists: number; tasks: number };
              toast.success(
        `${t("importDone")}: ${fillText(t("importCounts"), { lists: c.lists, tasks: c.tasks })}`
      );
              void refresh();
            })
            .catch((err) =>
              toast.error(describeError(err, t("importFailed")))
            );
        },
      });
    });
  }

  return { exportData, importData };
}

"use client";

import * as React from "react";
import { toast } from "sonner";

import { BOARD_NUDGE_SEEN_KEY, boardNudgeIsDue } from "@/components/todo/BoardViewNudge";
import { SettingsGearIcon } from "@/components/todo/task-icons";
import { KANBAN_KEY, persistPref } from "@/lib/todo/saved-prefs";
import type { TodoTask } from "@/lib/todo/types";

/** The note that offers Board View for a long list, and its two answers. */
export function useBoardNudge({
  kanbanEnabled,
  setKanbanEnabled,
  flatListTasks,
  t,
}: {
  kanbanEnabled: boolean;
  setKanbanEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  flatListTasks: TodoTask[];
  t: (key: string) => string;
}) {
  /**
   * The note that offers Board View for a long list (see BoardViewNudge).
   * It answers the reader's own act: a task they added in the list view.
   */
  const [boardNudgeOpen, setBoardNudgeOpen] = React.useState(false);
  const addedInListViewRef = React.useRef(false);
  React.useEffect(() => {
    if (!addedInListViewRef.current) return;
    addedInListViewRef.current = false;
    let seen = true;
    try {
      seen = localStorage.getItem(BOARD_NUDGE_SEEN_KEY) === "1";
    } catch {
      /* private mode: no note, it could not be put away for good */
    }
    if (
      boardNudgeIsDue({
        added: true,
        boardViewOn: kanbanEnabled,
        seen,
        openTasksInList: flatListTasks.length,
      })
    ) {
      setBoardNudgeOpen(true);
    }
  }, [flatListTasks.length, kanbanEnabled]);
  function answerBoardNudge(tryBoard: boolean) {
    setBoardNudgeOpen(false);
    persistPref(BOARD_NUDGE_SEEN_KEY, "1");
    if (tryBoard) {
      setKanbanEnabled(true);
      persistPref(KANBAN_KEY, "1");
      return;
    }
    toast(t("boardNudgeLater"), {
      icon: <SettingsGearIcon />,
      action: { label: t("gotIt"), onClick: () => {} },
    });
  }

  return { boardNudgeOpen, addedInListViewRef, answerBoardNudge };
}

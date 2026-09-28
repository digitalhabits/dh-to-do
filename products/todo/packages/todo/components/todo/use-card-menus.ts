"use client";

import * as React from "react";

/**
 * The popovers and menus a card opens: the duration and due popovers
 * and the chips they hang off, the card's menu, the move-to-list picker,
 * and the people menu.
 */
export function useCardMenusState() {
  /** The open card whose duration popover is up, and the chip it hangs off. */
  const [durationPopoverTaskId, setDurationPopoverTaskId] = React.useState<
    string | null
  >(null);
  const [durationPopoverAnchor, setDurationPopoverAnchor] =
    React.useState<HTMLElement | null>(null);
  /**
   * The "Show on the Calendar" box of the open due popover. Kept here and not
   * read from the task, because the box can be ticked before a day is picked,
   * when the task cannot hold it yet.
   */
  const [dueCalendarWanted, setDueCalendarWanted] = React.useState(false);
  const [duePopoverTaskId, setDuePopoverTaskId] = React.useState<
    string | null
  >(null);
  const [duePopoverAnchor, setDuePopoverAnchor] =
    React.useState<HTMLElement | null>(null);
  const [editingDuration, setEditingDuration] = React.useState("");
  const [openMenuTaskId, setOpenMenuTaskId] = React.useState<string | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(
    null
  );
  const [menuShowsMoveTargets, setMenuShowsMoveTargets] = React.useState(false);
  /** All/Favourites: list-origin chip opens a move-to-list picker. */
  const [openListPickerTaskId, setOpenListPickerTaskId] = React.useState<
    string | null
  >(null);
  /* The picker is portaled out of the card, so it is placed against this
     button rather than by the card's own box. See MenuPortal. */
  const [listPickerAnchorEl, setListPickerAnchorEl] =
    React.useState<HTMLElement | null>(null);
  const [openAssignTaskId, setOpenAssignTaskId] = React.useState<string | null>(
    null
  );
  const [assignAnchorEl, setAssignAnchorEl] =
    React.useState<HTMLElement | null>(null);

  return {
    durationPopoverTaskId,
    setDurationPopoverTaskId,
    durationPopoverAnchor,
    setDurationPopoverAnchor,
    dueCalendarWanted,
    setDueCalendarWanted,
    duePopoverTaskId,
    setDuePopoverTaskId,
    duePopoverAnchor,
    setDuePopoverAnchor,
    editingDuration,
    setEditingDuration,
    openMenuTaskId,
    setOpenMenuTaskId,
    menuAnchorEl,
    setMenuAnchorEl,
    menuShowsMoveTargets,
    setMenuShowsMoveTargets,
    openListPickerTaskId,
    setOpenListPickerTaskId,
    listPickerAnchorEl,
    setListPickerAnchorEl,
    openAssignTaskId,
    setOpenAssignTaskId,
    assignAnchorEl,
    setAssignAnchorEl,
  };
}

/** A click anywhere puts the card's menu, list picker or people menu away. */
export function useCardMenusClose(cardMenus: ReturnType<typeof useCardMenusState>) {
  const {
    openMenuTaskId,
    setOpenMenuTaskId,
    setMenuAnchorEl,
    setMenuShowsMoveTargets,
    openListPickerTaskId,
    setOpenListPickerTaskId,
    openAssignTaskId,
    setOpenAssignTaskId,
    setAssignAnchorEl,
  } = cardMenus;
  React.useEffect(() => {
    if (!openMenuTaskId) return;
    const close = () => {
      setOpenMenuTaskId(null);
      setMenuShowsMoveTargets(false);
      setMenuAnchorEl(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuTaskId, setMenuAnchorEl, setMenuShowsMoveTargets, setOpenMenuTaskId]);

  React.useEffect(() => {
    if (!openListPickerTaskId) return;
    const close = () => setOpenListPickerTaskId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openListPickerTaskId, setOpenListPickerTaskId]);

  React.useEffect(() => {
    if (!openAssignTaskId) return;
    const close = () => {
      setOpenAssignTaskId(null);
      setAssignAnchorEl(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openAssignTaskId, setAssignAnchorEl, setOpenAssignTaskId]);
}

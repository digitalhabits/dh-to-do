/**
 * What happens when a task is ticked off, wherever it is ticked off.
 *
 * The board had all of this and the Today session had none of it: the same
 * act, one place cheering and the other silent. It lives here so both do the
 * same thing, and so a change to how finishing a task feels is made once.
 *
 * Everything here works on plain elements and appends to document.body, above
 * the shell — a card flying to the Done list crosses boxes that clip, and the
 * shell itself is one of them.
 */

/** The pause before a finished card leaves, and how long it takes to go. */
export const FLIGHT_HOLD_MS = 180;
export const FLIGHT_GLIDE_MS = 620;
/** Eases in and out: the card sets off gently rather than shooting away. */
export const FLIGHT_GLIDE_EASING = "cubic-bezier(0.35, 0, 0.2, 1)";

/** Whether the reader has asked for less movement. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function waitAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    requestAnimationFrame(() => step(count - 1));
  });
}

/**
 * The cheer, over the box that was just ticked.
 *
 * The board's row and the session's row are built differently and name their
 * parts differently, so the caller says which part is the box. Without one the
 * whole row is the anchor, which still puts the cheer in the right place, only
 * less exactly.
 *
 * A task gets 🎉. A subtask gets a smaller cheer of its own, picked at random
 * from a few, so the small wins do not all look the same.
 */
export const TASK_PARTY_EMOJI = "🎉";
export const SUBTASK_PARTY_EMOJIS = ["✨", "🙌", "💪", "⭐", "👏"] as const;

let lastSubtaskEmoji: string | null = null;

/** One of the subtask cheers, never the same one twice in a row. */
export function randomSubtaskPartyEmoji(): string {
  const choices = SUBTASK_PARTY_EMOJIS.filter((e) => e !== lastSubtaskEmoji);
  const pick = choices[Math.floor(Math.random() * choices.length)];
  lastSubtaskEmoji = pick;
  return pick;
}

export function spawnCompletionParty(
  sourceElement: HTMLElement,
  opts: { anchorSelector?: string; textSelector?: string; emoji?: string } = {}
) {
  const {
    anchorSelector = ".task-checkbox",
    textSelector = ".task-text",
    emoji = TASK_PARTY_EMOJI,
  } = opts;
  // The box, else the words, else the row. Each is a worse guess than the one
  // before it and none of them is wrong.
  const anchorEl =
    sourceElement.querySelector(anchorSelector) ??
    sourceElement.querySelector(textSelector) ??
    sourceElement;
  const anchor = anchorEl.getBoundingClientRect();
  const party = document.createElement("div");
  party.className = "task-completion-party";
  party.textContent = emoji;
  party.style.left = `${Math.round(anchor.left + anchor.width / 2 - 9)}px`;
  party.style.top = `${Math.round(anchor.top - 22)}px`;
  document.body.appendChild(party);
  window.setTimeout(() => party.remove(), 1000);
}

/**
 * A copy of the row, laid over the real one and free to move.
 *
 * The clone is taken before React is told anything, because the moment it is
 * told, the row it would be cloned from is gone.
 */
export function spawnTaskGhost(sourceElement: HTMLElement): {
  startRect: DOMRect;
  wrap: HTMLElement;
  ghost: HTMLElement;
} {
  const startRect = sourceElement.getBoundingClientRect();
  const shell = document.querySelector(".todo-shell");
  const wrap = document.createElement("div");
  // Inherit .todo-shell tokens for the ghost card, but stay transparent —
  // a solid full-screen shell blanked the UI during column slides.
  wrap.className = "todo-shell task-flight-layer";
  const themeAttr = shell?.getAttribute("data-theme");
  if (themeAttr) wrap.setAttribute("data-theme", themeAttr);
  wrap.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2499;background:transparent;";

  const ghost = sourceElement.cloneNode(true) as HTMLElement;
  ghost.classList.add("task-completion-ghost");
  ghost.style.position = "fixed";
  ghost.style.left = `${startRect.left}px`;
  ghost.style.top = `${startRect.top}px`;
  ghost.style.width = `${startRect.width}px`;
  ghost.style.height = `${startRect.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "2500";
  ghost.style.transformOrigin = "top left";
  ghost.style.transition =
    "transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms ease";
  wrap.appendChild(ghost);
  document.body.appendChild(wrap);
  return { startRect, wrap, ghost };
}

/**
 * Wait for a row to exist and have a box of its own.
 *
 * The row the card is flying to is one React has only just been asked to
 * draw, so looking once finds nothing. Give up after 24 frames rather than
 * wait forever: a card that never lands is better than one that never leaves.
 */
export async function waitForElement(
  find: () => HTMLElement | null
): Promise<HTMLElement | null> {
  for (let i = 0; i < 24; i += 1) {
    const found = find();
    if (found) {
      const rect = found.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return found;
    }
    await waitAnimationFrames(1);
  }
  return null;
}

/**
 * Fly the ghost to where the task has landed, then clear it away.
 *
 * Translate only — never scale. A card in a board column is about a third of
 * the width of the done list, and scaling it across stretches the words.
 *
 * The card holds still for a moment first. The tick, the line through the
 * words and the cheer all land in that moment, and the card leaves after them
 * rather than under them.
 */
export async function flyGhostTo(opts: {
  startRect: DOMRect;
  target: HTMLElement;
  wrap: HTMLElement;
  ghost: HTMLElement;
  /** Hide the landing row while the ghost is on its way to it. */
  hideTarget?: boolean;
  /** What answers as the card arrives — the Done bar on the board. */
  receiver?: HTMLElement | null;
}): Promise<void> {
  const { startRect, target, wrap, ghost, hideTarget = true, receiver } = opts;
  const targetRect = target.getBoundingClientRect();
  if (hideTarget) target.style.visibility = "hidden";
  try {
    ghost.style.transition =
      `transform ${FLIGHT_GLIDE_MS}ms cubic-bezier(0.35, 0, 0.2, 1),` +
      ` opacity ${FLIGHT_GLIDE_MS}ms ease`;
    await waitAnimationFrames(1);
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, FLIGHT_HOLD_MS);
    });
    ghost.style.transform = `translate(${targetRect.left - startRect.left}px, ${
      targetRect.top - startRect.top
    }px)`;
    ghost.style.opacity = hideTarget ? "0.92" : "0";

    if (receiver) {
      // The bar answers as the card reaches it, not as it sets off.
      window.setTimeout(() => {
        receiver.classList.add("receiving-task");
        window.setTimeout(() => receiver.classList.remove("receiving-task"), 400);
      }, FLIGHT_GLIDE_MS - 260);
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, FLIGHT_GLIDE_MS + 40);
    });
  } finally {
    if (hideTarget) target.style.visibility = "";
    wrap.remove();
  }
}

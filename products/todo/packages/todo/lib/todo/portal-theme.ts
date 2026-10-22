/**
 * The board's theme, carried onto a popover that lives on document.body.
 *
 * A dropdown or a picker inside a dialog is moved to the body, so the
 * dialog cannot clip it. There it is outside `.todo-shell`, where the
 * theme's colours are set, and every `var(--…)` in its styles comes out
 * empty: a transparent popover over the page. So the shell's values are
 * copied onto the popover, with its light or dark mark.
 */

const PORTAL_THEME_VARS = [
  "--modal-bg",
  "--bg-card",
  "--border-color",
  "--border-color-light",
  "--border-color-medium",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text-tertiary",
  "--accent-color",
  "--accent-primary",
  "--hover-bg",
  "--active-bg",
  "--input-surface",
  "--redd-navy",
  "--redd-teal-soft",
  "--redd-warm-grey",
] as const;

/** Copy the theme of the shell around `inside` onto `popover`. */
export function copyShellTheme(inside: Element | null, popover: HTMLElement) {
  const shell = inside?.closest(".todo-shell");
  if (!shell) return;
  const cs = getComputedStyle(shell);
  for (const name of PORTAL_THEME_VARS) {
    const value = cs.getPropertyValue(name);
    if (value) popover.style.setProperty(name, value);
  }
  const theme = shell.getAttribute("data-theme");
  if (theme) popover.dataset.theme = theme;
  else delete popover.dataset.theme;
}

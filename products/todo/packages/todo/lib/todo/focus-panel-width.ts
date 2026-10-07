/**
 * How wide the focus panel's bar wants to be: the task name on one line,
 * whatever else stands in the bar (the timer), the bar's own padding, and
 * a little air. The panel is never made wider than this, so it cannot be
 * dragged out to a screen of empty yellow. Narrower is fine: the name
 * wraps, and the bar grows taller.
 */

/** Air beyond what the bar holds, so it does not look squeezed. */
const AIR = 24;

let canvas: HTMLCanvasElement | null = null;

/** The width of `text` on one line, in the font `el` is drawn in. */
function oneLineWidth(text: string, el: HTMLElement): number {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return el.scrollWidth;
  const style = getComputedStyle(el);
  ctx.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return ctx.measureText(text).width;
}

export function focusBarNaturalWidth(bar: HTMLElement, name: HTMLElement): number {
  const px = (v: string) => Number.parseFloat(v) || 0;
  const barStyle = getComputedStyle(bar);
  let width = px(barStyle.paddingLeft) + px(barStyle.paddingRight) + AIR;
  for (const child of Array.from(bar.children) as HTMLElement[]) {
    const style = getComputedStyle(child);
    // The buttons and the reset note float over the bar; they take no room.
    if (style.position === "absolute" || style.position === "fixed") continue;
    const margins = px(style.marginLeft) + px(style.marginRight);
    width += margins + (child === name ? oneLineWidth(name.textContent ?? "", name) : child.offsetWidth);
  }
  return Math.ceil(width);
}

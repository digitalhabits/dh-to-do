"use client";

import * as React from "react";

/**
 * The search box: the words typed are its own, and the board follows them
 * as a transition.
 *
 * Every card is drawn by the page, so a change to the page's query draws
 * every card again. With the query held in the page, each key waited for
 * that before the letter showed. Here the letter shows at once, and the
 * board's redraw is work React may set aside when the next key comes, so
 * fast typing draws the board once, for the words that stay.
 *
 * The page can still change the query itself (Escape clears it). Such a
 * value is taken into the box; the values this box sent, which arrive
 * later and in order, are not — or a redraw that ended after a newer key
 * put the older words back.
 */
export function SearchInput({
  value,
  onChange,
  ...inputProps
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = React.useState(value);
  const [, startTransition] = React.useTransition();
  const sent = React.useRef<Set<string>>(new Set());
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!sent.current.has(value)) setText(value);
  }
  React.useEffect(() => {
    // Caught up: what was sent has all arrived.
    if (value === text) sent.current.clear();
  }, [value, text]);
  return (
    <input
      {...inputProps}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        sent.current.add(next);
        startTransition(() => onChange(next));
      }}
    />
  );
}

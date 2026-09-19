"use client";

import * as React from "react";

import {
  getAllListIconIds,
  isListIconPresetId,
  LIST_ICON_PRESETS,
  ListIcon,
  resolveListIconId,
  type ListIconId,
} from "@/lib/todo/list-icons";

/** Nordic-watercolor pastel palette from Digital Habits Blocker. */
export const LIST_COLOUR_PRESETS: { hex: string; title: string }[] = [
  { hex: "#B8D1DE", title: "Sky" },
  { hex: "#B3D2C8", title: "Seafoam" },
  { hex: "#BCD9B6", title: "Fern" },
  { hex: "#EBDCB6", title: "Linen" },
  { hex: "#EECAAD", title: "Peach" },
  { hex: "#E7B3A8", title: "Terracotta" },
  { hex: "#E1BAC3", title: "Rose" },
  { hex: "#C8B9D6", title: "Lilac" },
];

const DEFAULT_CUSTOM_COLOUR = "#B8D1DE";
const ICON_PICKER_LIMIT = 180;

/**
 * Lucide icon + colour rows for list create/edit.
 * Colour stores a hex (or "" for none); icon stores a Lucide kebab id (or "").
 */
export function ListAppearancePicker({
  emoji,
  colour,
  onEmojiChange,
  onColourChange,
  emojiLabel = "Icon",
  colourLabel = "Colour",
}: {
  /** Stored appearance value (Lucide id or legacy emoji); kept as `emoji` for API compat. */
  emoji: string;
  colour: string;
  onEmojiChange: (emoji: string) => void;
  onColourChange: (colour: string) => void;
  emojiLabel?: string;
  colourLabel?: string;
}) {
  const selectedIcon = resolveListIconId(emoji);
  const customIconSelected = Boolean(
    selectedIcon && !isListIconPresetId(selectedIcon)
  );
  const customColour =
    colour.startsWith("#") &&
    !LIST_COLOUR_PRESETS.some((c) => c.hex.toLowerCase() === colour.toLowerCase())
      ? colour
      : DEFAULT_CUSTOM_COLOUR;

  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [iconQuery, setIconQuery] = React.useState("");
  const customIconRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const filteredIcons = React.useMemo(() => {
    const all = getAllListIconIds();
    const q = iconQuery.trim().toLowerCase().replace(/\s+/g, "-");
    const matched = q
      ? all.filter((id) => id.includes(q) || id.replace(/-/g, " ").includes(q))
      : all;
    return matched.slice(0, ICON_PICKER_LIMIT);
  }, [iconQuery]);

  React.useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (customIconRef.current?.contains(t)) return;
      setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  React.useEffect(() => {
    if (!pickerOpen || !popoverRef.current || !customIconRef.current) return;
    const popover = popoverRef.current;
    const swatch = customIconRef.current;
    if (popover.parentElement !== document.body) {
      document.body.appendChild(popover);
    }
    const gap = 8;
    const padding = 8;
    const rect = swatch.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const aboveTop = rect.top - popRect.height - gap;
    const belowTop = rect.bottom + gap;
    let top = aboveTop >= padding ? aboveTop : belowTop;
    top = Math.max(
      padding,
      Math.min(top, window.innerHeight - popRect.height - padding)
    );
    let left = rect.right - popRect.width;
    left = Math.max(
      padding,
      Math.min(left, window.innerWidth - popRect.width - padding)
    );
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    searchRef.current?.focus();
  }, [pickerOpen, filteredIcons.length]);

  React.useEffect(() => {
    return () => {
      const popover = popoverRef.current;
      if (popover?.parentElement === document.body) popover.remove();
    };
  }, []);

  function togglePreset(id: ListIconId) {
    onEmojiChange(selectedIcon === id ? "" : id);
  }

  function pickCustomIcon(id: ListIconId) {
    onEmojiChange(id);
    setPickerOpen(false);
    setIconQuery("");
  }

  return (
    <div className="list-appearance">
      <div className="list-appearance-group">
        <div className="bc-label">{emojiLabel}</div>
        <div className="icon-swatches">
          {LIST_ICON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`icon-swatch${selectedIcon === preset ? " selected" : ""}`}
              aria-label={preset}
              aria-pressed={selectedIcon === preset}
              onClick={() => togglePreset(preset)}
            >
              <ListIcon id={preset} size={16} />
            </button>
          ))}
          <div className="custom-icon-wrapper">
            <button
              ref={customIconRef}
              type="button"
              className={`icon-swatch custom-icon-swatch${
                customIconSelected || pickerOpen ? " selected" : ""
              }`}
              aria-label="Choose any Lucide icon"
              aria-expanded={pickerOpen}
              onClick={() => {
                setPickerOpen((v) => !v);
                if (pickerOpen) setIconQuery("");
              }}
            >
              {customIconSelected && selectedIcon ? (
                <ListIcon id={selectedIcon} size={16} />
              ) : (
                <span className="custom-icon">+</span>
              )}
            </button>
            {pickerOpen ? (
              <div
                ref={popoverRef}
                className="icon-picker-popover todo-icon-picker-popover"
                role="dialog"
                aria-label="Choose Lucide icon"
              >
                <input
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  ref={searchRef}
                  type="search"
                  className="icon-picker-search"
                  placeholder="Search Lucide icons…"
                  value={iconQuery}
                  onChange={(e) => setIconQuery(e.target.value)}
                />
                <div className="icon-picker-grid">
                  {filteredIcons.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`icon-picker-item${
                        selectedIcon === id ? " selected" : ""
                      }`}
                      title={id}
                      aria-label={id}
                      onClick={() => pickCustomIcon(id)}
                    >
                      <ListIcon id={id} size={18} />
                    </button>
                  ))}
                  {filteredIcons.length === 0 ? (
                    <div className="icon-picker-empty">No icons match</div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="list-appearance-group">
        <div className="bc-label">{colourLabel}</div>
        <div className="color-swatches list-color-swatches">
          <button
            type="button"
            className={`color-swatch${colour === "" ? " selected" : ""}`}
            data-color=""
            title="None"
            onClick={() => onColourChange("")}
          />
          {LIST_COLOUR_PRESETS.map((swatch) => (
            <button
              key={swatch.hex}
              type="button"
              className={`color-swatch${
                colour.toLowerCase() === swatch.hex.toLowerCase()
                  ? " selected"
                  : ""
              }`}
              data-color={swatch.hex}
              title={swatch.title}
              style={{ background: swatch.hex }}
              onClick={() => onColourChange(swatch.hex)}
            />
          ))}
          <label
            className={`color-swatch custom-swatch${
              colour.startsWith("#") &&
              !LIST_COLOUR_PRESETS.some(
                (c) => c.hex.toLowerCase() === colour.toLowerCase()
              )
                ? " selected"
                : ""
            }`}
            data-color={customColour}
            title="Custom colour"
            style={{ background: customColour }}
          >
            <span className="custom-icon">+</span>
            <input
              type="color"
              className="custom-color-input"
              aria-label="Custom tab colour"
              value={customColour}
              onChange={(e) => onColourChange(e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

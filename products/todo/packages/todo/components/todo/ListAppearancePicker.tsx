"use client";

import { ImagePlus } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { clampToMenuArea, menuArea } from "@/lib/todo/menu-area";
import { copyShellTheme } from "@/lib/todo/portal-theme";

import { squareImageFile } from "@/lib/todo/avatar-image";
import { describeError } from "@/lib/todo/errors";
import { LIST_LOGOS } from "@/lib/todo/list-logos";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { uploadLocalNoteImage } from "@/lib/todo/note-uploads";
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
  logosLabel = "Our tools",
  uploadLabel = "Upload picture",
  uploadFailedLabel = "The picture could not be added",
}: {
  /** Stored appearance value (Lucide id or legacy emoji); kept as `emoji` for API compat. */
  emoji: string;
  colour: string;
  onEmojiChange: (emoji: string) => void;
  onColourChange: (colour: string) => void;
  emojiLabel?: string;
  colourLabel?: string;
  /** The row of the Digital Habits tools' logos in the icon picker. */
  logosLabel?: string;
  uploadLabel?: string;
  uploadFailedLabel?: string;
}) {
  const selectedIcon = resolveListIconId(emoji);
  const showLogos = !isStandaloneTodo();
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
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

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
    // On document.body, out of the dialog and out of the theme: carry it.
    copyShellTheme(swatch, popover);
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
    // Inside the board, not only the window: see menu-area.
    const left = clampToMenuArea(
      rect.right - popRect.width,
      popRect.width,
      menuArea(swatch),
      padding
    );
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    searchRef.current?.focus();
  }, [pickerOpen, filteredIcons.length]);

  function togglePreset(id: ListIconId) {
    onEmojiChange(selectedIcon === id ? "" : id);
  }

  function pickCustomIcon(id: ListIconId) {
    onEmojiChange(id);
    setPickerOpen(false);
    setIconQuery("");
  }

  /**
   * A picture of the reader's own, as the list's icon: cut square, made
   * small (a list icon is drawn at 14 to 18 pixels), and kept where note
   * pictures are kept, by its media id.
   */
  async function uploadIcon(file: File) {
    setUploading(true);
    try {
      const small = await squareImageFile(file, 128, "image/png");
      const stored = await uploadLocalNoteImage(small, () => {});
      if (!stored.mediaId) throw new Error("no media id");
      pickCustomIcon(`img:${stored.mediaId}`);
    } catch (err) {
      toast.error(describeError(err, uploadFailedLabel));
    } finally {
      setUploading(false);
    }
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
            {pickerOpen && typeof document !== "undefined" ? createPortal(
              <div
                ref={popoverRef}
                className="icon-picker-popover todo-icon-picker-popover"
                role="dialog"
                aria-label="Choose Lucide icon"
              >
                {/* Our tools' logos are for the Planner (web and app) only. A
                    list that already has one still shows it everywhere. */}
                {showLogos ? (
                  <div className="icon-picker-section-label">{logosLabel}</div>
                ) : null}
                <div className="icon-picker-grid icon-picker-logos">
                  {(showLogos ? LIST_LOGOS : []).map((logo) => {
                    const id = `logo:${logo.id}` as const;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`icon-picker-item${selectedIcon === id ? " selected" : ""}`}
                        title={logo.label}
                        aria-label={logo.label}
                        onClick={() => pickCustomIcon(id)}
                      >
                        <ListIcon id={id} size={20} />
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="icon-picker-item icon-picker-upload"
                    title={uploadLabel}
                    aria-label={uploadLabel}
                    disabled={uploading}
                    onClick={() => uploadRef.current?.click()}
                  >
                    <ImagePlus size={18} aria-hidden="true" />
                  </button>
                  <input
                    ref={uploadRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // The same file twice in a row must still count.
                      e.target.value = "";
                      if (file) void uploadIcon(file);
                    }}
                  />
                </div>
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
              </div>,
              /*
                A portal, not the node moved by hand: React then still hears
                its clicks. Moved by hand to the body, outside the desktop
                app's root (#root), no choice in it ever reached React.
              */
              document.body
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

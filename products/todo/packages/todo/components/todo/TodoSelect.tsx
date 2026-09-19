"use client";

import * as React from "react";
import { createPortal } from "react-dom";

export type TodoSelectOption = { value: string; label: string };

const THEME_VARS = [
  "--modal-bg",
  "--border-color-light",
  "--border-color-medium",
  "--text-primary",
  "--text-muted",
  "--text-tertiary",
  "--accent-color",
  "--accent-primary",
] as const;

/** Custom select matching the settings language-picker / settings-select look. */
export function TodoSelect({
  value,
  options,
  placeholder,
  disabled,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: string;
  options: TodoSelectOption[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const positionDropdown = React.useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;

    const shell = rootRef.current?.closest(".todo-shell");
    if (shell) {
      const cs = getComputedStyle(shell);
      for (const name of THEME_VARS) {
        const v = cs.getPropertyValue(name);
        if (v) dropdown.style.setProperty(name, v);
      }
      const theme = shell.getAttribute("data-theme");
      if (theme) dropdown.dataset.theme = theme;
      else delete dropdown.dataset.theme;
    }

    const gap = 6;
    const padding = 8;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = rect.width;

    dropdown.style.width = `${width}px`;
    dropdown.style.left = `${Math.max(
      padding,
      Math.min(rect.left, vw - width - padding)
    )}px`;
    dropdown.style.maxHeight = "";

    const menuHeight = dropdown.scrollHeight;
    const spaceBelow = vh - rect.bottom - gap - padding;
    const spaceAbove = rect.top - gap - padding;
    const openUp =
      spaceBelow < Math.min(menuHeight, 240) && spaceAbove > spaceBelow;

    if (openUp) {
      const maxHeight = Math.max(120, Math.min(240, spaceAbove));
      dropdown.style.maxHeight = `${maxHeight}px`;
      const height = Math.min(dropdown.scrollHeight, maxHeight);
      dropdown.style.top = `${Math.max(padding, rect.top - gap - height)}px`;
      dropdown.dataset.placement = "top";
    } else {
      const maxHeight = Math.max(120, Math.min(240, spaceBelow));
      dropdown.style.maxHeight = `${maxHeight}px`;
      dropdown.style.top = `${rect.bottom + gap}px`;
      dropdown.dataset.placement = "bottom";
    }
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    positionDropdown();
    const onReposition = () => positionDropdown();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, options.length, positionDropdown]);

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder;

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  const dropdown =
    open && mounted ? (
      <div
        ref={dropdownRef}
        className="todo-select-dropdown todo-select-dropdown--portal"
        role="listbox"
      >
        <button
          type="button"
          className={`todo-select-option${!value ? " todo-select-option--current" : ""}`}
          role="option"
          aria-selected={!value}
          onClick={() => choose("")}
        >
          <span className="todo-select-option-label">{placeholder}</span>
        </button>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`todo-select-option${
              opt.value === value ? " todo-select-option--current" : ""
            }`}
            role="option"
            aria-selected={opt.value === value}
            onClick={() => choose(opt.value)}
          >
            <span className="todo-select-option-label">{opt.label}</span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div
      className={`todo-select${open ? " todo-select--open" : ""}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="todo-select-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`todo-select-label${selected ? "" : " todo-select-label--placeholder"}`}
        >
          {label}
        </span>
        <svg
          className="todo-select-chevron"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 10l5-4.5 5 4.5" />
          <path d="M7 14l5 4.5 5-4.5" />
        </svg>
      </button>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

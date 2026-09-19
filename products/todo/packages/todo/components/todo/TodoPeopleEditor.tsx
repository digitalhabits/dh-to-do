"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Camera, Check, ImageOff, Pencil, User } from "lucide-react";

import {
  colourForPerson,
  initialsOf,
  shortPersonName,
} from "@/lib/todo/people";
import type { TodoPerson, TodoPersonCandidate } from "@/lib/todo/types";

export function TodoPersonAvatar({
  name,
  colour,
  photoUrl,
  size = 28,
}: {
  name: string;
  colour?: string | null;
  photoUrl?: string | null;
  size?: number;
}) {
  const bg = colourForPerson(name, colour);
  // A photo that will not load shows the initials, not a broken image.
  const [photoFailed, setPhotoFailed] = React.useState(false);
  React.useEffect(() => setPhotoFailed(false), [photoUrl]);
  if (photoUrl && !photoFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        className="todo-person-avatar todo-person-avatar-photo"
        style={{ width: size, height: size }}
        onError={() => setPhotoFailed(true)}
      />
    );
  }
  return (
    <span
      className="todo-person-avatar"
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: size * 0.36,
      }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

/** Overlapping assignee avatars on a task card (max 3 + leftover count). */
export function TaskAssigneeStack({
  people,
  size = 20,
}: {
  people: TodoPerson[];
  size?: number;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  const overlap = Math.round(size * 0.35);
  const width = size + (shown.length - 1) * (size - overlap) + (extra > 0 ? size - overlap : 0);
  return (
    <span
      className="assign-avatar-stack"
      style={{ width, height: size }}
      aria-hidden
    >
      {shown.map((person, i) => (
        <span
          key={person.id}
          className="assign-avatar-stack-item"
          style={{ left: i * (size - overlap), zIndex: i + 1, width: size, height: size }}
        >
          <TodoPersonAvatar
            name={person.name}
            colour={person.colour}
            photoUrl={person.photoUrl}
            size={size}
          />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className="assign-avatar-stack-extra"
          style={{
            left: shown.length * (size - overlap),
            zIndex: shown.length + 1,
            width: size,
            height: size,
            fontSize: size * 0.38,
          }}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

/** Assignment picker — portaled to body so board column overflow/mask can't clip it. */
export function TaskAssignMenu({
  open,
  anchorEl,
  people,
  assigneeIds,
  t,
  onToggle,
  onEditPeople,
  onClose,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  people: TodoPerson[];
  assigneeIds: string[];
  t: (key: string) => string;
  onToggle: (personId: string) => void;
  onEditPeople: () => void;
  /** Escape, and Enter once a person is picked. Without it the menu stays. */
  onClose?: () => void;
}) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  /** The row the arrow keys are on. */
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [coords, setCoords] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useLayoutEffect(() => {
    if (!open || !anchorEl || !menuRef.current) {
      setCoords(null);
      return;
    }
    const place = () => {
      const menu = menuRef.current;
      if (!menu || !anchorEl.isConnected) return;
      const rect = anchorEl.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const gap = 4;
      const pad = 8;
      let top = rect.bottom + gap;
      if (top + menuRect.height > window.innerHeight - pad) {
        top = rect.top - menuRect.height - gap;
      }
      top = Math.max(
        pad,
        Math.min(top, window.innerHeight - menuRect.height - pad)
      );
      let left = rect.right - menuRect.width;
      left = Math.max(
        pad,
        Math.min(left, window.innerWidth - menuRect.width - pad)
      );
      setCoords({ top, left });
    };
    place();
    // Second pass after first paint so height is accurate when flipping up.
    requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorEl, people.length, assigneeIds]);

  /**
   * The menu takes the caret when it opens, so the arrow keys reach it
   * without a click first. It starts on the person already assigned, or on
   * the first one.
   */
  React.useEffect(() => {
    if (!open) return;
    const first = people.findIndex((person) => assigneeIds.includes(person.id));
    setActiveIndex(first >= 0 ? first : 0);
    const frame = requestAnimationFrame(() => menuRef.current?.focus());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, people.length]);

  /* A click anywhere else puts it away, so opening another picker or clicking
     the page never leaves it hanging. The menu swallows its own pointerdown,
     and the anchor is left to toggle itself. */
  React.useEffect(() => {
    if (!open || !onClose) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (anchorEl?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, anchorEl, onClose]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (people.length === 0) {
      if (event.key === "Escape") onClose?.();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (index) => (index + step + people.length) % people.length
      );
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const person = people[activeIndex];
      if (!person) return;
      onToggle(person.id);
      // Enter is done with the menu. Space keeps it up for a second person.
      if (event.key === "Enter") onClose?.();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
    }
  }

  if (!mounted || !open) return null;

  const shell = document.querySelector(".todo-shell");
  const theme = shell?.getAttribute("data-theme");
  const selectedSet = new Set(assigneeIds);

  return createPortal(
    <div
      className="todo-shell assign-menu-portal-root"
      data-theme={theme || undefined}
    >
      <div
        ref={menuRef}
        className="assign-menu assign-menu-portal"
        role="listbox"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={
          coords
            ? { top: coords.top, left: coords.left }
            : { top: 0, left: 0, visibility: "hidden" }
        }
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {people.length === 0 ? (
          <div className="assign-menu-empty">{t("noPeopleYet")}</div>
        ) : (
          people.map((person, index) => {
            const selected = selectedSet.has(person.id);
            return (
              <button
                key={person.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`assign-menu-item ${selected ? "selected" : ""}${
                  index === activeIndex ? " is-active" : ""
                }`}
                // The menu keeps the caret, so hovering moves the arrow row
                // instead of taking focus away from it.
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onToggle(person.id)}
              >
                <TodoPersonAvatar
                  name={person.name}
                  colour={person.colour}
                  photoUrl={person.photoUrl}
                  size={26}
                />
                <span className="assign-menu-item-name">
                  {shortPersonName(person.name)}
                </span>
                {selected ? (
                  <Check
                    className="assign-menu-check"
                    size={16}
                    strokeWidth={2.5}
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })
        )}
        <div className="assign-menu-divider" />
        <button
          type="button"
          className="assign-menu-item assign-edit"
          onClick={onEditPeople}
        >
          <Pencil size={14} strokeWidth={2} />
          {t("editPeople")}
        </button>
      </div>
    </div>,
    document.body
  );
}

export function TodoPeopleEditor({
  open,
  people,
  t,
  onClose,
  onAdd,
  onRemove,
  onSearch,
  onSetPhoto,
  meIds = [],
  onSetMe,
}: {
  open: boolean;
  people: TodoPerson[];
  t: (key: string) => string;
  onClose: () => void;
  onAdd: (candidate: TodoPersonCandidate | { name: string }) => Promise<unknown>;
  onRemove: (id: string) => Promise<void>;
  onSearch: (query: string) => Promise<TodoPersonCandidate[]>;
  /** A picture for the person's avatar, or null to go back to initials. */
  onSetPhoto?: (personId: string, file: File | null) => Promise<void>;
  /** The people who are the reader. They show a "Me" mark. */
  meIds?: string[];
  /**
   * Marks one person as the reader, or nobody with null. Given where no
   * login says who the reader is: the desktop app. With it the board gets
   * "My tasks" and "Everyone".
   */
  onSetMe?: (personId: string | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<TodoPersonCandidate[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  /** The person whose picture is on its way. */
  const [photoBusyId, setPhotoBusyId] = React.useState<string | null>(null);
  const photoInputRef = React.useRef<HTMLInputElement | null>(null);
  const photoForRef = React.useRef<string | null>(null);

  async function setPhoto(personId: string, file: File | null) {
    if (!onSetPhoto) return;
    setPhotoBusyId(personId);
    try {
      await onSetPhoto(personId, file);
    } finally {
      setPhotoBusyId(null);
    }
  }
  const rosterKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const p of people) {
      if (p.sourceKind && p.sourceId) {
        keys.add(`${p.sourceKind}:${p.sourceId}`);
      }
      keys.add(`name:${p.name.trim().toLowerCase()}`);
    }
    return keys;
  }, [people]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void onSearch(q).then((rows) => {
        if (cancelled) return;
        setResults(
          rows.filter(
            (r) =>
              !rosterKeys.has(r.key) &&
              !rosterKeys.has(`name:${r.name.trim().toLowerCase()}`)
          )
        );
        setSearching(false);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, onSearch, rosterKeys]);

  if (!open) return null;

  async function pick(candidate: TodoPersonCandidate | { name: string }) {
    setAdding(true);
    try {
      await onAdd(candidate);
      setQuery("");
      setResults([]);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div
      className="modal-overlay people-editor-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="people-editor"
        role="dialog"
        aria-label={t("peopleTitle")}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="people-editor-header">
          <span className="people-editor-title">{t("peopleTitle")}</span>
          <button type="button" className="people-editor-done" onClick={onClose}>
            {t("done")}
          </button>
        </header>

        <div className="people-editor-list">
          {people.length === 0 ? (
            <p className="people-editor-empty">{t("noPeopleYet")}</p>
          ) : (
            people.map((person) => (
              <div key={person.id} className="people-editor-row">
                {onSetPhoto ? (
                  <button
                    type="button"
                    className={`people-editor-avatar-btn${
                      photoBusyId === person.id ? " is-busy" : ""
                    }`}
                    title={person.photoUrl ? t("changePhoto") : t("addPhoto")}
                    aria-label={`${person.photoUrl ? t("changePhoto") : t("addPhoto")}: ${person.name}`}
                    disabled={photoBusyId !== null}
                    onClick={() => {
                      photoForRef.current = person.id;
                      photoInputRef.current?.click();
                    }}
                  >
                    <TodoPersonAvatar
                      name={person.name}
                      colour={person.colour}
                      photoUrl={person.photoUrl}
                    />
                    <span className="people-editor-avatar-camera" aria-hidden>
                      <Camera size={13} strokeWidth={2.2} />
                    </span>
                  </button>
                ) : (
                  <TodoPersonAvatar
                    name={person.name}
                    colour={person.colour}
                    photoUrl={person.photoUrl}
                  />
                )}
                <span className="people-editor-name">
                  {shortPersonName(person.name)}
                </span>
                {onSetMe ? (
                  <button
                    type="button"
                    className={`people-editor-me${
                      meIds.includes(person.id) ? " is-me" : ""
                    }${meIds.length === 0 ? " is-offered" : ""}`}
                    title={meIds.includes(person.id) ? t("meMarked") : t("thisIsMe")}
                    aria-pressed={meIds.includes(person.id)}
                    onClick={() =>
                      onSetMe(meIds.includes(person.id) ? null : person.id)
                    }
                  >
                    {t("meBadge")}
                  </button>
                ) : meIds.includes(person.id) ? (
                  <span className="people-editor-me is-me is-fixed">{t("meBadge")}</span>
                ) : null}
                {onSetPhoto && person.photoUrl ? (
                  <button
                    type="button"
                    className="people-editor-remove people-editor-remove-photo"
                    title={t("removePhoto")}
                    aria-label={`${t("removePhoto")}: ${person.name}`}
                    disabled={photoBusyId !== null}
                    onClick={() => void setPhoto(person.id, null)}
                  >
                    <ImageOff size={15} strokeWidth={2} aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="people-editor-remove"
                  title={t("delete")}
                  onClick={() => void onRemove(person.id)}
                >
                  ×
                </button>
              </div>
            ))
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              const personId = photoForRef.current;
              // The same file twice in a row must still count as a choice.
              e.target.value = "";
              if (file && personId) void setPhoto(personId, file);
            }}
          />
        </div>

        <div className="people-editor-add">
          <div className="people-editor-add-row">
            <User size={16} strokeWidth={2} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              className="people-editor-add-input"
              placeholder={t("addPerson")}
              value={query}
              disabled={adding}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim()) {
                  e.preventDefault();
                  const first = results[0];
                  void pick(first ?? { name: query.trim() });
                }
                if (e.key === "Escape") {
                  if (query) setQuery("");
                  else onClose();
                }
              }}
            />
          </div>
          {query.trim() ? (
            <div className="people-editor-suggestions">
              {searching ? (
                <div className="people-editor-suggestion muted">
                  {t("searchingPeople")}
                </div>
              ) : results.length === 0 ? (
                <button
                  type="button"
                  className="people-editor-suggestion"
                  disabled={adding}
                  onClick={() => void pick({ name: query.trim() })}
                >
                  <TodoPersonAvatar name={query.trim()} size={24} />
                  <span>
                    Add “{query.trim()}”
                  </span>
                </button>
              ) : (
                results.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    className="people-editor-suggestion"
                    disabled={adding}
                    onClick={() => void pick(row)}
                  >
                    <TodoPersonAvatar
                      name={row.name}
                      photoUrl={row.photoUrl}
                      size={24}
                    />
                    <span className="people-editor-suggestion-text">
                      <span>{shortPersonName(row.name)}</span>
                      {row.subtitle ? (
                        <span className="people-editor-suggestion-sub">
                          {row.subtitle}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

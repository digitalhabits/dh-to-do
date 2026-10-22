"use client";

/* The info button and the row label that opens it, shared by the Settings rows. */

import * as React from "react";

export function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

/** A row's name with an info button; the info opens under it as the row's hint. */
export function SettingsInfoLabel({
  label,
  open,
  onToggle,
  t,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  t: (key: string) => string;
  /** What the hint shows when the info is open. */
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="settings-row-label-line">
        <span className="settings-row-label">{label}</span>
        <button
          type="button"
          className="info-toggle-btn settings-info-btn"
          aria-label={t("moreInfo")}
          aria-expanded={open}
          onClick={onToggle}
        >
          <InfoIcon />
        </button>
      </div>
      {open ? <div className="settings-row-hint">{children}</div> : null}
    </>
  );
}


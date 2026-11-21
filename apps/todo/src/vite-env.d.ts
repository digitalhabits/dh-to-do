/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mac" or "windows", set only by scripts/build-mas-package.cjs and scripts/build-win-store.ps1. */
  readonly VITE_TODO_STORE?: string;
  /** A test build only: "1" shows the review prompt soon after each start. */
  readonly VITE_TODO_PREVIEW_REVIEW?: string;
}

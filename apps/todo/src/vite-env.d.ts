/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mac" or "windows", set only by scripts/build-mas-package.cjs and scripts/build-win-store.ps1. */
  readonly VITE_TODO_STORE?: string;
}

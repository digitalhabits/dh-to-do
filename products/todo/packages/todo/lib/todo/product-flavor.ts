/**
 * Standalone store app vs Planner-hosted To-Do tab.
 *
 * Standalone (apps/todo) sets window.__TODO_PRODUCT_FLAVOR__ and Vite
 * `define` for process.env.NEXT_PUBLIC_ / VITE_TODO_PRODUCT_FLAVOR.
 */

export type TodoProductFlavor = "planner" | "standalone";

declare global {
  interface Window {
    __TODO_PRODUCT_FLAVOR__?: TodoProductFlavor;
  }
}

export function getTodoProductFlavor(): TodoProductFlavor {
  if (typeof window !== "undefined") {
    const fromWindow = window.__TODO_PRODUCT_FLAVOR__;
    if (fromWindow === "standalone" || fromWindow === "planner") {
      return fromWindow;
    }
  }
  // Standalone Vite sets process.env via define + window above; Next uses
  // NEXT_PUBLIC_*. Do not read import.meta here — webpack warns on it.
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_TODO_PRODUCT_FLAVOR ??
        process.env.VITE_TODO_PRODUCT_FLAVOR
      : undefined;
  if (fromEnv === "standalone") return "standalone";
  return "planner";
}

export function isStandaloneTodo(): boolean {
  return getTodoProductFlavor() === "standalone";
}

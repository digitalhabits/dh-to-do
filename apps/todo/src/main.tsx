import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import { TodoFocusPanel } from "@/components/todo/TodoFocusPanel";
import { TodoPage } from "@/components/todo/TodoPage";
import { todoHostApi } from "@/lib/todo/standalone-api";
import { TODO_APP_VERSION } from "@/lib/todo/version";

import "react-quill-new/dist/quill.snow.css";
import "react-quill-new/dist/quill.bubble.css";
import "@/todo.css";
import "@/todo-shell.css";
import "./standalone.css";

window.__TODO_PRODUCT_FLAVOR__ = "standalone";

/**
 * One bundle, two windows. The main window mounts the board. The focus
 * window (an NSPanel that Rust opens at `index.html?focus=1&…`, see
 * src-tauri/src/focus.rs) mounts only the focus bar. The task's id, title,
 * duration and elapsed time travel in the URL, so the bar paints at once.
 * The panel reads and writes tasks through the same SQLite bridge as the
 * board.
 */
function FocusWindow({ params }: { params: URLSearchParams }) {
  const taskId = params.get("taskId");
  if (!taskId) return null;
  const elapsed = Number(params.get("elapsed"));
  const duration = Number(params.get("duration"));
  return (
    <TodoFocusPanel
      initialTaskId={taskId}
      initialTitle={params.get("title")?.trim() || undefined}
      initialDurationMinutes={
        Number.isFinite(duration) && duration > 0 ? duration : null
      }
      initialFullscreen={params.get("fullscreen") === "1"}
      initialElapsedMs={Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0}
      // Two focus windows can be up at once. The second wears another colour.
      slot={params.get("slot") === "2" ? 2 : 1}
      api={todoHostApi}
    />
  );
}

const params = new URLSearchParams(window.location.search);
const isFocusWindow = params.get("focus") === "1";
if (isFocusWindow) {
  // Lets standalone.css drop the opaque page background: the panel is a
  // transparent window with its own rounded bar.
  document.documentElement.classList.add("focus-window");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isFocusWindow ? (
      <FocusWindow params={params} />
    ) : (
      <>
        <TodoPage initialState={null} appVersion={TODO_APP_VERSION} />
        <Toaster position="bottom-center" richColors closeButton />
      </>
    )}
  </React.StrictMode>
);

import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.resolve(__dirname, "../..");
const todoPkg = path.resolve(root, "products/todo/packages/todo");
/** Code shared by every app — see packages/shared. */
const shared = path.resolve(root, "packages/shared");

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 3472,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
  },
  define: {
    "process.env.NEXT_PUBLIC_TODO_PRODUCT_FLAVOR": JSON.stringify("standalone"),
    "process.env.VITE_TODO_PRODUCT_FLAVOR": JSON.stringify("standalone"),
  },
  resolve: {
    alias: [
      {
        find: "next/dynamic",
        replacement: path.resolve(__dirname, "src/seams/next-dynamic.tsx"),
      },
      {
        find: "@/lib/offline/use-todo-offline",
        replacement: path.resolve(__dirname, "src/seams/use-todo-offline-stub.ts"),
      },
      {
        find: "@/lib/offline/todo-offline",
        replacement: path.resolve(__dirname, "src/seams/todo-offline-stub.ts"),
      },
      {
        find: "@/lib/page-snapshot-cache",
        replacement: path.resolve(__dirname, "src/seams/page-snapshot-cache.ts"),
      },
      {
        find: "@/components/todo/TodoOfflineStatusPill",
        replacement: path.resolve(
          __dirname,
          "src/seams/TodoOfflineStatusPill.tsx"
        ),
      },
      {
        find: "@/lib/native-shell",
        replacement: path.resolve(todoPkg, "lib/todo/native-bridge.ts"),
      },
      {
        find: "@/lib/utils",
        replacement: path.resolve(shared, "lib/utils.ts"),
      },
      {
        find: "@/lib/plan/errors",
        replacement: path.resolve(shared, "lib/plan/errors.ts"),
      },
      { find: "@", replacement: todoPkg },
    ],
  },
});

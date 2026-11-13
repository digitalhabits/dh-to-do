import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.resolve(__dirname, "../..");
const todoPkg = path.resolve(root, "products/todo/packages/todo");

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 3472,
    strictPort: true,
    // Cargo's output is not the page. On Windows a watch on a file that
    // cargo holds open fails with EBUSY and stops the dev server.
    watch: { ignored: ["**/src-tauri/**"] },
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
      { find: "@", replacement: todoPkg },
    ],
  },
});

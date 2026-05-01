import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  // Tauri expects a fixed port in dev
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Env variables starting with VITE_ are exposed to the client
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari15",
    // don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (
            id.includes("\\react\\") ||
            id.includes("/react/") ||
            id.includes("\\react-dom\\") ||
            id.includes("/react-dom/")
          ) {
            return "vendor_react";
          }
          if (id.includes("@tauri-apps")) return "vendor_tauri";
          if (id.includes("@monaco-editor")) return "vendor_monaco";
          if (id.includes("@xyflow")) return "vendor_graph";
          if (id.includes("lucide-react")) return "vendor_icons";
          if (
            id.includes("@tanstack") ||
            id.includes("zustand") ||
            id.includes("sonner") ||
            id.includes("sql-formatter")
          ) {
            return "vendor_ui";
          }
          if (
            id.includes("@anthropic-ai") ||
            id.includes("@google/genai") ||
            id.includes("\\openai\\") ||
            id.includes("/openai/")
          ) {
            return "vendor_ai";
          }
          if (id.includes("framer-motion")) return "vendor_motion";
          if (id.includes("xlsx")) return "vendor_xlsx";
        },
      },
    },
  },
}));

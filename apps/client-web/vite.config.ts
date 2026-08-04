import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/openBMB/",
  plugins: [react()],
  test: {
    // Keep all user Web and companion-mode unit tests in this workspace.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tmp/**", "node_modules/**", "dist/**"],
  },
  server: {
    host: "127.0.0.1",
    port: 4310,
    proxy: {
      "/openBMB/api": {
        target: "http://127.0.0.1:13100",
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4310,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri v2: dev server phải chạy cố định ở cổng 1420.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});

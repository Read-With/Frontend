import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "https://dev.readwith.store",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 5183 so it can run next to the current app (5181).
export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5183, strictPort: true },
});

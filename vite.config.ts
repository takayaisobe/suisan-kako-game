import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 本番ビルドは相対パス（base: './'）にして、GitHub Pages のサブパス配信でも
// アセットが解決できるようにする。開発時は '/'。
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
  },
}));

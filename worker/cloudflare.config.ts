import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  accountId: "005bec1d73eb20962f202beec0caa958",
  worker: {
    name: "tryclockin",
    entrypoint: "./src/index.js",
    compatibilityDate: "2026-11-27",
    env: {
      DB: bindings.d1({
        name: "tryclockin",
        id: "59bf54cc-c7df-4386-8e8c-800ac07c8c73",
      }),
      FILES: bindings.r2({ name: "tryclockin-files" }),
    },
  },
});

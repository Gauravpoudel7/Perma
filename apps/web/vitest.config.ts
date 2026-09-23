import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next preserves JSX and compiles it with the automatic runtime. Vitest's
  // default classic transform expects a `React` import, which these components
  // do not have.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});

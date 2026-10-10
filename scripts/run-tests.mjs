import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

// Keep test behavior independent of NODE_ENV in the invoking shell.
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("vitest.mjs", import.meta.resolve("vitest/package.json")),
    ),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: { ...process.env, NODE_ENV: "test" } },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);

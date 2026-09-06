import { spawnSync } from "node:child_process";

const target = process.argv[2] ?? "mobile";

if (target !== "mobile" && target !== "web") {
  throw new Error("Target build harus 'mobile' atau 'web'.");
}

const result = spawnSync(process.execPath, ["x", "next", "build"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    APP_BUILD_TARGET: target,
    NEXT_PUBLIC_APP_RUNTIME: target,
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

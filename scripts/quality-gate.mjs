#!/usr/bin/env node
// Code quality gate: CRAP and maintainability index for edited code.
// Run by .githooks/pre-push; see scripts/quality/cli.mjs for options.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./quality/cli.mjs";

const REPORT_DIR = ".quality";

function runCoverage(files) {
  rmSync(REPORT_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "vitest", "run", "--silent",
      "--coverage.enabled=true", "--coverage.provider=v8",
      "--coverage.reporter=json", `--coverage.reportsDirectory=${REPORT_DIR}`,
      ...files.map((file) => `--coverage.include=${file}`),
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  return JSON.parse(readFileSync(`${REPORT_DIR}/coverage-final.json`, "utf8"));
}

function main() {
  try {
    return run(process.argv.slice(2), io);
  } catch (err) {
    console.error(`\n✗ quality gate could not run: ${err.message.split("\n")[0]}`);
    return 1;
  }
}

const io = {
  git: (args) => execFileSync("git", args, { encoding: "utf8" }),
  exists: existsSync,
  readFile: (file) => readFileSync(file, "utf8"),
  resolve: (file) => resolve(file),
  runCoverage,
  log: (line) => console.log(line),
};

process.exitCode = main();

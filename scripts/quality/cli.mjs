import { parseArgs } from "node:util";
import { changedLines } from "./diff.mjs";
import { DEFAULTS, checkFile, isGatedFile, pct } from "./gate.mjs";

export const USAGE = `Usage: quality-gate [--base <ref>] [--head <ref>] [--all] [--max-crap N] [--min-mi N] [files...]

Fails when an edited function has CRAP > ${DEFAULTS.maxCrap} or MI <= ${DEFAULTS.minMi},
or an edited file has MI <= ${DEFAULTS.minMi} (171-point scale).

  files       check every function in these files instead of the diff
  --base      diff against this ref (default: merge-base with origin/HEAD)
  --head      diff up to this commit (default: the working tree)
  --all       check every function in the changed files, not just edited ones
  --verbose   list every checked function, not just each file's worst`;

const OPTIONS = {
  base: { type: "string" },
  head: { type: "string" },
  all: { type: "boolean" },
  "max-crap": { type: "string" },
  "min-mi": { type: "string" },
  help: { type: "boolean" },
  verbose: { type: "boolean" },
};

/**
 * Runs the gate. `io` supplies git, the file system, the coverage run and
 * logging so this stays testable. Returns the process exit code.
 */
export function run(argv, io) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  if (values.help) return io.log(USAGE) ?? 0;
  const targets = positionals.length ? explicitTargets(positionals) : diffTargets(values, io);
  if (targets.size === 0) return io.log("quality gate: no code changes to check") ?? 0;
  const coverage = io.runCoverage([...targets.keys()]);
  const limits = limitsFrom(values);
  const results = [...targets].map(([file, changed]) =>
    checkFile({ file, code: io.readFile(file), coverage: coverage[io.resolve(file)], changed, limits })
  );
  return report(results, values.verbose ? formatFile : formatWorst, io.log);
}

function explicitTargets(files) {
  return new Map(files.filter(isGatedFile).map((file) => [file, null]));
}

function diffTargets(values, io) {
  const range = [values.base ?? io.git(["merge-base", "HEAD", "origin/HEAD"]).trim()];
  if (values.head) range.push(values.head);
  const diff = io.git(["diff", "--unified=0", "--diff-filter=AMR", "--no-color", ...range]);
  const changed = [...changedLines(diff), ...untracked(values, io)];
  const gated = changed.filter(([file]) => isGatedFile(file) && io.exists(file));
  return new Map(gated.map(([file, lines]) => [file, values.all ? null : lines]));
}

/** New files not yet committed count as wholly edited (working-tree runs only). */
function untracked(values, io) {
  if (values.head) return [];
  const files = io.git(["ls-files", "--others", "--exclude-standard"]).split("\n");
  return files.filter(Boolean).map((file) => [file, null]);
}

function limitsFrom(values) {
  return {
    maxCrap: Number(values["max-crap"] ?? DEFAULTS.maxCrap),
    minMi: Number(values["min-mi"] ?? DEFAULTS.minMi),
  };
}

function report(results, format, log) {
  results.forEach((result) => log(format(result)));
  const violations = results.flatMap((r) => r.violations);
  log(violations.length ? `\n✗ quality gate failed:\n  ${violations.join("\n  ")}` : "\n✓ quality gate passed");
  return violations.length ? 1 : 0;
}

/** The file line plus its riskiest function. */
export function formatWorst(result) {
  const [worst] = [...result.functions].sort((a, b) => b.crap - a.crap || a.mi - b.mi);
  return formatFile({ ...result, functions: worst ? [worst] : [] });
}

export function formatFile({ file, mi, functions }) {
  const rows = functions.map(
    (f) => `  ${f.name.padEnd(28)} CC ${String(f.cc).padStart(2)}  cov ${pct(f.coverage).padStart(4)}  CRAP ${f.crap.toFixed(1).padStart(5)}  MI ${f.mi.toFixed(1)}`
  );
  return [`${file}  (file MI ${mi.toFixed(1)})`, ...rows].join("\n");
}

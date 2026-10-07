import { analyzeSource } from "./metrics.mjs";
import { crap, functionCoverage } from "./coverage.mjs";

export const DEFAULTS = { maxCrap: 8, minMi: 75 };

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const NOT_GATED = /(\.test\.|\.spec\.|\.d\.ts$|(^|\/)(node_modules|dist|coverage)\/)/;

export function isGatedFile(path) {
  return CODE_FILE.test(path) && !NOT_GATED.test(path);
}

/**
 * Checks one file. `changed` is the set of edited line numbers, or null to
 * check every function. Returns { file, mi, functions, violations }.
 */
export function checkFile({ file, code, coverage, changed, limits = DEFAULTS }) {
  const { functions, mi } = analyzeSource(code, file);
  const rows = functions
    .filter((fn) => !fn.isModule && touches(fn, changed))
    .map((fn) => scoreFunction(fn, coverage));
  const violations = rows.flatMap((row) => functionViolations(row, limits));
  if (mi <= limits.minMi) violations.push(`file MI ${mi.toFixed(1)} ≤ ${limits.minMi}`);
  return { file, mi, functions: rows, violations: violations.map((v) => `${file}: ${v}`) };
}

function touches(fn, changed) {
  if (!changed) return true;
  for (let line = fn.start.line; line <= fn.end.line; line++) {
    if (changed.has(line)) return true;
  }
  return false;
}

function scoreFunction(fn, fileCoverage) {
  const coverage = functionCoverage(fn, fileCoverage);
  return { name: fn.name, line: fn.line, cc: fn.cc, coverage, crap: crap(fn.cc, coverage), mi: fn.mi };
}

function functionViolations(row, limits) {
  const where = `${row.name} (line ${row.line})`;
  const out = [];
  if (row.crap > limits.maxCrap) {
    out.push(`${where} CRAP ${row.crap.toFixed(1)} > ${limits.maxCrap} (CC ${row.cc}, ${pct(row.coverage)} covered)`);
  }
  if (row.mi <= limits.minMi) out.push(`${where} MI ${row.mi.toFixed(1)} ≤ ${limits.minMi}`);
  return out;
}

export function pct(fraction) {
  return `${Math.round(fraction * 100)}%`;
}

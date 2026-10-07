// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeSource, branchCount, functionName, maintainability } from "./metrics.mjs";
import { crap, functionCoverage } from "./coverage.mjs";
import { changedLines } from "./diff.mjs";
import { checkFile, isGatedFile } from "./gate.mjs";
import { USAGE, formatFile, formatWorst, run } from "./cli.mjs";

const SAMPLE = `import type { X } from "x";
interface Shape { a: number }
export function grade(n: number): string {
  if (n > 90) return "A";
  for (const x of [1]) { void x; }
  const f = () => (n ? 1 : 2);
  return n >= 50 && n < 60 ? "C" : "F";
}
switch (1) { case 1: break; default: }
try {} catch {}
let y = null; y ??= 1; y ||= 2;
`;

const byName = (code, file = "s.ts") =>
  Object.fromEntries(analyzeSource(code, file).functions.map((f) => [f.name, f]));

describe("metrics", () => {
  it("counts branches per function, nested functions separately", () => {
    const fns = byName(SAMPLE);
    expect(fns.grade.cc).toBe(5); // 1 + if + for + && + ?:
    expect(fns.f.cc).toBe(2);
    expect(fns["<module>"].cc).toBe(5); // 1 + case + catch + ??= + ||=
    expect(fns["<module>"].isModule).toBe(true);
  });

  it("ignores types and imports in Halstead counts", () => {
    const typed = byName("function f(a: number): string { return String(a); }").f;
    const plain = byName("function f(a) { return String(a); }", "s.js").f;
    expect(typed.volume).toBeCloseTo(plain.volume);
  });

  it("parses JSX and TSX", () => {
    expect(byName("const C = () => <div>{1}</div>;", "c.jsx").C.cc).toBe(1);
    expect(byName("const C = (p: {a: 1}) => <b />;", "c.tsx").C.cc).toBe(1);
  });

  it("names methods, properties and anonymous functions", () => {
    const fns = byName("class A { m() {} p = () => {} }\nconst o = { k() {}, 'q': function () {} };\nx.y = () => 1;\n[1].map(() => 2);");
    expect(Object.keys(fns)).toEqual(expect.arrayContaining(["m", "p", "k", "q", "y", "<anonymous:4>"]));
    expect(functionName({ loc: { start: { line: 9 } } }, null)).toBe("<anonymous:9>");
  });

  it("scores maintainability on the 171-point scale", () => {
    expect(maintainability(0, 0, 0)).toBe(171);
    expect(analyzeSource("", "e.ts").mi).toBe(171);
    expect(branchCount({ type: "BinaryExpression", operator: "&&" })).toBe(0);
    expect(branchCount({ type: "SwitchCase", test: null })).toBe(0);
  });
});

describe("coverage", () => {
  const fn = {
    start: { line: 1, column: 0 },
    end: { line: 10, column: 1 },
    children: [{ start: { line: 4, column: 2 }, end: { line: 6, column: 3 } }],
  };
  const fileCoverage = {
    statementMap: {
      0: { start: { line: 2, column: 2 } },
      1: { start: { line: 3, column: 2 } },
      2: { start: { line: 5, column: 4 } }, // nested, ignored
      3: { start: { line: 11, column: 0 } }, // outside
    },
    s: { 0: 1, 1: 0, 2: 0, 3: 0 },
  };

  it("measures a function's own statements", () => {
    expect(functionCoverage(fn, fileCoverage)).toBe(0.5);
    expect(functionCoverage(fn, undefined)).toBe(0);
    expect(functionCoverage(fn, { statementMap: {}, s: {} })).toBe(0);
  });

  it("computes CRAP", () => {
    expect(crap(8, 1)).toBe(8);
    expect(crap(3, 0)).toBe(12);
    expect(crap(4, 0.5)).toBe(6);
  });
});

describe("diff", () => {
  it("collects added and changed lines per file", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "+++ b/a.ts",
      "@@ -1,0 +2,3 @@",
      "@@ -9 +12 @@",
      "@@ -20,2 +24,0 @@",
      "+++ b/b.ts",
      "@@ -1 +1 @@",
    ].join("\n");
    const lines = changedLines(`@@ -1 +1 @@\n${diff}`);
    expect([...lines.get("a.ts")]).toEqual([2, 3, 4, 12]);
    expect([...lines.get("b.ts")]).toEqual([1]);
  });
});

describe("gate", () => {
  const code = "export function bad(a, b, c) {\n  if (a) return 1;\n  if (b) return 2;\n  return c ? 3 : 4;\n}\nexport const ok = () => 1;\n";

  it("only gates code files", () => {
    expect(isGatedFile("src/a.ts")).toBe(true);
    expect(isGatedFile("src/a.test.ts")).toBe(false);
    expect(isGatedFile("src/a.d.ts")).toBe(false);
    expect(isGatedFile("README.md")).toBe(false);
    expect(isGatedFile("dist/a.js")).toBe(false);
    expect(isGatedFile("src/testing/fake.ts")).toBe(false);
  });

  it("flags untested complex functions, only where edited", () => {
    const all = checkFile({ file: "x.js", code, coverage: undefined, changed: null });
    expect(all.violations).toEqual(["x.js: bad (line 1) CRAP 20.0 > 8 (CC 4, 0% covered)"]);
    const editedOk = checkFile({ file: "x.js", code, coverage: undefined, changed: new Set([6]) });
    expect(editedOk.violations).toEqual([]);
    expect(editedOk.functions.map((f) => f.name)).toEqual(["ok"]);
  });

  it("flags low maintainability", () => {
    const strict = { maxCrap: 100, minMi: 170 };
    const result = checkFile({ file: "x.js", code, coverage: undefined, changed: null, limits: strict });
    expect(result.violations.some((v) => v.includes("bad (line 1) MI"))).toBe(true);
    expect(result.violations.at(-1)).toMatch(/file MI .* ≤ 170/);
  });
});

describe("cli", () => {
  const code = "export const f = (a) => (a ? 1 : 2);\n";
  const fakeIo = (overrides = {}) => {
    const logs = [];
    const io = {
      logs,
      log: (line) => void logs.push(line),
      git: (args) => (args[0] === "merge-base" ? "base\n" : args[0] === "ls-files" ? "new.js\n" : "+++ b/f.js\n@@ -0,0 +1 @@\n+++ b/notes.md\n@@ -0,0 +1 @@\n"),
      exists: () => true,
      readFile: () => code,
      resolve: (file) => `/repo/${file}`,
      runCoverage: (files) => Object.fromEntries(files.map((f) => [`/repo/${f}`, { statementMap: { 0: { start: { line: 1, column: 24 } } }, s: { 0: 1 } }])),
      ...overrides,
    };
    return io;
  };

  it("checks edited and untracked files in the working tree", () => {
    const io = fakeIo();
    expect(run([], io)).toBe(0);
    expect(io.logs.join("\n")).toContain("f.js  (file MI");
    expect(io.logs.join("\n")).toContain("new.js  (file MI");
    expect(io.logs.at(-1)).toContain("passed");
  });

  it("diffs committed changes against a base and fails on violations", () => {
    const calls = [];
    const io = fakeIo({ git: (args) => (calls.push(args), "+++ b/f.js\n@@ -0,0 +1 @@\n") });
    expect(run(["--base", "main", "--head", "HEAD", "--all", "--verbose", "--max-crap", "1"], io)).toBe(1);
    expect(calls).toEqual([["diff", "--unified=0", "--diff-filter=AMR", "--no-color", "main", "HEAD"]]);
    expect(io.logs.at(-1)).toContain("failed");
  });

  it("checks named files, and handles help and empty diffs", () => {
    const io = fakeIo();
    expect(run(["f.js", "README.md", "--min-mi", "10"], io)).toBe(0);
    expect(run(["--help"], io)).toBe(0);
    expect(io.logs).toContain(USAGE);
    const empty = fakeIo({ git: () => "" });
    expect(run(["--head", "HEAD"], empty)).toBe(0);
    expect(empty.logs).toEqual(["quality gate: no code changes to check"]);
  });

  it("formats a report", () => {
    const text = formatFile({ file: "a.js", mi: 100, functions: [{ name: "f", cc: 2, coverage: 0.5, crap: 2.5, mi: 120 }] });
    expect(text).toContain("a.js  (file MI 100.0)");
    expect(text).toMatch(/f +CC +2 +cov +50% +CRAP +2.5 +MI 120.0/);
    const fns = [
      { name: "calm", cc: 1, coverage: 1, crap: 1, mi: 150 },
      { name: "risky", cc: 3, coverage: 0, crap: 12, mi: 140 },
      { name: "dense", cc: 1, coverage: 1, crap: 1, mi: 90 },
    ];
    expect(formatWorst({ file: "a.js", mi: 100, functions: fns })).toContain("risky");
    expect(formatWorst({ file: "a.js", mi: 100, functions: fns.filter((f) => f.crap === 1) })).toContain("dense");
    expect(formatWorst({ file: "a.js", mi: 100, functions: [] })).toBe("a.js  (file MI 100.0)");
  });
});

import { parse } from "@babel/parser";

/**
 * Per-function complexity metrics for JS/TS source.
 *
 * - Cyclomatic complexity (CC): 1 + if, ?:, loops, case, catch, &&, ||, ??
 *   (and their assignment forms). Nested functions count separately.
 * - Halstead volume over the function's own tokens; TypeScript types and
 *   imports are ignored so annotations don't count as logic.
 * - Maintainability index, classic 171-point scale (as escomplex/Plato):
 *   MI = 171 - 5.2 ln(V) - 0.23 CC - 16.2 ln(SLOC).
 *   A file's MI uses the averages of its functions plus its top-level code,
 *   which is reported as the pseudo-function "<module>".
 */

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);
const BRANCH_TYPES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
]);
const LOGICAL_OPERATORS = new Set(["&&", "||", "??", "&&=", "||=", "??="]);
const TYPE_ONLY_NODES = new Set([
  "ImportDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSDeclareMethod",
  "TSModuleDeclaration",
  "TSIndexSignature",
]);
const TYPE_KEYS = new Set([
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeParameters",
  "superTypeArguments",
  "implements",
]);
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "range", "leadingComments", "trailingComments", "innerComments"]);
const OPERAND_TOKENS = new Set([
  "name", "num", "string", "regexp", "bigint", "template", "jsxName", "jsxText",
  "privateName", "#name", "true", "false", "null", "this", "super",
]);

export function analyzeSource(code, filename) {
  const ast = parse(code, {
    sourceType: "module",
    plugins: pluginsFor(filename),
    tokens: true,
  });
  const ctx = { units: [], excluded: [] };
  const moduleUnit = makeUnit(ast.program, "<module>", ctx);
  walk(ast.program, null, moduleUnit, ctx);
  attributeTokens(ast.tokens, ctx);
  const functions = ctx.units.map(finishUnit).filter((u) => u.sloc > 0);
  return { functions, mi: fileMaintainability(functions) };
}

function pluginsFor(filename) {
  if (/\.tsx$/.test(filename)) return ["typescript", "jsx"];
  if (/\.[cm]?ts$/.test(filename)) return ["typescript"];
  return ["jsx"];
}

function makeUnit(node, name, ctx) {
  const unit = {
    name,
    node,
    line: node.loc.start.line,
    column: node.loc.start.column,
    cc: 1,
    children: [],
    operators: [],
    operands: [],
    lines: new Set(),
  };
  ctx.units.push(unit);
  return unit;
}

function walk(node, parent, unit, ctx) {
  if (TYPE_ONLY_NODES.has(node.type) || node.importKind === "type") {
    ctx.excluded.push([node.start, node.end]);
    return;
  }
  const owner = FUNCTION_TYPES.has(node.type) ? childUnit(node, parent, unit, ctx) : unit;
  owner.cc += branchCount(node);
  for (const [key, value] of Object.entries(node)) {
    if (!SKIP_KEYS.has(key)) walkChild(key, value, node, owner, ctx);
  }
}

function walkChild(key, value, parent, unit, ctx) {
  const nodes = (Array.isArray(value) ? value : [value]).filter(isNode);
  for (const child of nodes) {
    if (TYPE_KEYS.has(key)) ctx.excluded.push([child.start, child.end]);
    else walk(child, parent, unit, ctx);
  }
}

function isNode(value) {
  return Boolean(value && typeof value.type === "string" && value.loc);
}

function childUnit(node, parent, unit, ctx) {
  unit.children.push(node.loc);
  return makeUnit(node, functionName(node, parent), ctx);
}

export function functionName(node, parent) {
  const key = node.id ?? node.key ?? parent?.id ?? parent?.key ?? parent?.left;
  return keyName(key) ?? `<anonymous:${node.loc.start.line}>`;
}

function keyName(key) {
  return key?.name ?? key?.value ?? key?.id?.name ?? key?.property?.name;
}

export function branchCount(node) {
  if (BRANCH_TYPES.has(node.type)) return 1;
  if (node.type === "SwitchCase") return node.test ? 1 : 0;
  return LOGICAL_OPERATORS.has(node.operator) && node.type !== "BinaryExpression" ? 1 : 0;
}

function attributeTokens(tokens, ctx) {
  // Innermost first; on a tie (a file that is one function) the function wins.
  const size = (u) => u.node.end - u.node.start + (u.node.type === "Program" ? 0.5 : 0);
  const units = [...ctx.units].sort((a, b) => size(a) - size(b));
  for (const token of tokens) {
    if (isExcluded(token, ctx.excluded)) continue;
    const unit = units.find((u) => u.node.start <= token.start && token.end <= u.node.end);
    addToken(unit, token);
  }
}

function isExcluded(token, excluded) {
  const label = tokenLabel(token);
  return label === "eof" || excluded.some(([start, end]) => start <= token.start && token.end <= end);
}

function tokenLabel(token) {
  return typeof token.type === "object" ? token.type.label : token.type;
}

function addToken(unit, token) {
  const label = tokenLabel(token);
  const text = `${label}:${token.value ?? ""}`;
  if (OPERAND_TOKENS.has(label)) unit.operands.push(text);
  else unit.operators.push(text);
  unit.lines.add(token.loc.start.line);
}

function finishUnit(unit) {
  const total = unit.operators.length + unit.operands.length;
  const distinct = new Set(unit.operators).size + new Set(unit.operands).size;
  const volume = total * Math.log2(Math.max(distinct, 1));
  const sloc = unit.lines.size;
  return {
    name: unit.name,
    line: unit.line,
    column: unit.column,
    start: unit.node.loc.start,
    end: unit.node.loc.end,
    children: unit.children,
    isModule: unit.name === "<module>",
    cc: unit.cc,
    volume,
    sloc,
    mi: maintainability(volume, unit.cc, sloc),
  };
}

export function maintainability(volume, cc, sloc) {
  return 171 - 5.2 * Math.log(Math.max(volume, 1)) - 0.23 * cc - 16.2 * Math.log(Math.max(sloc, 1));
}

function fileMaintainability(functions) {
  if (functions.length === 0) return 171;
  const avg = (key) => functions.reduce((sum, f) => sum + f[key], 0) / functions.length;
  return maintainability(avg("volume"), avg("cc"), avg("sloc"));
}

/**
 * CRAP = CC^2 * (1 - coverage)^3 + CC, with coverage = the share of a
 * function's own statements (nested functions excluded) that tests ran,
 * read from an Istanbul coverage-final.json entry.
 */

export function crap(cc, coverage) {
  return cc * cc * (1 - coverage) ** 3 + cc;
}

export function functionCoverage(fn, fileCoverage) {
  if (!fileCoverage) return 0;
  const counts = Object.entries(fileCoverage.statementMap)
    .filter(([, loc]) => ownsPosition(fn, loc.start))
    .map(([id]) => fileCoverage.s[id]);
  if (counts.length === 0) return 0;
  return counts.filter((n) => n > 0).length / counts.length;
}

function ownsPosition(fn, pos) {
  return within(fn, pos) && !fn.children.some((child) => within(child, pos));
}

function within({ start, end }, pos) {
  return !before(pos, start) && before(pos, end);
}

/** True when a comes strictly before b. */
function before(a, b) {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

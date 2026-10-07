/**
 * Parses `git diff --unified=0` output into the lines each file gained or
 * changed (new-file line numbers).
 */
export function changedLines(diffText) {
  const files = new Map();
  let current = null;
  for (const line of diffText.split("\n")) {
    const file = line.match(/^\+\+\+ b\/(.+)$/);
    if (file) files.set(file[1], (current = new Set()));
    else addHunk(current, line);
  }
  return files;
}

function addHunk(lines, text) {
  const hunk = text.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
  if (!lines || !hunk) return;
  const start = Number(hunk[1]);
  const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
  for (let i = start; i < start + count; i++) lines.add(i);
}

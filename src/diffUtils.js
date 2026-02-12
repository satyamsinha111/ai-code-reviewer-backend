/**
 * Utilities for parsing PR patches and resolving comment locations.
 * GitHub's createReview API expects "position" = 1-based index in the diff (lines after @@),
 * not the line number in the file. "Line could not be resolved" occurs when position/line
 * doesn't match the diff. We build valid positions and map file lines to positions.
 *
 * @see https://docs.github.com/rest/pulls/reviews#create-a-review-for-a-pull-request
 */

/**
 * For each file, parses the patch and returns:
 * - validPositions: Set of position numbers (1-based) that can be commented on in this file's diff.
 * - lineToPosition: Map from "new file" line number to the last diff position that refers to it
 *   (so we can map AI/rule comments that use line numbers to a valid position).
 *
 * In unified diff, the line below @@ is position 1. Each subsequent line in the diff increments
 * the position. We track which positions correspond to lines in the "new" file (context or added).
 *
 * @param {Array<{ filename: string, patch?: string }>} files - From pulls.listFiles
 * @returns {Map<string, { validPositions: Set<number>, lineToPosition: Map<number, number> }>}
 *   key = path (filename), value = { validPositions, lineToPosition }
 */
export function parsePatchesForComments(files) {
  const byPath = new Map();

  for (const file of files) {
    const patch = file.patch || '';
    if (!patch.trim()) continue;

    const validPositions = new Set();
    const lineToPosition = new Map(); // new-file line number -> (last) position in diff for that line
    const lines = patch.split('\n');
    let position = 0;
    let newFileLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (hunkMatch) {
        newFileLine = parseInt(hunkMatch[2], 10);
        // Doc: "The line just below the @@ line is position 1" — so we don't assign position to @@ itself
        continue;
      }
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      position += 1; // 1-based index in diff (first line after @@ is 1)
      // Lines that appear in the new file: context (space) or added (+)
      if (line.startsWith(' ') || line.startsWith('+')) {
        validPositions.add(position);
        lineToPosition.set(newFileLine, position);
        newFileLine += 1;
      }
    }

    byPath.set(file.filename, { validPositions, lineToPosition });
  }

  return byPath;
}

/**
 * Converts comments that use (path, line) to (path, position) using the parsed diff.
 * Drops comments whose path or line doesn't resolve to a valid position.
 *
 * @param {Array<{ path: string, line: number, body: string }>} comments
 * @param {Map<string, { validPositions: Set<number>, lineToPosition: Map<number, number> }>} patchMap - from parsePatchesForComments
 * @returns {Array<{ path: string, position: number, body: string }>}
 */
export function commentsToPositions(comments, patchMap) {
  const out = [];
  for (const c of comments) {
    const entry = patchMap.get(c.path);
    if (!entry) continue;
    const pos = entry.lineToPosition.get(c.line);
    if (pos == null || !entry.validPositions.has(pos)) continue;
    out.push({ path: c.path, position: pos, body: c.body });
  }
  return out;
}

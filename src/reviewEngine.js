/**
 * Review engine: AI-powered review (summary, quality rating, comments) with fallback to rule-based.
 */

import { getAIReview } from './openaiService.js';

/**
 * Runs AI review when OPENAI_API_KEY is set. Returns summary, quality rating, and inline comments.
 * @param {string} prTitle - PR title
 * @param {string} prBody - PR body
 * @param {Array<{ filename: string, patch?: string }>} files - Files from pulls.listFiles
 * @returns {Promise<{ body: string, comments: Array<{ path: string, line: number, body: string }> }>}
 */
export async function runAIReview(prTitle, prBody, files) {
  const result = await getAIReview(prTitle, prBody, files);
  const sections = [
    `## MergeMonk AI Review`,
    ``,
    `### Summary`,
    result.summary,
    ``,
    `### Code quality rating: ${result.qualityRating}/10`,
    result.qualityRatingReason ? `*${result.qualityRatingReason}*` : '',
    ``,
    `### Security`,
    result.securityAssessment || '_No assessment._',
    ``,
    `### System design`,
    result.systemDesignAssessment || '_No assessment._',
    ``,
    `### Scalability`,
    result.scalabilityAssessment || '_No assessment._',
    ``,
    `---`,
    ``,
    `### Overall`,
    result.reviewBody,
  ].filter(Boolean).join('\n');

  // Append a copy-paste prompt for Cursor/AI to each comment so the author can fix the issue quickly.
  const comments = (result.comments || []).map((c) => {
    let body = c.body || '';
    const prompt = c.suggestedPrompt?.trim();
    if (prompt) {
      body += `\n\n---\n**Suggested prompt for Cursor/AI:** *(copy into Cursor to fix)*\n\n${prompt}`;
    }
    return { path: c.path, line: c.line, body };
  });

  return {
    body: sections,
    comments,
  };
}

/**
 * Rule-based fallback: warns on console.log, generic summary otherwise.
 * @param {Array<{ filename: string, patch?: string }>} files - Files from octokit.pulls.listFiles
 * @returns {{ body: string, comments: Array<{ path: string, line: number, body: string }> }}
 */
export function runReview(files) {
  const comments = [];
  let hasConsoleLog = false;

  for (const file of files) {
    const patch = file.patch || '';
    if (!patch) continue;

    const lines = patch.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('+') && line.includes('console.log')) {
        hasConsoleLog = true;
        // Approximate line number in the file (patch line numbers appear as @@ -x,y +a,b)
        const lineNum = inferLineNumber(lines, i);
        const suggestedPrompt = 'Replace this console.log with a proper logger (e.g. logger.debug or logger.info) or remove it for production.';
        comments.push({
          path: file.filename,
          line: lineNum,
          body: `⚠️ **MergeMonk:** Consider removing \`console.log\` before merging. Use a proper logger or remove for production.\n\n---\n**Suggested prompt for Cursor/AI:** *(copy into Cursor to fix)*\n\n${suggestedPrompt}`,
        });
      }
    }
  }

  const body = hasConsoleLog
    ? 'MergeMonk found potential issues. Please check the comments below.'
    : 'MergeMonk reviewed this PR. No automated issues detected.';

  return { body, comments };
}

/**
 * Infers the line number in the new file from patch context.
 * Patches use @@ -oldStart,oldCount +newStart,newCount; we use newStart + count of added lines in this hunk.
 */
function inferLineNumber(lines, currentIndex) {
  let newStart = 1;
  let addedInHunk = 0;
  for (let i = 0; i <= currentIndex; i++) {
    const hunkMatch = lines[i].match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/);
    if (hunkMatch) {
      newStart = parseInt(hunkMatch[2], 10);
      addedInHunk = 0;
    } else if (lines[i].startsWith('+') && !lines[i].startsWith('+++')) {
      addedInHunk++;
    }
  }
  return newStart + addedInHunk - 1;
}

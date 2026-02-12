/**
 * OpenAI service for PR review: summary, code quality rating, and review comments.
 */

import OpenAI from 'openai';

// Default: fit many files (e.g. 18+) so the AI can comment across the whole PR. Override via env if needed.
const DEFAULT_MAX_PATCH_CHARS_PER_FILE = 3500;
const DEFAULT_MAX_TOTAL_PATCH_CHARS = 58000;

/**
 * Truncates file patches so the total prompt stays within token limits.
 * Includes as many files as possible (each truncated per-file) so the AI can comment across the whole PR.
 * @param {Array<{ filename: string, patch?: string }>} files
 * @returns {Array<{ filename: string, patch: string }>}
 */
function truncatePatches(files) {
  const maxPerFile = Number(process.env.MERGEMONK_MAX_PATCH_CHARS_PER_FILE) || DEFAULT_MAX_PATCH_CHARS_PER_FILE;
  const maxTotal = Number(process.env.MERGEMONK_MAX_TOTAL_PATCH_CHARS) || DEFAULT_MAX_TOTAL_PATCH_CHARS;
  let total = 0;
  const out = [];
  for (const f of files) {
    let patch = (f.patch || '').trim();
    if (!patch) continue;
    const remaining = maxTotal - total;
    if (remaining <= 0) break;
    if (patch.length > maxPerFile) {
      patch = patch.slice(0, maxPerFile) + '\n... (truncated)';
    }
    if (patch.length > remaining) {
      patch = patch.slice(0, remaining) + '\n... (truncated)';
    }
    total += patch.length;
    out.push({ filename: f.filename, patch });
  }
  return out;
}

const SYSTEM_PROMPT = `You are MergeMonk, a senior engineer AI that performs production-grade code reviews. Focus on security, system design, scalability, maintainability, error handling, and performance—not just style. Be specific and actionable.

Your response must be valid JSON only (no markdown fence, no extra text). Use this exact shape:
{
  "summary": "2–4 sentence summary of what this PR does and its impact.",
  "qualityRating": <number 1-10>,
  "qualityRatingReason": "One sentence tying the rating to security, design, and scalability.",
  "securityAssessment": "Concrete assessment: secrets/hardcoding, input validation, auth/sanitization, dependencies, injection/XXE, logging of sensitive data. Call out risks and file:line if relevant. Say 'No obvious issues' only if you checked.",
  "systemDesignAssessment": "Assessment of structure: separation of concerns, coupling, boundaries (API/DB/domain), consistency with existing patterns, error handling strategy, state management. Note design smells or improvements.",
  "scalabilityAssessment": "Assessment of scalability: concurrency, bottlenecks, N+1/caching, resource use, statelessness, config/feature flags. Note limits or suggestions.",
  "reviewBody": "Overall narrative: 2–4 sentences. Highlight main strengths, then 1–3 concrete next steps (security/design/scalability/maintainability). Be direct.",
  "comments": [
    {
      "path": "exact/file/path.js",
      "line": <number>,
      "body": "Inline: security/design/scalability/bug—actionable, brief",
      "suggestedPrompt": "A single sentence or short instruction the developer can copy-paste into Cursor (or another AI) to fix this issue; e.g. 'Add input validation and sanitization here to prevent XSS' or 'Replace with a structured logger and remove PII from the log message'."
    }
  ]
}

Rules:
- qualityRating 1–10: reflect security, design, and scalability, not just style.
- securityAssessment, systemDesignAssessment, scalabilityAssessment: always fill; be specific to this diff. If a dimension is not applicable, say so briefly (e.g. "No server/DB changes; N/A for scalability.").
- Inline comments: Add a comment for every significant issue you find across ALL files in the diff. Do NOT limit to 2–3 comments. Cover security, design, scalability, and bugs in each relevant file; multiple comments per file are expected when there are multiple issues. Use line numbers from the NEW file. Path must match a file path exactly as shown in the diff. Be actionable and brief per comment.
- suggestedPrompt: REQUIRED for every comment. One concise instruction the developer can paste into Cursor/Copilot/etc. to fix the issue—e.g. "Add null check and return early", "Use parameterized query instead of string concatenation", "Extract this to a constant and document the magic number". No backticks or code blocks inside suggestedPrompt; keep it one line when possible.
- Output only the JSON object.`;

/**
 * Builds the user prompt from PR metadata and file patches.
 */
function buildUserPrompt(prTitle, prBody, files) {
  const truncated = truncatePatches(files);
  let text = `## Pull request\nTitle: ${prTitle || '(no title)'}\n\n`;
  if (prBody) text += `Description:\n${prBody.slice(0, 2000)}${prBody.length > 2000 ? '\n...' : ''}\n\n`;
  text += `## Changed files (diffs)\n\n`;
  text += `Review all ${truncated.length} file(s) below. Add inline comments for every notable issue (security, design, scalability, bugs)—multiple comments per file are expected when there are multiple issues.\n\n`;
  for (const { filename, patch } of truncated) {
    text += `### ${filename}\n\`\`\`diff\n${patch}\n\`\`\`\n\n`;
  }
  return text;
}

/**
 * Calls OpenAI to get PR summary, quality rating, and review content.
 * @param {string} prTitle - PR title
 * @param {string} prBody - PR body/description
 * @param {Array<{ filename: string, patch?: string }>} files - Files from pulls.listFiles
 * @returns {Promise<{ summary: string, qualityRating: number, qualityRatingReason: string, reviewBody: string, comments: Array<{ path: string, line: number, body: string }> }>}
 */
export async function getAIReview(prTitle, prBody, files) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const openai = new OpenAI({ apiKey });
  const userPrompt = buildUserPrompt(prTitle, prBody, files);

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  const parsed = JSON.parse(content);

  const comments = (Array.isArray(parsed.comments) ? parsed.comments : []).map((c) => ({
    path: c.path ?? '',
    line: typeof c.line === 'number' ? c.line : 1,
    body: c.body ?? '',
    suggestedPrompt: typeof c.suggestedPrompt === 'string' ? c.suggestedPrompt.trim() : '',
  }));

  return {
    summary: parsed.summary ?? '',
    qualityRating: typeof parsed.qualityRating === 'number' ? parsed.qualityRating : 5,
    qualityRatingReason: parsed.qualityRatingReason ?? '',
    securityAssessment: parsed.securityAssessment ?? '',
    systemDesignAssessment: parsed.systemDesignAssessment ?? '',
    scalabilityAssessment: parsed.scalabilityAssessment ?? '',
    reviewBody: parsed.reviewBody ?? '',
    comments,
  };
}

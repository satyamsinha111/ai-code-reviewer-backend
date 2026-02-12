/**
 * PR service: fetches PR details and files, runs AI or rule-based review, posts review.
 * Converts (path, line) comments to (path, position) so GitHub can resolve them.
 */

import { parsePatchesForComments, commentsToPositions } from './diffUtils.js';
import { runAIReview, runReview } from './reviewEngine.js';

/**
 * Fetches PR details and changed files, runs AI review (or fallback), and posts the review.
 * @param {Octokit} octokit - Authenticated Octokit instance
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {number} pullNumber - PR number
 */
export async function reviewPullRequest(octokit, owner, repo, pullNumber) {
  const [{ data: pr }, { data: files }] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number: pullNumber }),
    octokit.pulls.listFiles({ owner, repo, pull_number: pullNumber }),
  ]);

  const prTitle = pr.title || '';
  const prBody = pr.body || '';

  let body;
  let comments;

  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await runAIReview(prTitle, prBody, files);
      body = result.body;
      comments = result.comments;
    } catch (err) {
      console.warn('AI review failed, using rule-based fallback:', err.message);
      const result = runReview(files);
      body = result.body;
      comments = result.comments;
    }
  } else {
    const result = runReview(files);
    body = result.body;
    comments = result.comments;
  }

  // GitHub expects "position" (1-based index in diff), not "line". Resolve and filter invalid comments.
  const patchMap = parsePatchesForComments(files);
  const positionComments = commentsToPositions(comments || [], patchMap);

  // Block merge until review is addressed: use REQUEST_CHANGES so PR cannot be merged until approved.
  // Set MERGEMONK_REQUEST_CHANGES=false to only comment without blocking.
  const requestChanges = process.env.MERGEMONK_REQUEST_CHANGES !== 'false';
  const event = requestChanges ? 'REQUEST_CHANGES' : 'COMMENT';

  const review = {
    owner,
    repo,
    pull_number: pullNumber,
    event,
    body,
  };

  if (positionComments.length > 0) {
    review.comments = positionComments;
  }

  await octokit.pulls.createReview(review);
}

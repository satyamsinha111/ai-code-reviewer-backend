/**
 * Creates a "possible patch" PR: applies AI-suggested file patches to a new branch
 * and opens a PR into the original PR's branch so the user can review and merge.
 */

import { applyPatch } from 'diff';

const PATCH_BRANCH_PREFIX = 'mergemonk/patches-';

/**
 * Fetches raw file content at the given ref for each path.
 * @param {object} octokit - Authenticated Octokit
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {string} ref - Git ref (e.g. commit sha or branch name)
 * @param {string[]} paths - File paths
 * @returns {Promise<Map<string, string>>} path -> file content (utf-8). Missing/failed paths are omitted.
 */
async function getFileContentsAtRef(octokit, owner, repo, ref, paths) {
  const result = new Map();
  for (const path of paths) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
      if (Array.isArray(data)) continue; // directory
      if (data.encoding === 'base64' && data.content) {
        result.set(path, Buffer.from(data.content, 'base64').toString('utf-8'));
      } else {
        result.set(path, data.content || '');
      }
    } catch (err) {
      console.warn(`Could not fetch ${path} at ${ref}:`, err.message);
    }
  }
  return result;
}

/**
 * Applies a unified diff patch to content. Returns null if patch does not apply.
 * @param {string} content - Original file content
 * @param {string} patchStr - Unified diff (single file)
 * @returns {string|null} Patched content or null
 */
function applyPatchToContent(content, patchStr) {
  const trimmed = patchStr.trim();
  if (!trimmed) return null;
  // Ensure patch has a newline at end for applyPatch
  const patch = trimmed.endsWith('\n') ? trimmed : trimmed + '\n';
  const out = applyPatch(content, patch);
  return out !== false ? out : null;
}

/**
 * Creates a new branch from headSha, applies filePatches to the repo, and opens a PR into the original PR's branch.
 * Only runs when the PR head is in the same repo (not a fork). Patches that fail to apply are skipped.
 *
 * @param {object} octokit - Authenticated Octokit (installation auth)
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {object} pr - PR object from pulls.get (must have head.sha, head.ref, head.repo, base.ref, number, title)
 * @param {Array<{ path: string, patch: string }>} filePatches - Per-file unified diffs from the AI
 * @returns {Promise<{ pullRequestUrl?: string, branch?: string }|null>} Created PR info or null if skipped/failed
 */
export async function createPatchPullRequest(octokit, owner, repo, pr, filePatches) {
  if (!filePatches || filePatches.length === 0) return null;

  const headRepo = pr.head?.repo;
  const headRef = pr.head?.ref;
  const headSha = pr.head?.sha;
  if (!headRepo || !headRef || !headSha) {
    console.warn('Patch PR: missing pr.head.repo/ref/sha');
    return null;
  }

  // We can only push to the same repo (no push access to forks)
  const headRepoFull = headRepo.full_name || `${headRepo.owner?.login}/${headRepo.name}`;
  if (headRepoFull !== `${owner}/${repo}`) {
    console.warn('Patch PR: skipping because PR head is in a fork');
    return null;
  }

  const paths = [...new Set(filePatches.map((fp) => fp.path))];
  const contentMap = await getFileContentsAtRef(octokit, owner, repo, headSha, paths);
  if (contentMap.size === 0) {
    console.warn('Patch PR: could not fetch any file contents');
    return null;
  }

  const treeEntries = [];
  for (const { path, patch } of filePatches) {
    const content = contentMap.get(path);
    if (content == null) continue;
    const newContent = applyPatchToContent(content, patch);
    if (newContent == null) {
      console.warn(`Patch PR: patch did not apply for ${path}, skipping`);
      continue;
    }
    const { data: blob } = await octokit.git.createBlob({
      owner,
      repo,
      content: newContent,
      encoding: 'utf-8',
    });
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  if (treeEntries.length === 0) {
    console.warn('Patch PR: no patches applied successfully');
    return null;
  }

  const shortSha = headSha.slice(0, 7);
  const branchName = `${PATCH_BRANCH_PREFIX}${pr.number}-${shortSha}`;

  const { data: baseCommit } = await octokit.git.getCommit({ owner, repo, commit_sha: headSha });
  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree: treeEntries,
  });
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: `MergeMonk: suggested patches for #${pr.number}`,
    tree: newTree.sha,
    parents: [headSha],
  });
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: newCommit.sha,
  });

  const prBody = `This PR applies **MergeMonk**-suggested patches for [#${pr.number} ${pr.title}](/${owner}/${repo}/pull/${pr.number}).\n\nReview the changes and merge into this branch to incorporate the fixes.`;
  const { data: patchPr } = await octokit.pulls.create({
    owner,
    repo,
    title: `MergeMonk suggested patches for #${pr.number}`,
    head: branchName,
    base: headRef,
    body: prBody,
  });

  console.log(`Patch PR created: ${patchPr.html_url} (${branchName} -> ${headRef})`);
  return { pullRequestUrl: patchPr.html_url, branch: branchName };
}

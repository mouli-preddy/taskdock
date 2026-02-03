import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { LinkedRepository } from '../../shared/terminal-types.js';

export interface RepoMatch {
  path: string;
  remote: string;
  isExactMatch: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch?: string; // Optional - may be undefined for detached HEAD
  head: string;
}

export class WorktreeService {
  private linkedRepositories: LinkedRepository[];

  constructor(linkedRepositories: LinkedRepository[]) {
    this.linkedRepositories = linkedRepositories;
  }

  setLinkedRepositories(repos: LinkedRepository[]): void {
    this.linkedRepositories = repos;
  }

  private validateBranchName(branch: string): void {
    // Git branch names: alphanumeric, hyphens, underscores, slashes, dots
    // Cannot start with dot, contain consecutive dots, or end with .lock
    if (
      !/^[\w\-\/\.]+$/.test(branch) ||
      branch.startsWith('.') ||
      branch.includes('..') ||
      branch.endsWith('.lock')
    ) {
      throw new Error(`Invalid branch name: ${branch}`);
    }
  }

  /**
   * Normalize Azure DevOps URLs to a canonical form for comparison.
   * Handles variations like:
   * - https://dev.azure.com/{org}/{project}/_git/{repo}
   * - https://{org}.visualstudio.com/{project}/_git/{repo}
   * - https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}
   * - git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
   *
   * Returns a canonical form: {org}/{project}/{repo} (lowercase)
   */
  normalizeAdoUrl(url: string): string {
    let normalized = url
      .replace(/\.git$/, '')
      .toLowerCase()
      .trim();

    // Handle SSH format: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    const sshMatch = normalized.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)/);
    if (sshMatch) {
      return `${sshMatch[1]}/${sshMatch[2]}/${sshMatch[3]}`;
    }

    // Remove protocol and optional username (e.g., https://user@dev.azure.com/...)
    normalized = normalized.replace(/^https?:\/\/([^@]+@)?/, '');

    // Handle dev.azure.com/{org}/{project}/_git/{repo}
    const devAzureMatch = normalized.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+)/);
    if (devAzureMatch) {
      return `${devAzureMatch[1]}/${devAzureMatch[2]}/${devAzureMatch[3]}`;
    }

    // Handle {org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}
    const vsWithDefaultMatch = normalized.match(/([^.]+)\.visualstudio\.com\/defaultcollection\/([^/]+)\/_git\/(.+)/);
    if (vsWithDefaultMatch) {
      return `${vsWithDefaultMatch[1]}/${vsWithDefaultMatch[2]}/${vsWithDefaultMatch[3]}`;
    }

    // Handle {org}.visualstudio.com/{project}/_git/{repo}
    const vsMatch = normalized.match(/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/(.+)/);
    if (vsMatch) {
      return `${vsMatch[1]}/${vsMatch[2]}/${vsMatch[3]}`;
    }

    // Fallback: return basic normalized URL for non-ADO repos
    return normalized
      .replace(/^git@([^:]+):/, '$1/');
  }

  findLocalRepo(repoUrl: string, _repoName: string): RepoMatch | null {
    const targetNormalized = this.normalizeAdoUrl(repoUrl);
    console.log('[WorktreeService] findLocalRepo called');
    console.log('[WorktreeService] Target URL:', repoUrl);
    console.log('[WorktreeService] Target normalized:', targetNormalized);
    console.log('[WorktreeService] Checking', this.linkedRepositories.length, 'linked repositories');

    // Check linked repositories directly - no scanning needed
    for (const repo of this.linkedRepositories) {
      console.log('[WorktreeService] Checking repo:', {
        path: repo.path,
        exists: fs.existsSync(repo.path),
        originUrl: repo.originUrl
      });
      if (!fs.existsSync(repo.path)) {
        console.log('[WorktreeService] -> Path does not exist, skipping');
        continue;
      }

      const repoNormalized = this.normalizeAdoUrl(repo.originUrl);
      console.log('[WorktreeService] -> Normalized:', repoNormalized);
      console.log('[WorktreeService] -> Match?', repoNormalized === targetNormalized);
      if (repoNormalized === targetNormalized) {
        console.log('[WorktreeService] *** MATCH FOUND ***');
        return { path: repo.path, remote: repo.originUrl, isExactMatch: true };
      }
    }
    console.log('[WorktreeService] No match found');
    return null;
  }

  // Find linked repository by ADO URL (for PR page display)
  findLinkedRepoByAdoUrl(repoUrl: string): LinkedRepository | null {
    const targetNormalized = this.normalizeAdoUrl(repoUrl);
    console.log('[findLinkedRepoByAdoUrl] Target normalized:', targetNormalized);

    for (const repo of this.linkedRepositories) {
      const repoNormalized = this.normalizeAdoUrl(repo.originUrl);
      console.log('[findLinkedRepoByAdoUrl] Comparing with:', repo.originUrl, '->', repoNormalized);
      if (repoNormalized === targetNormalized) {
        console.log('[findLinkedRepoByAdoUrl] MATCH FOUND!');
        return repo;
      }
    }
    console.log('[findLinkedRepoByAdoUrl] No match found');
    return null;
  }

  listWorktrees(repoPath: string): WorktreeInfo[] {
    try {
      const output = execSync(`git worktree list --porcelain`, {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      const worktrees: WorktreeInfo[] = [];
      const entries = output.trim().split('\n\n');

      for (const entry of entries) {
        const lines = entry.split('\n');
        const worktree: Partial<WorktreeInfo> = {};

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            worktree.path = line.substring(9);
          } else if (line.startsWith('HEAD ')) {
            worktree.head = line.substring(5);
          } else if (line.startsWith('branch ')) {
            worktree.branch = line.substring(7).replace('refs/heads/', '');
          }
        }

        if (worktree.path && worktree.head) {
          worktrees.push(worktree as WorktreeInfo);
        }
      }

      return worktrees;
    } catch (error) {
      console.error('Error listing worktrees:', error);
      return [];
    }
  }

  findWorktreeForBranch(repoPath: string, branch: string): WorktreeInfo | null {
    const worktrees = this.listWorktrees(repoPath);
    const normalizedBranch = branch.replace('refs/heads/', '');
    console.log('[findWorktreeForBranch] Looking for branch:', normalizedBranch);
    console.log('[findWorktreeForBranch] Available worktrees:', worktrees.map(w => ({ path: w.path, branch: w.branch })));

    // First try to find by branch name
    const byBranch = worktrees.find(w => w.branch && w.branch === normalizedBranch);
    if (byBranch) {
      console.log('[findWorktreeForBranch] Found by branch:', byBranch.path);
      return byBranch;
    }

    // Fallback: check if any worktree is on the same commit as origin/branch (for detached HEAD worktrees)
    try {
      const targetHead = execSync(`git rev-parse origin/${normalizedBranch}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      const byHead = worktrees.find(w => w.head === targetHead);
      if (byHead) {
        console.log('[findWorktreeForBranch] Found by HEAD match:', byHead.path);
        return byHead;
      }
    } catch {
      // Remote branch might not exist
    }

    console.log('[findWorktreeForBranch] No worktree found for branch:', normalizedBranch);
    return null;
  }

  createWorktree(repoPath: string, branch: string, prId: number): WorktreeInfo {
    const normalizedBranch = branch.replace('refs/heads/', '');
    this.validateBranchName(normalizedBranch);

    try {
      const worktreesDir = `${repoPath}-worktrees`;
      const worktreePath = path.join(worktreesDir, `pr-${prId}`);

      // Create worktrees directory if needed
      if (!fs.existsSync(worktreesDir)) {
        fs.mkdirSync(worktreesDir, { recursive: true });
      }

      // Fetch the branch
      try {
        execSync(`git fetch origin ${normalizedBranch}`, {
          cwd: repoPath,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch (error) {
        // Fetch may fail if already up to date - verify ref exists
        try {
          execSync(`git rev-parse origin/${normalizedBranch}`, {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: 'pipe',
          });
        } catch {
          throw new Error(`Branch ${normalizedBranch} does not exist on remote`);
        }
      }

      // Create worktree with a local branch tracking the remote
      // Using -B to create or reset the branch if it already exists
      execSync(`git worktree add -B "${normalizedBranch}" "${worktreePath}" "origin/${normalizedBranch}"`, {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      // Get HEAD commit
      const head = execSync('git rev-parse HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();

      return { path: worktreePath, branch: normalizedBranch, head };
    } catch (error) {
      throw new Error(`Failed to create worktree for branch ${normalizedBranch}: ${error}`);
    }
  }

  syncWorktree(worktreePath: string, branch: string): void {
    const normalizedBranch = branch.replace('refs/heads/', '');
    this.validateBranchName(normalizedBranch);

    try {
      execSync(`git fetch origin ${normalizedBranch}`, {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      execSync(`git checkout origin/${normalizedBranch}`, {
        cwd: worktreePath,
        encoding: 'utf-8',
      });
    } catch (error) {
      throw new Error(`Failed to sync worktree for branch ${normalizedBranch}: ${error}`);
    }
  }

  removeWorktree(repoPath: string, worktreePath: string): void {
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoPath,
        encoding: 'utf-8',
      });
    } catch (error) {
      throw new Error(`Failed to remove worktree at ${worktreePath}: ${error}`);
    }
  }

  // Get git remote origin URL from a repository path
  static getGitOriginUrl(repoPath: string): string | null {
    try {
      const output = execSync('git remote get-url origin', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  // Check if a path is a git repository
  static isGitRepo(dirPath: string): boolean {
    try {
      return fs.existsSync(path.join(dirPath, '.git'));
    } catch {
      return false;
    }
  }
}

let worktreeService: WorktreeService | null = null;

export function getWorktreeService(linkedRepositories: LinkedRepository[] = []): WorktreeService {
  if (!worktreeService) {
    worktreeService = new WorktreeService(linkedRepositories);
  } else {
    worktreeService.setLinkedRepositories(linkedRepositories);
  }
  return worktreeService;
}

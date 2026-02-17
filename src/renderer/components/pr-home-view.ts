import type { PullRequest } from '../../shared/types.js';
import type { MonitoredRepository } from '../../shared/terminal-types.js';
import { escapeHtml, formatTimeAgo } from '../utils/html-utils.js';
import { iconHtml, RefreshCw, GitPullRequest, Link, Clock, Globe, ExternalLink } from '../utils/icons.js';

interface LinkedRepo {
  path: string;
  originUrl: string;
  normalized?: string;
}

interface MonitoredRepoPRs {
  repo: MonitoredRepository;
  prs: PullRequest[];
}

export class PRHomeView {
  private container: HTMLElement;
  private myPRs: PullRequest[] = [];
  private createdPRs: PullRequest[] = [];
  private monitoredRepos: MonitoredRepository[] = [];
  private monitoredPRsMap: Map<string, PullRequest[]> = new Map(); // key: repo.name
  private activeTab: string = 'review'; // 'review', 'created', or 'monitored-{repoName}'
  private openPRCallback: ((pr: PullRequest) => void) | null = null;
  private openPRByUrlCallback: ((org: string, project: string, prId: number) => void) | null = null;
  private refreshCallback: (() => void) | null = null;
  private linkedReposCache: Map<string, LinkedRepo | null> = new Map();

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.render();
  }

  onOpenPR(callback: (pr: PullRequest) => void) {
    this.openPRCallback = callback;
  }

  onOpenPRByUrl(callback: (org: string, project: string, prId: number) => void) {
    this.openPRByUrlCallback = callback;
  }

  onRefresh(callback: () => void) {
    this.refreshCallback = callback;
  }

  async setPRs(myPRs: PullRequest[], createdPRs: PullRequest[]) {
    this.myPRs = myPRs;
    this.createdPRs = createdPRs;

    // Fetch linked repos for all PRs
    const allMonitoredPRs = Array.from(this.monitoredPRsMap.values()).flat();
    const allPRs = [...myPRs, ...createdPRs, ...allMonitoredPRs];
    await this.fetchLinkedRepos(allPRs);

    this.renderPRLists();
  }

  setMonitoredRepos(repos: MonitoredRepository[]) {
    this.monitoredRepos = repos;
    // Clean up PRs for repos that are no longer monitored
    const repoKeys = new Set(repos.map(r => this.getRepoKey(r)));
    for (const key of this.monitoredPRsMap.keys()) {
      if (!repoKeys.has(key)) {
        this.monitoredPRsMap.delete(key);
      }
    }
    this.render();
    this.renderPRLists();
  }

  private getRepoKey(repo: MonitoredRepository): string {
    return `${repo.organization}/${repo.project}/${repo.repository}`;
  }

  async setMonitoredRepoPRs(repo: MonitoredRepository, prs: PullRequest[]) {
    const key = this.getRepoKey(repo);
    this.monitoredPRsMap.set(key, prs);

    // Fetch linked repos for these PRs
    await this.fetchLinkedRepos(prs);

    this.renderPRLists();
  }

  private async fetchLinkedRepos(prs: PullRequest[]) {
    const repoUrls = prs
      .map(pr => this.getRepoUrl(pr))
      .filter((url): url is string => !!url);
    const uniqueRepoUrls = new Set(repoUrls);

    for (const repoUrl of uniqueRepoUrls) {
      if (!this.linkedReposCache.has(repoUrl)) {
        try {
          const linkedRepo = await window.electronAPI.gitFindLinkedRepo(repoUrl);
          if (linkedRepo) {
            const normalized = await window.electronAPI.gitNormalizeAdoUrl(repoUrl);
            this.linkedReposCache.set(repoUrl, { ...linkedRepo, normalized });
          } else {
            this.linkedReposCache.set(repoUrl, null);
          }
        } catch {
          this.linkedReposCache.set(repoUrl, null);
        }
      }
    }
  }

  // Get git remote URL for a PR (construct from PR URL if remoteUrl not available)
  private getRepoUrl(pr: PullRequest): string | null {
    if (pr.repository.remoteUrl) {
      return pr.repository.remoteUrl;
    }
    // Try to extract org/project from PR URL
    const match = pr.url.match(/https:\/\/(?:dev\.azure\.com\/([^/]+)\/([^/]+)|([^.]+)\.visualstudio\.com\/([^/]+))\/_git\/([^/]+)/);
    if (match) {
      const org = match[1] || match[3];
      const project = match[2] || match[4];
      const repo = match[5];
      return `https://dev.azure.com/${org}/${project}/_git/${repo}`;
    }
    return null;
  }

  setSubtitle(text: string) {
    const el = this.container.querySelector('.pr-home-subtitle');
    if (el) el.textContent = text;
  }

  private render() {
    // Build monitored repo tabs
    const monitoredTabs = this.monitoredRepos.map(repo => {
      const key = this.getRepoKey(repo);
      const tabId = `monitored-${key}`;
      const prs = this.monitoredPRsMap.get(key) || [];
      return `
        <button class="pr-tab" data-tab="${escapeHtml(tabId)}">
          ${iconHtml(Globe, { size: 14 })}
          <span>${escapeHtml(repo.name)}</span>
          <span class="tab-count" id="count-${escapeHtml(key)}">${prs.length}</span>
        </button>
      `;
    }).join('');

    // Build monitored repo lists
    const monitoredLists = this.monitoredRepos.map(repo => {
      const key = this.getRepoKey(repo);
      const tabId = `monitored-${key}`;
      return `<div class="pr-list hidden" id="prList-${escapeHtml(key)}" data-tab-content="${escapeHtml(tabId)}"></div>`;
    }).join('');

    this.container.innerHTML = `
      <div class="pr-home-view">
        <header class="pr-home-header">
          <div class="pr-home-title">
            <h1>Pull Requests</h1>
            <span class="pr-home-subtitle">Loading...</span>
          </div>
          <button class="btn btn-secondary" id="refreshPRsBtn">
            ${iconHtml(RefreshCw, { size: 16 })}
            Refresh
          </button>
        </header>

        <div class="pr-url-bar">
          <div class="pr-url-input-group">
            ${iconHtml(ExternalLink, { size: 16 })}
            <input type="text" class="pr-url-input" id="prUrlInput" placeholder="Paste Azure DevOps PR URL to open..." />
            <button class="btn btn-primary" id="openPrUrlBtn">Open</button>
          </div>
          <div class="pr-url-error hidden" id="prUrlError">Invalid Azure DevOps PR URL</div>
        </div>

        <div class="pr-home-tabs">
          <button class="pr-tab active" data-tab="review">
            <span>For Review</span>
            <span class="tab-count" id="reviewCount">0</span>
          </button>
          <button class="pr-tab" data-tab="created">
            <span>Created by Me</span>
            <span class="tab-count" id="createdCount">0</span>
          </button>
          ${monitoredTabs}
        </div>

        <div class="pr-home-lists">
          <div class="pr-list" id="prListReview" data-tab-content="review"></div>
          <div class="pr-list hidden" id="prListCreated" data-tab-content="created"></div>
          ${monitoredLists}
        </div>
      </div>
    `;

    this.attachEventListeners();
    // Re-apply active tab state
    this.switchTab(this.activeTab);
  }

  private attachEventListeners() {
    this.container.querySelectorAll('.pr-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = (tab as HTMLElement).dataset.tab!;
        this.switchTab(tabName);
      });
    });

    this.container.querySelector('#refreshPRsBtn')?.addEventListener('click', () => {
      this.refreshCallback?.();
    });

    this.container.querySelector('#openPrUrlBtn')?.addEventListener('click', () => {
      this.handleOpenByUrl();
    });

    this.container.querySelector('#prUrlInput')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        this.handleOpenByUrl();
      }
    });

    this.container.querySelector('#prUrlInput')?.addEventListener('input', () => {
      this.container.querySelector('#prUrlError')?.classList.add('hidden');
    });
  }

  private handleOpenByUrl() {
    const input = this.container.querySelector('#prUrlInput') as HTMLInputElement | null;
    const errorEl = this.container.querySelector('#prUrlError');
    if (!input || !errorEl) return;

    const url = input.value.trim();
    const match = url.match(
      /https:\/\/(?:dev\.azure\.com\/([^/]+)\/([^/]+)|([^.]+)\.visualstudio\.com\/([^/]+))\/_git\/[^/]+\/pullrequest\/(\d+)/
    );

    if (match) {
      const org = decodeURIComponent(match[1] || match[3]);
      const project = decodeURIComponent(match[2] || match[4]);
      const prId = parseInt(match[5], 10);
      errorEl.classList.add('hidden');
      input.value = '';
      this.openPRByUrlCallback?.(org, project, prId);
    } else {
      errorEl.classList.remove('hidden');
    }
  }

  private switchTab(tab: string) {
    // Validate tab exists (for monitored tabs that might have been removed)
    const tabButton = this.container.querySelector(`[data-tab="${tab}"]`);
    if (!tabButton && tab !== 'review' && tab !== 'created') {
      tab = 'review'; // Fall back to review tab
    }

    this.activeTab = tab;

    this.container.querySelectorAll('.pr-tab').forEach(t => {
      t.classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
    });

    this.container.querySelectorAll('.pr-list').forEach(list => {
      const listTab = (list as HTMLElement).dataset.tabContent;
      list.classList.toggle('hidden', listTab !== tab);
    });
  }

  private renderPRLists() {
    this.renderPRList('review', this.myPRs);
    this.renderPRList('created', this.createdPRs);

    // Render each monitored repo's PR list
    for (const repo of this.monitoredRepos) {
      const key = this.getRepoKey(repo);
      const prs = this.monitoredPRsMap.get(key) || [];
      this.renderMonitoredPRList(repo, prs);
    }

    // Update counts
    const reviewCount = this.container.querySelector('#reviewCount');
    const createdCount = this.container.querySelector('#createdCount');
    if (reviewCount) reviewCount.textContent = this.myPRs.length.toString();
    if (createdCount) createdCount.textContent = this.createdPRs.length.toString();

    for (const repo of this.monitoredRepos) {
      const key = this.getRepoKey(repo);
      const prs = this.monitoredPRsMap.get(key) || [];
      const countEl = this.container.querySelector(`#count-${CSS.escape(key)}`);
      if (countEl) countEl.textContent = prs.length.toString();
    }
  }

  private renderPRList(type: 'review' | 'created', prs: PullRequest[]) {
    const containerSelector = type === 'review' ? '#prListReview' : '#prListCreated';
    const container = this.container.querySelector(containerSelector);
    if (!container) return;

    if (prs.length === 0) {
      container.innerHTML = `
        <div class="pr-list-empty">
          ${iconHtml(GitPullRequest, { size: 48, strokeWidth: 1.5 })}
          <p>No pull requests found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = prs.map(pr => this.renderPRCard(pr)).join('');
    this.attachPRCardListeners(container, prs);
  }

  private renderMonitoredPRList(repo: MonitoredRepository, prs: PullRequest[]) {
    const key = this.getRepoKey(repo);
    const container = this.container.querySelector(`#prList-${CSS.escape(key)}`);
    if (!container) return;

    if (prs.length === 0) {
      container.innerHTML = `
        <div class="pr-list-empty">
          ${iconHtml(Globe, { size: 48, strokeWidth: 1.5 })}
          <p>No active pull requests in ${escapeHtml(repo.name)}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = prs.map(pr => this.renderPRCard(pr)).join('');
    this.attachPRCardListeners(container, prs);
  }

  private attachPRCardListeners(container: Element, prs: PullRequest[]) {
    container.querySelectorAll('.pr-card').forEach(card => {
      card.addEventListener('click', () => {
        const prId = parseInt((card as HTMLElement).dataset.prId || '0');
        const pr = prs.find(p => p.pullRequestId === prId);
        if (pr) {
          this.openPRCallback?.(pr);
        }
      });
    });
  }

  private renderPRCard(pr: PullRequest): string {
    const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
    const targetBranch = pr.targetRefName.replace('refs/heads/', '');
    const date = new Date(pr.creationDate);
    const timeAgo = formatTimeAgo(date);

    const reviewers = (pr.reviewers || []).slice(0, 5).map(r => {
      const voteClass = this.getVoteClass(r.vote);
      const initials = this.getInitials(r.displayName);
      const hasImage = r.imageUrl && r.imageUrl.trim();
      return `
        <div class="reviewer-wrapper">
          ${hasImage
            ? `<img class="pr-card-reviewer" src="${r.imageUrl}" alt="${initials}" title="${r.displayName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''}
          <span class="pr-card-reviewer-placeholder" ${hasImage ? 'style="display:none"' : ''} title="${r.displayName}">${initials}</span>
          ${r.vote !== 0 ? `<span class="pr-card-vote ${voteClass}"></span>` : ''}
        </div>
      `;
    }).join('');

    // Check for linked repository
    const repoUrl = this.getRepoUrl(pr);
    const linkedRepo = repoUrl ? this.linkedReposCache.get(repoUrl) : null;
    const linkedPathHtml = linkedRepo ? `
      <div class="pr-card-linked-path" title="${escapeHtml(linkedRepo.path)}">
        ${iconHtml(Link, { size: 14 })}
        <span class="linked-path-text">${escapeHtml(linkedRepo.normalized || linkedRepo.originUrl)}</span>
        <span class="linked-local-path">${escapeHtml(linkedRepo.path)}</span>
      </div>
    ` : '';

    // Create linked badge if repo is linked
    const linkedBadgeHtml = linkedRepo ? `
      <span class="pr-card-linked-badge" title="${escapeHtml(linkedRepo.normalized || '')}&#10;${escapeHtml(linkedRepo.path)}">
        ${iconHtml(Link, { size: 12 })}
        ${escapeHtml(linkedRepo.normalized || 'Linked')}
      </span>
    ` : '';

    return `
      <div class="pr-card${linkedRepo ? ' pr-card-linked' : ''}" data-pr-id="${pr.pullRequestId}">
        <div class="pr-card-header">
          <span class="pr-card-id">#${pr.pullRequestId}</span>
          <span class="pr-card-title">${escapeHtml(pr.title)}</span>
        </div>
        <div class="pr-card-meta">
          <span class="pr-card-meta-item">
            <span class="pr-card-repo">${pr.repository.name}</span>
            ${linkedBadgeHtml}
          </span>
          <span class="pr-card-meta-item">
            ${sourceBranch} → ${targetBranch}
          </span>
          <span class="pr-card-meta-item">
            ${iconHtml(Clock, { size: 14 })}
            ${timeAgo}
          </span>
          <span class="pr-card-meta-item">
            by ${pr.createdBy.displayName}
          </span>
          ${reviewers ? `<div class="pr-card-reviewers">${reviewers}</div>` : ''}
        </div>
        ${linkedPathHtml}
      </div>
    `;
  }

  private getVoteClass(vote: number): string {
    if (vote === 10) return 'approved';
    if (vote === 5) return 'approved-suggestions';
    if (vote === -5) return 'waiting';
    if (vote === -10) return 'rejected';
    return 'no-vote';
  }

  private getInitials(name: string): string {
    const parts = name.split(/[\s\\]+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
}

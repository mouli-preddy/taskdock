import type { FileChange, ChangeType } from '../../shared/types.js';
import { iconHtml, ChevronRight, Folder, File, CheckCircle, Circle, CirclePlus, CircleMinus, FilePen, Minus, EyeOff, Eye } from '../utils/icons.js';

/**
 * Simple glob pattern matching for generated file patterns.
 * Supports:
 * - * matches any characters except /
 * - ** matches any characters including /
 * - ? matches single character
 */
function matchGlobPattern(pattern: string, filePath: string): boolean {
  // Guard against null/undefined values
  if (!pattern || !filePath) return false;

  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Convert glob pattern to regex
  let regexStr = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars (except * and ?)
    .replace(/\*\*/g, '§§')  // Temp placeholder for **
    .replace(/\*/g, '[^/]*')  // * matches anything except /
    .replace(/§§/g, '.*')  // ** matches anything including /
    .replace(/\?/g, '.');  // ? matches single char

  // Pattern should match the filename or full path
  const regex = new RegExp(`(^|/)${regexStr}$`, 'i');
  return regex.test(normalizedPath);
}

interface FileNode {
  name: string;
  displayName: string; // For collapsed paths like "src/renderer/components"
  path: string;
  filePath?: string; // Original file path for non-folders
  isFolder: boolean;
  changeType?: ChangeType;
  children: FileNode[];
  hasComments: boolean;
  isReviewed: boolean;
  fileCount: number; // Number of files in this folder (recursive)
}

export class FileTree {
  private container: HTMLElement;
  private files: FileChange[] = [];
  private selectedPath: string | null = null;
  private selectCallback?: (path: string) => void;
  private reviewCallback?: (path: string, reviewed: boolean) => void;
  private collapsedFolders: Set<string> = new Set(); // Changed: track collapsed instead of expanded
  private reviewedFiles: Set<string> = new Set();
  private viewMode: 'tree' | 'flat' | 'grouped' = 'tree'; // Default to tree view
  private prId: string = '';
  private generatedFilePatterns: string[] = [];
  private showGeneratedFiles: boolean = true;  // Show by default until patterns are set

  constructor() {
    this.container = document.getElementById('fileTree')!;
  }

  setContainer(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  onSelect(callback: (path: string) => void) {
    this.selectCallback = callback;
  }

  onReview(callback: (path: string, reviewed: boolean) => void) {
    this.reviewCallback = callback;
  }

  setPrId(prId: string) {
    this.prId = prId;
    this.loadReviewedState();
  }

  setFiles(files: FileChange[]) {
    this.files = files;
    this.render();
  }

  setGeneratedFilePatterns(patterns: string[]) {
    this.generatedFilePatterns = patterns;
    // Hide generated files by default when patterns are set
    if (patterns.length > 0) {
      this.showGeneratedFiles = false;
    }
    this.render();
  }

  toggleShowGeneratedFiles(): boolean {
    this.showGeneratedFiles = !this.showGeneratedFiles;
    this.render();
    return this.showGeneratedFiles;
  }

  getShowGeneratedFiles(): boolean {
    return this.showGeneratedFiles;
  }

  isGeneratedFile(filePath: string): boolean {
    if (!filePath || this.generatedFilePatterns.length === 0) return false;
    return this.generatedFilePatterns.some(pattern => pattern && matchGlobPattern(pattern, filePath));
  }

  getGeneratedFilesCount(): number {
    return this.files.filter(f => this.isGeneratedFile(f.path)).length;
  }

  getVisibleFiles(): FileChange[] {
    // Filter out files with null/undefined paths
    const validFiles = this.files.filter(f => f.path);
    if (this.showGeneratedFiles || this.generatedFilePatterns.length === 0) {
      return validFiles;
    }
    return validFiles.filter(f => !this.isGeneratedFile(f.path));
  }

  isFileReviewed(path: string): boolean {
    return this.reviewedFiles.has(path);
  }

  setFileReviewed(path: string, reviewed: boolean) {
    if (reviewed) {
      this.reviewedFiles.add(path);
    } else {
      this.reviewedFiles.delete(path);
    }
    this.saveReviewedState();
    this.render();
  }

  setFolderReviewed(folderPath: string, reviewed: boolean) {
    // Find all files that are under this folder path
    const normalizedFolder = folderPath.replace(/^\//, ''); // Remove leading slash

    for (const file of this.files) {
      // Skip files with null/undefined paths
      if (!file.path) continue;
      // Check if file is under this folder
      const filePath = file.path.replace(/^\//, '');
      if (filePath.startsWith(normalizedFolder + '/') || filePath.startsWith(normalizedFolder)) {
        if (reviewed) {
          this.reviewedFiles.add(file.path);
        } else {
          this.reviewedFiles.delete(file.path);
        }
      }
    }

    this.saveReviewedState();
    this.render();

    if (this.reviewCallback) {
      // Notify about the change (use folder path to indicate bulk update)
      this.reviewCallback(folderPath, reviewed);
    }
  }

  getFolderReviewStatus(folderPath: string): 'none' | 'partial' | 'all' {
    const normalizedFolder = folderPath.replace(/^\//, '');
    let total = 0;
    let reviewed = 0;

    for (const file of this.files) {
      // Skip files with null/undefined paths
      if (!file.path) continue;
      const filePath = file.path.replace(/^\//, '');
      if (filePath.startsWith(normalizedFolder + '/') || filePath.startsWith(normalizedFolder)) {
        total++;
        if (this.reviewedFiles.has(file.path)) {
          reviewed++;
        }
      }
    }

    if (total === 0) return 'none';
    if (reviewed === 0) return 'none';
    if (reviewed === total) return 'all';
    return 'partial';
  }

  getReviewProgress(): { reviewed: number; total: number } {
    return {
      reviewed: this.reviewedFiles.size,
      total: this.files.length
    };
  }

  private loadReviewedState() {
    if (!this.prId) return;
    try {
      const stored = localStorage.getItem(`pr-reviewed-${this.prId}`);
      if (stored) {
        this.reviewedFiles = new Set(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('Failed to load reviewed state:', e);
    }
  }

  private saveReviewedState() {
    if (!this.prId) return;
    try {
      localStorage.setItem(`pr-reviewed-${this.prId}`, JSON.stringify([...this.reviewedFiles]));
    } catch (e) {
      console.warn('Failed to save reviewed state:', e);
    }
  }

  setSelected(path: string) {
    this.selectedPath = path;
    this.updateSelection();
  }

  private render() {
    if (this.viewMode === 'flat') {
      this.renderFlat();
    } else if (this.viewMode === 'grouped') {
      this.renderGrouped();
    } else {
      this.renderTree();
    }
  }

  private renderGrouped() {
    // Group files by change type
    const groups: Record<string, FileChange[]> = {
      add: [],
      edit: [],
      delete: [],
      rename: [],
    };

    const visibleFiles = this.getVisibleFiles();
    for (const file of visibleFiles) {
      const type = file.changeType || 'edit';
      if (groups[type]) {
        groups[type].push(file);
      } else {
        groups.edit.push(file);
      }
    }

    const groupLabels: Record<string, string> = {
      add: 'Added',
      edit: 'Modified',
      delete: 'Deleted',
      rename: 'Renamed',
    };

    if (!this.container) return;

    let html = '';
    for (const [type, files] of Object.entries(groups)) {
      if (files.length === 0) continue;

      const isCollapsed = this.collapsedFolders.has(`group-${type}`);
      html += `
        <div class="file-group" data-group="${type}">
          <div class="file-group-header ${type}">
            ${iconHtml(ChevronRight, { size: 16, class: `folder-toggle ${isCollapsed ? '' : 'expanded'}` })}
            <span class="file-group-label">${groupLabels[type]}</span>
            <span class="file-group-count">${files.length}</span>
          </div>
          <div class="file-group-content ${isCollapsed ? 'collapsed' : ''}">
            ${files.map(file => this.renderFileItem(file, 1)).join('')}
          </div>
        </div>
      `;
    }

    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  private renderFlat() {
    if (!this.container) return;
    // Sort files by path
    const visibleFiles = this.getVisibleFiles();
    const sorted = [...visibleFiles].sort((a, b) => a.path.localeCompare(b.path));
    this.container.innerHTML = sorted.map(file => this.renderFileItem(file, 0)).join('');
    this.attachEventListeners();
  }

  private renderFileItem(file: FileChange, depth: number): string {
    const fileName = file.path.split('/').pop() || file.path;
    const dirPath = file.path.substring(0, file.path.length - fileName.length - 1);
    const isReviewed = this.reviewedFiles.has(file.path);
    const paddingLeft = 8 + depth * 16;

    return `
      <div class="file-item ${file.path === this.selectedPath ? 'active' : ''} ${file.threads.length > 0 ? 'has-comments' : ''} ${isReviewed ? 'reviewed' : ''}"
           data-path="${file.path}" style="padding-left: ${paddingLeft}px">
        <button class="file-review-toggle" data-path="${file.path}" title="${isReviewed ? 'Mark as not reviewed' : 'Mark as reviewed'}">
          ${isReviewed ? this.getCheckIcon() : this.getCircleIcon()}
        </button>
        ${this.getFileIcon(file.changeType)}
        <div class="file-info">
          <span class="file-name">${fileName}</span>
          ${this.viewMode === 'flat' && dirPath ? `<span class="file-path">${dirPath}</span>` : ''}
        </div>
        ${file.threads.length > 0 ? `<span class="file-comment-count">${file.threads.length}</span>` : ''}
      </div>
    `;
  }

  private renderTree() {
    if (!this.container) return;
    const tree = this.buildTree();
    const optimized = this.optimizeTree(tree);
    this.container.innerHTML = this.renderNode(optimized, 0);
    this.attachEventListeners();
  }

  private buildTree(): FileNode[] {
    const root: FileNode[] = [];
    const visibleFiles = this.getVisibleFiles();

    for (const file of visibleFiles) {
      // Skip files with null/undefined paths
      if (!file.path) continue;
      const parts = file.path.split('/').filter(p => p);
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        const isLast = i === parts.length - 1;
        const currentPath = '/' + parts.slice(0, i + 1).join('/');

        let node = current.find(n => n.name === name);

        if (!node) {
          node = {
            name,
            displayName: name,
            path: currentPath,
            filePath: isLast ? file.path : undefined,
            isFolder: !isLast,
            changeType: isLast ? file.changeType : undefined,
            children: [],
            hasComments: isLast && file.threads.length > 0,
            isReviewed: isLast && this.reviewedFiles.has(file.path),
            fileCount: 0,
          };
          current.push(node);
        }

        if (!isLast) {
          current = node.children;
        }
      }
    }

    // Sort and count files
    const processNodes = (nodes: FileNode[]): FileNode[] => {
      return nodes.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      }).map(node => {
        const processed = {
          ...node,
          children: processNodes(node.children),
        };
        // Count files recursively
        if (processed.isFolder) {
          processed.fileCount = this.countFiles(processed);
        }
        return processed;
      });
    };

    return processNodes(root);
  }

  private countFiles(node: FileNode): number {
    if (!node.isFolder) return 1;
    return node.children.reduce((sum, child) => sum + this.countFiles(child), 0);
  }

  // Collapse single-child folder chains into combined paths
  private optimizeTree(nodes: FileNode[]): FileNode[] {
    return nodes.map(node => {
      if (!node.isFolder) return node;

      // Recursively optimize children first
      let optimized = { ...node, children: this.optimizeTree(node.children) };

      // Collapse single-child folder chains
      while (optimized.children.length === 1 && optimized.children[0].isFolder) {
        const child = optimized.children[0];
        optimized = {
          ...child,
          displayName: `${optimized.displayName}/${child.displayName}`,
          path: child.path,
          children: this.optimizeTree(child.children),
          fileCount: child.fileCount,
        };
      }

      return optimized;
    });
  }

  private renderNode(nodes: FileNode[], depth: number): string {
    return nodes.map(node => {
      if (node.isFolder) {
        const isCollapsed = this.collapsedFolders.has(node.path);
        const reviewStatus = this.getFolderReviewStatus(node.path);
        const reviewStatusClass = reviewStatus === 'all' ? 'reviewed' : reviewStatus === 'partial' ? 'partial-reviewed' : '';
        return `
          <div class="file-folder ${reviewStatusClass}" data-path="${node.path}">
            <div class="file-item folder-header" style="padding-left: ${8 + depth * 16}px">
              <button class="folder-review-toggle" data-folder-path="${node.path}" title="${reviewStatus === 'all' ? 'Mark folder as not reviewed' : 'Mark folder as reviewed'}">
                ${this.getFolderReviewIcon(reviewStatus)}
              </button>
              ${iconHtml(ChevronRight, { size: 16, class: `folder-toggle ${isCollapsed ? '' : 'expanded'}` })}
              ${iconHtml(Folder, { size: 16, class: 'file-icon folder', fill: 'currentColor' })}
              <span class="file-name folder-name">${node.displayName}</span>
              <span class="folder-count">${node.fileCount}</span>
            </div>
            <div class="folder-children ${isCollapsed ? 'collapsed' : ''}">
              ${this.renderNode(node.children, depth + 1)}
            </div>
          </div>
        `;
      } else {
        const filePath = node.filePath || this.files.find(f => f.path.endsWith(node.path) || node.path.endsWith(f.path))?.path || node.path;
        const file = this.files.find(f => f.path === filePath);
        const commentCount = file?.threads.length || 0;
        return `
          <div class="file-item ${filePath === this.selectedPath ? 'active' : ''} ${node.hasComments ? 'has-comments' : ''} ${node.isReviewed ? 'reviewed' : ''}"
               data-path="${filePath}" style="padding-left: ${8 + depth * 16}px">
            <button class="file-review-toggle" data-path="${filePath}" title="${node.isReviewed ? 'Mark as not reviewed' : 'Mark as reviewed'}">
              ${node.isReviewed ? this.getCheckIcon() : this.getCircleIcon()}
            </button>
            ${this.getFileIcon(node.changeType)}
            <span class="file-name">${node.displayName}</span>
            ${commentCount > 0 ? `<span class="file-comment-count">${commentCount}</span>` : ''}
          </div>
        `;
      }
    }).join('');
  }

  private getFileIcon(changeType?: ChangeType): string {
    switch (changeType) {
      case 'add':
        return iconHtml(CirclePlus, { size: 16, class: 'file-icon add' });

      case 'delete':
        return iconHtml(CircleMinus, { size: 16, class: 'file-icon delete' });

      case 'rename':
        return iconHtml(FilePen, { size: 16, class: 'file-icon rename' });

      case 'edit':
      default:
        return iconHtml(File, { size: 16, class: 'file-icon edit' });
    }
  }

  private getCheckIcon(): string {
    return iconHtml(CheckCircle, { size: 14, strokeWidth: 2.5 });
  }

  private getCircleIcon(): string {
    return iconHtml(Circle, { size: 14 });
  }

  private getFolderReviewIcon(status: 'none' | 'partial' | 'all'): string {
    if (status === 'all') {
      // Fully reviewed - filled check
      return iconHtml(CheckCircle, { size: 14, strokeWidth: 2.5 });
    } else if (status === 'partial') {
      // Partially reviewed - circle with dash (minus)
      return iconHtml(Minus, { size: 14 });
    } else {
      // Not reviewed - empty circle
      return iconHtml(Circle, { size: 14 });
    }
  }

  private updateSelection() {
    this.container.querySelectorAll('.file-item').forEach(item => {
      const path = (item as HTMLElement).dataset.path;
      item.classList.toggle('active', path === this.selectedPath);
    });
  }

  private attachEventListeners() {
    // File review toggle
    this.container.querySelectorAll('.file-review-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = (e.currentTarget as HTMLElement).dataset.path;
        if (path) {
          const isCurrentlyReviewed = this.reviewedFiles.has(path);
          this.setFileReviewed(path, !isCurrentlyReviewed);
          if (this.reviewCallback) {
            this.reviewCallback(path, !isCurrentlyReviewed);
          }
        }
      });
    });

    // Folder review toggle
    this.container.querySelectorAll('.folder-review-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderPath = (e.currentTarget as HTMLElement).dataset.folderPath;
        if (folderPath) {
          const currentStatus = this.getFolderReviewStatus(folderPath);
          // If all reviewed, unmark all; otherwise mark all as reviewed
          const shouldReview = currentStatus !== 'all';
          this.setFolderReviewed(folderPath, shouldReview);
        }
      });
    });

    // File selection
    this.container.querySelectorAll('.file-item:not(.folder-header)').forEach(item => {
      item.addEventListener('click', (e) => {
        // Ignore clicks on review toggle
        if ((e.target as HTMLElement).closest('.file-review-toggle')) {
          return;
        }
        const path = (e.currentTarget as HTMLElement).dataset.path;
        if (path && this.selectCallback) {
          this.selectCallback(path);
        }
      });
    });

    // Folder expansion
    this.container.querySelectorAll('.folder-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const folder = (e.currentTarget as HTMLElement).closest('.file-folder');
        const path = folder?.getAttribute('data-path');

        if (path) {
          if (this.collapsedFolders.has(path)) {
            this.collapsedFolders.delete(path);
          } else {
            this.collapsedFolders.add(path);
          }
          this.render();
        }
      });
    });

    // Group expansion
    this.container.querySelectorAll('.file-group-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const group = (e.currentTarget as HTMLElement).closest('.file-group');
        const groupType = group?.getAttribute('data-group');

        if (groupType) {
          const key = `group-${groupType}`;
          if (this.collapsedFolders.has(key)) {
            this.collapsedFolders.delete(key);
          } else {
            this.collapsedFolders.add(key);
          }
          this.render();
        }
      });
    });
  }

  toggleViewMode() {
    if (this.viewMode === 'tree') {
      this.viewMode = 'grouped';
    } else if (this.viewMode === 'grouped') {
      this.viewMode = 'flat';
    } else {
      this.viewMode = 'tree';
    }
    this.render();
    return this.viewMode;
  }

  setViewMode(mode: 'tree' | 'flat' | 'grouped') {
    this.viewMode = mode;
    this.render();
  }

  getViewMode(): string {
    return this.viewMode;
  }
}

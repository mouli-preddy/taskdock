import { getIcon, GitPullRequest, LayoutGrid, Search, Terminal, Settings, Info, Activity, AlertTriangle, FolderOpen } from '../utils/icons.js';

export type SectionId = 'review' | 'workItems' | 'icm' | 'terminals' | 'settings' | 'about' | 'workspaces' | string;

export interface SectionDef {
  id: SectionId;
  icon: string;
  label: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: 'review',
    icon: getIcon(GitPullRequest, 20),
    label: 'Review',
  },
  {
    id: 'workItems',
    icon: getIcon(LayoutGrid, 20),
    label: 'Work Items',
  },
  {
    id: 'dgrep',
    icon: getIcon(Search, 20),
    label: 'Log Search',
  },
  {
    id: 'cfv',
    icon: getIcon(Activity, 20),
    label: 'Call Flow',
  },
  {
    id: 'icm',
    icon: getIcon(AlertTriangle, 20),
    label: 'ICM',
  },
  {
    id: 'workspaces',
    icon: getIcon(FolderOpen, 20),
    label: 'Workspaces',
  },
  {
    id: 'terminals',
    icon: getIcon(Terminal, 20),
    label: 'Terminals',
  },
  {
    id: 'settings',
    icon: getIcon(Settings, 20),
    label: 'Settings',
  },
  {
    id: 'about',
    icon: getIcon(Info, 20),
    label: 'About',
  },
];

export class SectionSidebar {
  private container: HTMLElement;
  private activeSection: SectionId = 'review';
  private expanded = false;
  private selectCallback: ((section: SectionId) => void) | null = null;
  private dynamicSections: SectionDef[] = [];

  constructor() {
    this.container = document.getElementById('sectionSidebar')!;
    this.render();
    this.attachEventListeners();
  }

  onSelect(callback: (section: SectionId) => void) {
    this.selectCallback = callback;
  }

  setActive(section: SectionId) {
    this.activeSection = section;
    this.updateActiveState();
  }

  getActive(): SectionId {
    return this.activeSection;
  }

  addSection(section: SectionDef) {
    this.dynamicSections.push(section);
    this.render();
    this.attachEventListeners();
  }

  removeSection(sectionId: string) {
    this.dynamicSections = this.dynamicSections.filter(s => s.id !== sectionId);
    this.render();
    this.attachEventListeners();
  }

  private render() {
    const allSections = [...SECTIONS, ...this.dynamicSections];
    this.container.innerHTML = `
      <div class="section-sidebar-items">
        ${allSections.map(s => `
          <button class="section-sidebar-item ${s.id === this.activeSection ? 'active' : ''}" data-section="${s.id}" title="${s.label}">
            <span class="section-icon">${s.icon}</span>
            <span class="section-label">${s.label}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  private attachEventListeners() {
    this.container.querySelectorAll('.section-sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        const section = (item as HTMLElement).dataset.section as SectionId;
        this.setActive(section);
        this.selectCallback?.(section);
      });
    });

    this.container.addEventListener('mouseenter', () => {
      this.expanded = true;
      this.container.classList.add('expanded');
    });

    this.container.addEventListener('mouseleave', () => {
      this.expanded = false;
      this.container.classList.remove('expanded');
    });
  }

  private updateActiveState() {
    this.container.querySelectorAll('.section-sidebar-item').forEach(item => {
      const section = (item as HTMLElement).dataset.section;
      item.classList.toggle('active', section === this.activeSection);
    });
  }
}

import { getIcon, GitPullRequest, LayoutGrid, Search, Terminal, Settings, Info, Activity, AlertTriangle, FolderOpen, ClipboardList } from '../utils/icons.js';

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
    id: 'tasks',
    icon: getIcon(ClipboardList, 20),
    label: 'Tasks',
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
  private activeSection: SectionId = 'workItems';
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

  private badges: Map<SectionId, number> = new Map();

  setBadge(sectionId: SectionId, count: number) {
    if (count <= 0) this.badges.delete(sectionId);
    else this.badges.set(sectionId, count);
    const btn = this.container.querySelector(`.section-sidebar-item[data-section="${sectionId}"]`);
    if (!btn) return;
    let badge = btn.querySelector('.section-badge') as HTMLElement | null;
    if (count <= 0) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'section-badge';
      btn.appendChild(badge);
    }
    badge.textContent = String(count);
  }

  private render() {
    const allSections = [...SECTIONS, ...this.dynamicSections];
    this.container.innerHTML = `
      <div class="section-sidebar-items">
        ${allSections.map(s => {
          const badgeCount = this.badges.get(s.id) ?? 0;
          return `
          <button class="section-sidebar-item ${s.id === this.activeSection ? 'active' : ''}" data-section="${s.id}" title="${s.label}">
            <span class="section-icon">${s.icon}</span>
            <span class="section-label">${s.label}</span>
            ${badgeCount > 0 ? `<span class="section-badge">${badgeCount}</span>` : ''}
          </button>`;
        }).join('')}
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

// Plugin System Shared Types

// ---- Manifest types ----

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  config?: Record<string, PluginConfigField>;
  triggers: PluginTrigger[];
  hooks?: PluginHooks;
}

export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean';
  label: string;
  required?: boolean;
  default?: string | number | boolean;
  secret?: boolean;
}

export type PluginTrigger = ManualTrigger | PollingTrigger | ScheduledTrigger;

export interface ManualTrigger {
  type: 'manual';
  id: string;
  workflow: string;
  label: string;
  timeout?: number;
}

export interface PollingTrigger {
  type: 'polling';
  id: string;
  workflow: string;
  interval: string;
  timeout?: number;
}

export interface ScheduledTrigger {
  type: 'scheduled';
  id: string;
  workflow: string;
  cron: string;
  timeout?: number;
}

export interface PluginHooks {
  'pr-review'?: PluginHookSet;
  'pr-home'?: PluginHookSet;
  'workitems'?: PluginHookSet;
  'terminals'?: PluginHookSet;
}

export interface PluginHookSet {
  toolbar?: PluginHookButton[];
  'row-actions'?: PluginHookButton[];
  'file-context-menu'?: PluginHookButton[];
  'comments-toolbar'?: PluginHookButton[];
  'bottom-panel'?: PluginHookButton[];
}

export interface PluginHookButton {
  label: string;
  icon: string;
  trigger: string;
  position?: 'left' | 'right';
}

// ---- UI types ----

export interface PluginUI {
  tab: {
    id: string;
    label: string;
    icon: string;
  };
  layout: PluginComponent;
}

export type PluginComponent =
  | TableComponent
  | DetailPanelComponent
  | CardComponent
  | SplitPanelComponent
  | ButtonGroupComponent
  | StatusBadgeComponent
  | KeyValueComponent
  | TimelineComponent
  | TabsComponent
  | FormComponent
  | MarkdownComponent
  | EmptyStateComponent
  | HeaderComponent;

export interface TableComponent {
  type: 'table';
  id: string;
  dataSource?: string;
  columns: TableColumn[];
  onRowClick?: string;
  polling?: { interval: number };
  sortable?: boolean;
  filterable?: boolean;
}

export interface TableColumn {
  key: string;
  label: string;
  width?: number;
  component?: string;
  colorMap?: Record<string, string>;
}

export interface DetailPanelComponent {
  type: 'detail-panel';
  id: string;
  dataSource?: string;
  sections: PluginComponent[];
}

export interface CardComponent {
  type: 'card';
  id?: string;
  label: string;
  content: string;
  renderAs?: 'text' | 'markdown' | 'code';
}

export interface SplitPanelComponent {
  type: 'split-panel';
  id?: string;
  sizes: [number, number];
  direction?: 'horizontal' | 'vertical';
  children: [PluginComponent, PluginComponent];
}

export interface ButtonGroupComponent {
  type: 'button-group';
  id?: string;
  buttons: { label: string; icon?: string; action: string; variant?: string }[];
}

export interface StatusBadgeComponent {
  type: 'status-badge';
  id?: string;
  value: string;
  colorMap?: Record<string, string>;
}

export interface KeyValueComponent {
  type: 'key-value';
  id?: string;
  dataSource?: string;
  fields?: { key: string; label: string }[];
}

export interface TimelineComponent {
  type: 'timeline';
  id?: string;
  dataSource?: string;
  fields?: { time: string; title: string; description: string };
}

export interface TabsComponent {
  type: 'tabs';
  id?: string;
  items: { label: string; content: PluginComponent }[];
}

export interface FormComponent {
  type: 'form';
  id?: string;
  fields: { key: string; label: string; type: string; required?: boolean }[];
  onSubmit?: string;
}

export interface MarkdownComponent {
  type: 'markdown';
  id?: string;
  content: string;
}

export interface EmptyStateComponent {
  type: 'empty-state';
  id?: string;
  icon?: string;
  title: string;
  description: string;
  action?: { label: string; trigger: string };
}

export interface HeaderComponent {
  type: 'header';
  id?: string;
  title: string;
  subtitle?: string;
}

// ---- Runtime types ----

export interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;
  manifest: PluginManifest;
  ui: PluginUI | null;
  config: Record<string, any>;
  enabled: boolean;
}

export interface PluginExecutionLog {
  pluginId: string;
  triggerId: string;
  timestamp: string;
  status: 'running' | 'success' | 'error';
  duration?: number;
  error?: string;
  logs: { level: string; message: string; timestamp: string }[];
}

export interface PluginUIUpdateEvent {
  pluginId: string;
  componentId: string;
  data: any;
}

export interface PluginUIInjectEvent {
  pluginId: string;
  tab: string;
  location: string;
  component: PluginComponent;
}

export interface PluginToastEvent {
  pluginId: string;
  message: string;
  level: 'success' | 'error' | 'warning' | 'info';
}

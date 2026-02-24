/**
 * DGrep Memory Service
 * Persists agent learnings per service (or namespace) in YAML files.
 *
 * File: ~/.taskdock/services/{key}.yml
 * Structure:
 *   dgrep:
 *     memories:
 *       - "Learning about error patterns..."
 *       - "User corrected: X actually means Y..."
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';

const SERVICES_DIR = path.join(os.homedir(), '.taskdock', 'services');

/** Sanitize a name for use as a filename (lowercase, alphanumeric + hyphens). */
function toFileKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureDir(): void {
  fs.mkdirSync(SERVICES_DIR, { recursive: true });
}

function getFilePath(key: string): string {
  return path.join(SERVICES_DIR, `${key}.yml`);
}

function loadYaml(filePath: string): Record<string, any> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf-8');
  return (yaml.load(raw) as Record<string, any>) || {};
}

function saveYaml(filePath: string, data: Record<string, any>): void {
  ensureDir();
  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: 120, noRefs: true }), 'utf-8');
}

/** Resolve the file key from service name or namespace. */
export function resolveMemoryKey(serviceName?: string | null, namespace?: string | null): string {
  if (serviceName) return toFileKey(serviceName);
  if (namespace) return toFileKey(namespace);
  return 'unknown';
}

/** Read all memories for a service/namespace. */
export function readMemories(key: string): string[] {
  const filePath = getFilePath(key);
  const doc = loadYaml(filePath);
  const memories = doc?.dgrep?.memories;
  if (!Array.isArray(memories)) return [];
  return memories.filter((m: any) => typeof m === 'string');
}

/** Add a memory for a service/namespace. Deduplicates exact matches. */
export function addMemory(key: string, memory: string): { added: boolean; total: number } {
  const filePath = getFilePath(key);
  const doc = loadYaml(filePath);

  if (!doc.dgrep) doc.dgrep = {};
  if (!Array.isArray(doc.dgrep.memories)) doc.dgrep.memories = [];

  const trimmed = memory.trim();
  if (!trimmed) return { added: false, total: doc.dgrep.memories.length };

  // Deduplicate
  if (doc.dgrep.memories.includes(trimmed)) {
    return { added: false, total: doc.dgrep.memories.length };
  }

  doc.dgrep.memories.push(trimmed);
  saveYaml(filePath, doc);
  return { added: true, total: doc.dgrep.memories.length };
}

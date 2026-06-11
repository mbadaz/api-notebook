import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = path.join(os.homedir(), '.apinotebook');
const INDEX_FILE = path.join(DATA_DIR, 'workspaces.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

export interface WorkspaceEntry {
  id: string;
  path: string;
}

interface AppState {
  activeEnvironments: Record<string, string | null>;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export function listWorkspaceEntries(): WorkspaceEntry[] {
  return readJson<WorkspaceEntry[]>(INDEX_FILE, []);
}

export function findWorkspaceEntry(id: string): WorkspaceEntry | undefined {
  return listWorkspaceEntries().find((e) => e.id === id);
}

export function addWorkspaceEntry(entry: WorkspaceEntry): void {
  const entries = listWorkspaceEntries().filter(
    (e) => e.id !== entry.id && e.path !== entry.path
  );
  entries.push(entry);
  writeJson(INDEX_FILE, entries);
}

export function removeWorkspaceEntry(id: string): void {
  writeJson(
    INDEX_FILE,
    listWorkspaceEntries().filter((e) => e.id !== id)
  );
  const state = readJson<AppState>(STATE_FILE, { activeEnvironments: {} });
  delete state.activeEnvironments[id];
  writeJson(STATE_FILE, state);
}

export function getActiveEnvironmentId(workspaceId: string): string | null {
  const state = readJson<AppState>(STATE_FILE, { activeEnvironments: {} });
  return state.activeEnvironments[workspaceId] ?? null;
}

export function setActiveEnvironmentId(
  workspaceId: string,
  environmentId: string | null
): void {
  const state = readJson<AppState>(STATE_FILE, { activeEnvironments: {} });
  state.activeEnvironments[workspaceId] = environmentId;
  writeJson(STATE_FILE, state);
}

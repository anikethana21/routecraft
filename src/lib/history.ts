import type { HistoryEntry } from '../types';

const KEY = 'routecraft.history';
const LEGACY_KEY = 'oneswagger.history';
const MAX_ITEMS = 200;

export function getHistory(): HistoryEntry[] {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        raw = legacy;
        localStorage.setItem(KEY, legacy);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addHistory(entry: Omit<HistoryEntry, 'id'>): HistoryEntry {
  const item: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  try {
    const next = [item, ...getHistory()].slice(0, MAX_ITEMS);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return item;
}

export function deleteHistoryItem(id: string): HistoryEntry[] {
  const next = getHistory().filter((item) => item.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function exportHistory(): string {
  return JSON.stringify(getHistory(), null, 2);
}

export function downloadHistory(): void {
  const blob = new Blob([exportHistory()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `routecraft-history-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function groupHistory(items: HistoryEntry[]): Array<{ label: string; items: HistoryEntry[] }> {
  const groups = new Map<string, HistoryEntry[]>();
  for (const item of items) {
    const date = new Date(item.timestamp);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const label = sameDay
      ? 'Today'
      : date.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const list = groups.get(label) || [];
    list.push(item);
    groups.set(label, list);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

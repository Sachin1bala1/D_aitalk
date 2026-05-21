/**
 * SnippetStore — native-backed SQL snippet CRUD with localStorage fallback/migration.
 * A snippet is a named, reusable piece of SQL with optional tags.
 */

import {
  loadJsonDocument,
  notifyNativePersistenceFallback,
  saveJsonDocument,
} from "../persistence/NativeJsonStore";

const KEY = "daitalk_snippets";
const DOC_KEY = "snippets";

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  tags: string[];
  createdAt: number;
}

let snippetCache: Snippet[] | null = null;
const listeners = new Set<() => void>();

export function loadSnippets(): Snippet[] {
  if (snippetCache) return snippetCache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      snippetCache = JSON.parse(raw) as Snippet[];
      return snippetCache;
    }
  } catch {}
  snippetCache = [];
  return snippetCache;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function persist(snippets: Snippet[]): void {
  snippetCache = snippets;
  notifyListeners();
  void persistSnippets(snippets);
}

async function persistSnippets(snippets: Snippet[]): Promise<void> {
  try {
    await saveJsonDocument(DOC_KEY, snippets);
    localStorage.removeItem(KEY);
  } catch {
    notifyNativePersistenceFallback("SQL snippets");
    localStorage.setItem(KEY, JSON.stringify(snippets));
  }
}

export async function ensureSnippetsLoaded(): Promise<Snippet[]> {
  const fallback = loadSnippets();
  const snippets = await loadJsonDocument<Snippet[]>(DOC_KEY, fallback);
  snippetCache = snippets;
  if (snippets === fallback) {
    await persistSnippets(snippets);
  }
  notifyListeners();
  return snippets;
}

export function subscribeSnippets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addSnippet(name: string, sql: string, tags: string[] = []): Snippet {
  const snippet: Snippet = {
    id: `snip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    sql: sql.trim(),
    tags,
    createdAt: Date.now(),
  };
  persist([snippet, ...loadSnippets()]);
  return snippet;
}

export function deleteSnippet(id: string): void {
  persist(loadSnippets().filter((s) => s.id !== id));
}

export function updateSnippet(id: string, changes: Partial<Pick<Snippet, "name" | "sql" | "tags">>): void {
  persist(loadSnippets().map((s) => (s.id === id ? { ...s, ...changes } : s)));
}

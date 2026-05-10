/**
 * SnippetStore — localStorage-backed SQL snippet CRUD.
 * A snippet is a named, reusable piece of SQL with optional tags.
 */

const KEY = "daitalk_snippets";

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  tags: string[];
  createdAt: number;
}

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Snippet[];
  } catch {}
  return [];
}

function persist(snippets: Snippet[]): void {
  localStorage.setItem(KEY, JSON.stringify(snippets));
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

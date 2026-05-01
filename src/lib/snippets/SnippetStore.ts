/**
 * SnippetStore keeps SQL snippets only for the current app session.
 * High-security mode avoids persisting SQL text into browser storage.
 */

const snippets: Snippet[] = [];

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  tags: string[];
  createdAt: number;
}

export function loadSnippets(): Snippet[] {
  return [...snippets];
}

function persist(next: Snippet[]): void {
  snippets.length = 0;
  snippets.push(...next);
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

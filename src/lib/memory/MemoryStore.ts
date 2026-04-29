// src/lib/memory/MemoryStore.ts
// Offline bag-of-words TF-IDF embedding — no external API needed.

const VOCAB_SIZE = 512;
const STOPWORDS = new Set([
  "a","an","the","is","it","in","on","at","to","for","of","and","or","but",
  "with","from","by","as","be","was","are","were","this","that","have","has",
  "do","does","did","will","would","could","should","not","no","i","you",
  "we","they","he","she","what","which","how","when","where","why","if","so",
]);

/** FNV-1a 32-bit hash — maps a token string to a bucket 0..VOCAB_SIZE-1 */
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % VOCAB_SIZE;
}

/** Tokenize: lowercase, split on non-alphanumeric, remove stopwords */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Produce a VOCAB_SIZE-dimensional TF-IDF-like bag-of-words vector */
export function embed(text: string): number[] {
  const tokens = tokenize(text);
  const counts = new Float64Array(VOCAB_SIZE);
  for (const t of tokens) {
    counts[fnv1a(t)] += 1;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < VOCAB_SIZE; i++) norm += counts[i] * counts[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return Array.from(counts);
  return Array.from(counts).map((v) => v / norm);
}

/** Cosine similarity between two unit vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already L2-normalized
}

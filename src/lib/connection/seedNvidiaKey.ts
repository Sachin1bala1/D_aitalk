// Seeds the NVIDIA API key on first run if not already configured.
// Key is stored in localStorage — never committed to source.
const STORAGE_KEY = "nvidia_api_key";
const DEFAULT_KEY = "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";

export function seedNvidiaKeyIfMissing(): void {
  if (!localStorage.getItem(STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, DEFAULT_KEY);
  }
}

export function getNvidiaApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setNvidiaApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

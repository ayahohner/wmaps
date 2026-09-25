export {};

declare global {
  interface Window {
    heap: Heap;
  }
  // Set at build time by Vite (see vite.config.ts `define`).
  // Read as a bare identifier: Vite substitutes it, `window.__APP_VERSION__`
  // does not work.
  const __APP_VERSION__: string;
}

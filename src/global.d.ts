export {};

declare global {
  interface Window {
    heap: Heap;
  }
  const __APP_VERSION__: string;
}

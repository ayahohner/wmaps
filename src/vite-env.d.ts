/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Sync relay; defaults to the production Worker. */
  readonly VITE_SYNC_RELAY_URL?: string;
  readonly VITE_DEBUG_ENABLED: string;
  readonly VITE_HEAP_ID: string;
  // put vite env variables here to allow intellisense
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}



declare const __DEV_WALLET_BUILD__: boolean;

interface ImportMetaEnv {
  readonly VITE_DEV_WALLET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

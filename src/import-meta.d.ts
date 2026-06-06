declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_PROJECT_ID?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
    readonly DEV?: boolean;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};


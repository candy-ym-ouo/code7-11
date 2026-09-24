/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TILE_URL?: string;
  readonly VITE_MAP_STYLE_URL?: string;
  readonly VITE_MAP_GLYPHS_URL?: string;
  readonly VITE_DEFAULT_MAP_CENTER?: string;
  readonly VITE_DEFAULT_MAP_ZOOM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
const base = process.env.PUBLIC_BASE_PATH || '/';
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://aggre.github.io',
  base,
  trailingSlash: 'always',
  integrations: [svelte()],
  output: 'static',
  vite: { build: { sourcemap: false } }
});

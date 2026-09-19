import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { loadEnvFile } from 'node:process';

try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://inox-304.github.io',
  base: process.env.PUBLIC_SITE_BASE_PATH || '/',
  output: 'static',
  devToolbar: { enabled: false },
  integrations: [sitemap()],
  vite: { optimizeDeps: { include: ['@google/model-viewer'] } },
  trailingSlash: 'always',
});

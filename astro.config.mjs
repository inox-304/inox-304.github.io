import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://inoxweb304.github.io',
  base: process.env.PUBLIC_SITE_BASE_PATH || '/',
  output: 'static',
  devToolbar: { enabled: false },
  integrations: [sitemap()],
  trailingSlash: 'always',
});

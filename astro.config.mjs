import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://inox304.pe',
  output: 'static',
  devToolbar: { enabled: false },
  integrations: [sitemap()],
  trailingSlash: 'always',
});

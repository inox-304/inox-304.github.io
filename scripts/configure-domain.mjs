import { writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../public/CNAME', import.meta.url));
const site = new URL(process.env.PUBLIC_SITE_URL || 'https://inox-304.github.io');
if (site.protocol !== 'https:' || site.username || site.password || site.port || site.pathname !== '/') throw new Error('PUBLIC_SITE_URL must be an HTTPS origin');
if (site.hostname.endsWith('.github.io')) await rm(target, { force: true });
else {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(site.hostname)) throw new Error('Invalid custom domain');
  await writeFile(target, `${site.hostname}\n`);
}

import { spawnSync } from 'node:child_process';

const env = { ...process.env, PUBLIC_CMS_MODE: 'api', PUBLIC_SITE_BASE_PATH: '/' };
for (const args of [['check'], ['build', '--outDir', './dist-server']]) {
  const result = spawnSync(process.execPath, ['node_modules/astro/bin/astro.mjs', ...args], { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

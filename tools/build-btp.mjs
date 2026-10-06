#!/usr/bin/env node
// Builds the static site for the SAP BTP HTML5 app repository, into btp/dist/.
//
//   node tools/build-btp.mjs
//
// The site keeps the repo's own folder layout (src/, config/, icons/, btp/), so the browser modules'
// relative imports work unchanged. The MTA build (btp/mta.yaml) runs this script.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT = path.join(ROOT, 'btp', 'dist');

const HEAD_TAG = '<head>';
const BODY_END = '</body>';
const BTP_SCRIPT = '<script type="module" src="/btp/app.js"></script>';
// The BTP app's display name. The localhost dashboard keeps the shared name.
const DISPLAY_NAME_REPLACEMENTS = [
  ['<title>Close Co-Pilot</title>', '<title>Month End Close Co-Pilot</title>'],
  ['<h1>Month-End Close Co-Pilot</h1>', '<h1>Month End Close Co-Pilot</h1>'],
];

export async function buildBundle(out = DEFAULT_OUT) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await cp(path.join(ROOT, 'src', 'lib'), path.join(out, 'src', 'lib'), { recursive: true });
  await cp(path.join(ROOT, 'src', 'dashboard'), path.join(out, 'src', 'dashboard'), { recursive: true });
  await cp(path.join(ROOT, 'icons'), path.join(out, 'icons'), { recursive: true });
  await mkdir(path.join(out, 'btp'), { recursive: true });
  await cp(path.join(ROOT, 'btp', 'app.js'), path.join(out, 'btp', 'app.js'));
  await cp(path.join(ROOT, 'btp', 'browser-snapshot.js'), path.join(out, 'btp', 'browser-snapshot.js'));

  // Same defaults as the repo, minus the SAP host name. The browser reaches SAP only through the
  // approuter (same origin), so the host belongs in the BTP destination, not in the page bundle.
  const config = JSON.parse(await readFile(path.join(ROOT, 'config', 'default-config.json'), 'utf8'));
  config.sap.baseUrl = '';
  await mkdir(path.join(out, 'config'), { recursive: true });
  await writeFile(path.join(out, 'config', 'default-config.json'), `${JSON.stringify(config, null, 2)}\n`);

  const html = await readFile(path.join(ROOT, 'src', 'dashboard', 'dashboard.html'), 'utf8');
  if (!html.includes(BODY_END)) throw new Error('dashboard.html changed: update tools/build-btp.mjs');
  // Same base-tag trick as web/server.mjs, so the stylesheet and icon paths keep working.
  let page = html
    .replace(HEAD_TAG, `${HEAD_TAG}\n  <base href="/src/dashboard/" />`)
    .replace(BODY_END, `  ${BTP_SCRIPT}\n${BODY_END}`);
  for (const [from, to] of DISPLAY_NAME_REPLACEMENTS) {
    if (!page.includes(from)) throw new Error(`dashboard.html changed: "${from}" not found`);
    page = page.replace(from, to);
  }
  await writeFile(path.join(out, 'index.html'), page);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = await buildBundle();
  console.log(`Built ${path.relative(ROOT, out)}`);
}

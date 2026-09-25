#!/usr/bin/env node
// Local web dashboard: serves the Chrome extension's dashboard UI as a normal web page on
// http://localhost, with SAP data fetched server-side (no CORS, no extension needed).
//
//   node web/server.mjs [--port 8787] [--open]
//
// Also started in-process by the MCP server's open_dashboard tool. Listens on 127.0.0.1 only;
// SAP credentials entered on the page stay in this process's memory.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

import {
  getSnapshot, testConnection, setSessionCredentials, hasCredentials, loadConfig, fetchServiceMetadata,
} from '../mcp/closeData.mjs';
import { periodVars } from '../src/lib/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Only these folders are ever served - never config files, tests or anything else in the repo.
const STATIC_DIRS = ['src/', 'web/', 'icons/'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 10_000) throw new Error('Request too large');
  }
  return data ? JSON.parse(data) : {};
}

async function state() {
  const config = await loadConfig();
  const vars = periodVars(config);
  return {
    demo: !!config.demoMode,
    signedIn: !!config.demoMode || hasCredentials(),
    system: config.sap.baseUrl,
    client: config.sap.client,
    defaults: vars,
  };
}

/** The extension's dashboard.html, re-pointed at the web app script. */
async function indexHtml() {
  let html = await readFile(path.join(ROOT, 'src/dashboard/dashboard.html'), 'utf8');
  html = html.replace('<head>', '<head>\n  <base href="/src/dashboard/" />');
  html = html.replace('<script type="module" src="dashboard.js"></script>', '<script type="module" src="/web/app.js"></script>');
  return html;
}

async function handle(req, res) {
  // Reject requests addressed to any other host name (DNS-rebinding protection).
  if (!ALLOWED_HOSTS.test(req.headers.host ?? '')) return json(res, 403, { error: 'Forbidden host' });
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, await state());

  // Diagnostic only: fetches a service's real $metadata using the signed-in session, so field/
  // entity names can be checked against the actual system instead of documentation or guesswork.
  // Not linked from the UI - used via curl/browser at /api/metadata?service=API_NAME.
  if (url.pathname === '/api/metadata' && req.method === 'GET') {
    const service = url.searchParams.get('service');
    if (!service) return json(res, 400, { error: 'service query param required, e.g. API_INSPECTIONLOT_SRV' });
    try {
      const xml = await fetchServiceMetadata(service);
      res.writeHead(200, { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store' });
      return res.end(xml);
    } catch (e) {
      return json(res, e.code === 'SAP_AUTH' ? 401 : 502, { error: e.message });
    }
  }

  if (url.pathname === '/api/snapshot' && req.method === 'GET') {
    try {
      const snap = await getSnapshot({
        companyCode: url.searchParams.get('company_code') || undefined,
        fiscalYear: url.searchParams.get('fiscal_year') || undefined,
        period: url.searchParams.get('period') || undefined,
        refresh: url.searchParams.get('refresh') === '1',
      });
      return json(res, 200, snap);
    } catch (e) {
      return json(res, e.code === 'SAP_AUTH' ? 401 : 502, { error: e.message });
    }
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const { user, password } = await readBody(req);
    if (!user || !password) return json(res, 400, { error: 'User and password are required' });
    const check = await testConnection({ user, password });
    if (!check.ok) return json(res, 401, { error: check.message });
    setSessionCredentials({ user, password });
    return json(res, 200, { ...(await state()), user });
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    setSessionCredentials(null);
    return json(res, 200, await state());
  }

  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    return res.end(await indexHtml());
  }

  const rel = path.posix.normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
  if (rel.includes('..') || !STATIC_DIRS.some((d) => rel.startsWith(d)) || !TYPES[path.extname(rel)]) {
    return json(res, 404, { error: 'Not found' });
  }
  try {
    const body = await readFile(path.join(ROOT, rel));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)], 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

let running = null;

/** Starts the dashboard once per process (later calls return the same URL); tries the next port if busy. */
export function startDashboard({ port = 8787, attempts = 10 } = {}) {
  running ??= new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handle(req, res).catch((e) => {
        console.error('[dashboard]', e);
        if (!res.headersSent) json(res, 500, { error: e.message });
      });
    });
    let tries = 0;
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && ++tries < attempts) server.listen(port + tries, '127.0.0.1');
      else reject(e);
    });
    server.on('listening', () => resolve({ url: `http://localhost:${server.address().port}/`, server }));
    server.listen(port, '127.0.0.1');
  });
  running.catch(() => (running = null));
  return running.then(({ url }) => url);
}

export async function stopDashboard() {
  if (!running) return;
  const { server } = await running;
  running = null;
  await new Promise((resolve) => server.close(resolve));
}

function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

// CLI entry point.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg > 0 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT) || 8787;
  const url = await startDashboard({ port });
  console.log(`Month-End Close Co-Pilot dashboard: ${url}`);
  if (process.argv.includes('--open')) openInBrowser(url);
}

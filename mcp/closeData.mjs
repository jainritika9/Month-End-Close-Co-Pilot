// Node-side data layer for the Claude Code plugin's MCP server. Reuses the Chrome extension's
// pure modules (OData URL building/parsing, analysis rules, demo data) and replaces the
// browser-only parts: config comes from files + environment, auth is Basic from environment.

import { readFile } from 'node:fs/promises';

import { deepMerge, periodVars } from '../src/lib/config.js';
import { buildUrl, parseODataPage } from '../src/lib/sapClient.js';
import { buildSnapshot } from '../src/lib/processing.js';
import { mockRaw } from '../src/lib/mockData.js';

const SOURCE_KEYS = ['checklist', 'unposted', 'grir', 'accruals'];
const CACHE_TTL_MS = 2 * 60 * 1000;

// Plugin userConfig values arrive either through the env mapping in plugin.json or as
// CLAUDE_PLUGIN_OPTION_<KEY>; unset options may arrive as empty strings, which mean "not set".
function option(envName, pluginKey) {
  const candidates = [
    process.env[envName],
    process.env[`CLAUDE_PLUGIN_OPTION_${pluginKey}`],
    process.env[`CLAUDE_PLUGIN_OPTION_${pluginKey.toUpperCase()}`],
  ];
  const v = candidates.find((c) => c !== undefined && c !== '' && !/^\$\{.*\}$/.test(c));
  return v ?? null;
}

export async function loadConfig() {
  const defaults = JSON.parse(await readFile(new URL('../config/default-config.json', import.meta.url), 'utf8'));
  let config = defaults;

  // Optional full override, e.g. a file exported from the extension's Settings page.
  const file = option('SAP_COPILOT_CONFIG', 'config_file');
  if (file) config = deepMerge(config, JSON.parse(await readFile(file, 'utf8')));

  const overrides = { sap: {} };
  const baseUrl = option('SAP_BASE_URL', 'sap_base_url');
  const client = option('SAP_CLIENT', 'sap_client');
  const companyCode = option('SAP_COMPANY_CODE', 'company_code');
  const fiscalYear = option('SAP_FISCAL_YEAR', 'fiscal_year');
  const demo = option('SAP_DEMO_MODE', 'demo_mode');
  if (baseUrl) overrides.sap.baseUrl = baseUrl;
  if (client) overrides.sap.client = client;
  if (companyCode) overrides.sap.companyCode = companyCode;
  if (fiscalYear) overrides.sap.fiscalYear = fiscalYear;
  if (demo !== null) overrides.demoMode = /^(true|1|yes)$/i.test(demo);
  return deepMerge(config, overrides);
}

function credentials() {
  const user = option('SAP_USER', 'sap_user');
  const password = option('SAP_PASSWORD', 'sap_password');
  return user && password ? { user, password } : null;
}

async function fetchJson(url, authHeader, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 401) throw new Error('SAP rejected the user name or password (401)');
    if (res.status === 403) throw new Error('SAP returned 403 - check S_SERVICE / F_BKPF_BUK authorizations (SU53)');
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error?.message?.value ?? body?.error?.message ?? '';
      } catch {
        // Non-JSON error body; the status code is enough.
      }
      throw new Error(`SAP returned ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSource(config, source, vars, authHeader, maxPages = 50) {
  let url = buildUrl(config, source, vars);
  const all = [];
  for (let page = 0; url && page < maxPages; page++) {
    const { rows, next } = parseODataPage(await fetchJson(url, authHeader, config.sap.requestTimeoutMs));
    all.push(...rows);
    url = next ? new URL(next, url) : null;
  }
  return all;
}

let cache = null;

/**
 * Returns the analysed close snapshot for a company code / period, fetched live (or demo data).
 * `overrides` may set companyCode, fiscalYear, period ("8" or "008"); `refresh` bypasses the cache.
 */
export async function getSnapshot({ companyCode, fiscalYear, period, refresh = false } = {}) {
  const config = await loadConfig();
  if (companyCode) config.sap.companyCode = companyCode;
  if (fiscalYear) config.sap.fiscalYear = String(fiscalYear);
  const today = new Date();
  const vars = periodVars(config, today);
  if (period) vars.period = String(period).padStart(3, '0');

  const key = JSON.stringify({ vars, demo: config.demoMode, base: config.sap.baseUrl });
  if (!refresh && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  let raw;
  if (config.demoMode) {
    raw = mockRaw(config, today);
  } else {
    const creds = credentials();
    if (!creds) {
      throw new Error(
        'SAP credentials are not configured. Set the plugin options sap_user and sap_password ' +
          '(/plugin → close-copilot → configure), or enable demo_mode to try it with sample data.',
      );
    }
    const authHeader = 'Basic ' + Buffer.from(`${creds.user}:${creds.password}`).toString('base64');
    const results = await Promise.allSettled(
      SOURCE_KEYS.map((k) => fetchSource(config, config.sources[k], vars, authHeader)),
    );
    const authFailure = results.find((r) => r.status === 'rejected' && /\b401\b/.test(r.reason?.message));
    if (authFailure) throw authFailure.reason;
    raw = Object.fromEntries(
      SOURCE_KEYS.map((k, i) => [k, results[i].status === 'fulfilled' ? results[i].value : results[i].reason]),
    );
  }

  const snapshot = buildSnapshot(raw, config, today);
  const value = {
    context: {
      companyCode: vars.companyCode,
      fiscalYear: vars.fiscalYear,
      period: vars.period,
      demoData: !!config.demoMode,
      system: config.demoMode ? null : config.sap.baseUrl,
      syncedAt: snapshot.syncedAt,
    },
    thresholds: config.thresholds,
    ...snapshot,
  };
  cache = { key, at: Date.now(), value };
  return value;
}

/** Checks connectivity and credentials with one cheap call to the login-check service. */
export async function testConnection() {
  const config = await loadConfig();
  if (config.demoMode) return { ok: true, demoData: true, message: 'Demo mode is on - no SAP connection is used.' };
  const creds = credentials();
  if (!creds) return { ok: false, message: 'sap_user / sap_password plugin options are not set.' };
  const url = new URL(config.auth.basic.pingPath, config.sap.proxyUrl || config.sap.baseUrl);
  url.searchParams.set('sap-client', config.sap.client);
  const authHeader = 'Basic ' + Buffer.from(`${creds.user}:${creds.password}`).toString('base64');
  try {
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    return {
      ok: res.ok,
      status: res.status,
      system: config.sap.baseUrl,
      client: config.sap.client,
      user: creds.user,
      message: res.ok ? 'Connected and authenticated.' : `Login check returned HTTP ${res.status}.`,
    };
  } catch (e) {
    return { ok: false, system: config.sap.baseUrl, message: `Could not reach SAP: ${e.message}` };
  }
}

/** Plain JSON view of an analysed item: SAP raw fields dropped, dates as YYYY-MM-DD. */
export function slim(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (k === '_raw') continue;
    out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  }
  return out;
}

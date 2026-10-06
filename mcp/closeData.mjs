// Node-side data layer for the Claude Code plugin's MCP server. Reuses the dashboard's
// pure modules (OData URL building/parsing, analysis rules, demo data) and replaces the
// browser-only parts: config comes from files + environment, auth is Basic from environment.

import { readFile } from 'node:fs/promises';

import { deepMerge, periodVars } from '../src/lib/config.js';
import { buildUrl, parseODataPage, mergeJoinedRows } from '../src/lib/sapClient.js';
import { buildSnapshot } from '../src/lib/processing.js';
import { mockRaw } from '../src/lib/mockData.js';

const SOURCE_KEYS = ['checklist', 'productionOrder', 'maintenanceOrder', 'unposted', 'grir', 'accruals'];
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

  // Optional full override, e.g. a JSON file of the same shape as default-config.json.
  const file = option('SAP_COPILOT_CONFIG', 'config_file');
  if (file) config = deepMerge(config, JSON.parse(await readFile(file, 'utf8')));

  const overrides = { sap: {} };
  const baseUrl = option('SAP_BASE_URL', 'sap_base_url');
  const client = option('SAP_CLIENT', 'sap_client');
  const companyCode = option('SAP_COMPANY_CODE', 'company_code');
  const plant = option('SAP_PLANT', 'plant');
  const grirAccount = option('SAP_GRIR_ACCOUNT', 'grir_account');
  const fiscalYear = option('SAP_FISCAL_YEAR', 'fiscal_year');
  const demo = option('SAP_DEMO_MODE', 'demo_mode');
  if (baseUrl) overrides.sap.baseUrl = baseUrl;
  if (client) overrides.sap.client = client;
  if (companyCode) overrides.sap.companyCode = companyCode;
  if (plant) overrides.sap.plant = plant;
  if (grirAccount) overrides.sap.grirAccount = grirAccount;
  if (fiscalYear) overrides.sap.fiscalYear = fiscalYear;
  if (demo !== null) overrides.demoMode = /^(true|1|yes)$/i.test(demo);
  return deepMerge(config, overrides);
}

// Credentials entered on the local web dashboard's sign-in form. Memory only: gone when the
// process exits, never written to disk.
let sessionCredentials = null;

export function setSessionCredentials(creds) {
  sessionCredentials = creds;
  cache = null;
}

export function hasCredentials() {
  return credentials() !== null;
}

function credentials() {
  if (sessionCredentials) return sessionCredentials;
  const user = option('SAP_USER', 'sap_user');
  const password = option('SAP_PASSWORD', 'sap_password');
  return user && password ? { user, password } : null;
}

async function fetchJson(url, authHeader, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 401) throw authError('SAP rejected the user name or password (401)');
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

async function fetchEntitySet(config, source, vars, authHeader, maxPages = 50) {
  let url = buildUrl(config, source, vars);
  const all = [];
  for (let page = 0; url && page < maxPages; page++) {
    const { rows, next } = parseODataPage(await fetchJson(url, authHeader, config.sap.requestTimeoutMs));
    all.push(...rows);
    url = next ? new URL(next, url) : null;
  }
  return all;
}

/** Fetches a source and merges in its join entity set(s), if configured - see sapClient.js. */
async function fetchSource(config, source, vars, authHeader, maxPages = 50) {
  let rows = await fetchEntitySet(config, source, vars, authHeader, maxPages);
  const joins = source.joins ?? (source.join ? [source.join] : []);
  for (const join of joins) {
    const joinRows = await fetchEntitySet(config, join, vars, authHeader, maxPages);
    rows = mergeJoinedRows(rows, joinRows, join.key);
  }
  return rows;
}

let cache = null;

/** Error meaning "sign in (again)": missing or rejected SAP credentials. */
export function authError(message) {
  return Object.assign(new Error(message), { code: 'SAP_AUTH' });
}

/**
 * Returns the analysed close snapshot for a company code / period, fetched live (or demo data).
 * `overrides` may set companyCode, fiscalYear, period ("8" or "008") or plant (e.g. a per-tab plant
 * selector - see the production order source's $filter, which uses it when set); `refresh` bypasses
 * the cache. `plant: ''` is a deliberate override to "no plant", not "unset".
 */
export async function getSnapshot({ companyCode, fiscalYear, period, plant, refresh = false } = {}) {
  const config = await loadConfig();
  if (companyCode) config.sap.companyCode = companyCode;
  if (fiscalYear) config.sap.fiscalYear = String(fiscalYear);
  if (plant !== undefined) config.sap.plant = plant;
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
      throw authError(
        'SAP credentials are not configured. Set the plugin options sap_user and sap_password ' +
          '(/plugin → close-copilot → configure), or enable demo_mode to try it with sample data.',
      );
    }
    const authHeader = 'Basic ' + Buffer.from(`${creds.user}:${creds.password}`).toString('base64');
    const results = await Promise.allSettled(
      SOURCE_KEYS.map((k) => fetchSource(config, config.sources[k], vars, authHeader)),
    );
    const authFailure = results.find((r) => r.status === 'rejected' && r.reason?.code === 'SAP_AUTH');
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
      plant: vars.plant,
      demoData: !!config.demoMode,
      system: config.demoMode ? null : config.sap.baseUrl,
      syncedAt: snapshot.syncedAt,
    },
    thresholds: config.thresholds,
    demo: !!config.demoMode,
    ...snapshot,
  };
  cache = { key, at: Date.now(), value };
  return value;
}

/**
 * Checks connectivity and credentials with one cheap call to the login-check service.
 * `candidate` tests credentials that are not stored yet (the web sign-in form).
 */
export async function testConnection(candidate) {
  const config = await loadConfig();
  if (config.demoMode) return { ok: true, demoData: true, message: 'Demo mode is on - no SAP connection is used.' };
  const creds = candidate ?? credentials();
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

/**
 * Fetches an OData service's raw $metadata XML using the current session, for verifying real
 * entity/field names against a service's actual definition instead of documentation or guesswork
 * (e.g. before wiring up a new standard API). `service` must be a bare technical service name
 * (letters, digits, underscore) - never a full path, so this can't be used to reach anything other
 * than that service's own $metadata.
 */
export async function fetchServiceMetadata(service) {
  if (!/^[A-Za-z0-9_]+$/.test(service)) throw new Error('Invalid service name');
  const config = await loadConfig();
  if (config.demoMode) throw new Error('Demo mode is on - there is no SAP connection to fetch metadata from.');
  const creds = credentials();
  if (!creds) throw authError('Not signed in to SAP.');
  const authHeader = 'Basic ' + Buffer.from(`${creds.user}:${creds.password}`).toString('base64');
  const url = new URL(`/sap/opu/odata/sap/${service}/$metadata`, config.sap.proxyUrl || config.sap.baseUrl);
  url.searchParams.set('sap-client', config.sap.client);
  const res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/xml' } });
  const text = await res.text();
  if (res.status === 401) throw authError('SAP rejected the user name or password (401).');
  if (!res.ok) throw new Error(`SAP returned ${res.status} for ${service}: ${text.slice(0, 300)}`);
  return text;
}

/**
 * Fetches a few real rows from an OData entity set using the current session, for verifying real
 * data (not just schema) - e.g. whether fields the metadata promises are actually populated and
 * recent, before wiring up a new standard API. `service`/`entitySet` must be bare technical names.
 */
export async function fetchServiceSample(service, entitySet, { top = 5, filter, orderby } = {}) {
  if (!/^[A-Za-z0-9_]+$/.test(service)) throw new Error('Invalid service name');
  if (!/^[A-Za-z0-9_]+$/.test(entitySet)) throw new Error('Invalid entity set name');
  const config = await loadConfig();
  if (config.demoMode) throw new Error('Demo mode is on - there is no SAP connection to fetch data from.');
  const creds = credentials();
  if (!creds) throw authError('Not signed in to SAP.');
  const authHeader = 'Basic ' + Buffer.from(`${creds.user}:${creds.password}`).toString('base64');
  const url = new URL(`/sap/opu/odata/sap/${service}/${entitySet}`, config.sap.proxyUrl || config.sap.baseUrl);
  url.searchParams.set('sap-client', config.sap.client);
  url.searchParams.set('$format', 'json');
  url.searchParams.set('$top', String(Math.min(Number(top) || 5, 20)));
  if (filter) url.searchParams.set('$filter', filter);
  if (orderby) url.searchParams.set('$orderby', orderby);
  const res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } });
  const text = await res.text();
  if (res.status === 401) throw authError('SAP rejected the user name or password (401).');
  if (!res.ok) throw new Error(`SAP returned ${res.status} for ${service}/${entitySet}: ${text.slice(0, 300)}`);
  return text;
}

/**
 * Searches SAP Gateway's own service catalog for registered services whose technical name or
 * description contains `keyword`, using the current session. Lets a plausible standard API be
 * found by what's actually registered in this system, instead of guessing technical service names
 * one at a time and checking each for a 404 (see abap/README.md's GR/IR section for how many
 * guesses that took last time).
 */
export async function searchServiceCatalog(keyword) {
  if (!/^[A-Za-z0-9_ -]+$/.test(keyword)) throw new Error('Invalid keyword');
  const config = await loadConfig();
  if (config.demoMode) throw new Error('Demo mode is on - there is no SAP connection to search.');
  const creds = credentials();
  if (!creds) throw authError('Not signed in to SAP.');
  const authHeader = 'Basic ' + Buffer.from(`${creds.user}:${creds.password}`).toString('base64');
  const url = new URL('/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection', config.sap.proxyUrl || config.sap.baseUrl);
  url.searchParams.set('sap-client', config.sap.client);
  url.searchParams.set('$format', 'json');
  url.searchParams.set('$filter', `substringof('${keyword.replace(/'/g, "''")}',ID)`);
  url.searchParams.set('$top', '50');
  const res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } });
  const text = await res.text();
  if (res.status === 401) throw authError('SAP rejected the user name or password (401).');
  if (!res.ok) throw new Error(`SAP returned ${res.status} searching the catalog: ${text.slice(0, 300)}`);
  return text;
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

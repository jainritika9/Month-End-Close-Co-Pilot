// Browser-side close snapshot for the SAP BTP build. Same rules as getSnapshot() in
// mcp/closeData.mjs (the localhost dashboard's server), without the server: the page reads the
// OData services itself, through the BTP approuter. The approuter is same-origin and forwards the
// user's sign-in to SAP, so no credentials are handled here.

import { deepMerge, periodVars } from '../src/lib/config.js';
import { buildUrl, parseODataPage, mergeJoinedRows } from '../src/lib/sapClient.js';
import { buildSnapshot } from '../src/lib/processing.js';
import { mockRaw } from '../src/lib/mockData.js';

// Same keys as SOURCE_KEYS in mcp/closeData.mjs.
export const SOURCE_KEYS = ['checklist', 'productionOrder', 'maintenanceOrder', 'unposted', 'grir', 'accruals'];

/** The approuter session has ended (401). The page asks the user to reload and sign in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your sign-in has expired. Reload the page to sign in again.');
    this.name = 'SessionExpiredError';
    this.code = 'SESSION_EXPIRED';
  }
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
    if (res.status === 401) throw new SessionExpiredError();
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
    // A browser fetch fails with a TypeError when the request can't complete. An expired approuter
    // session also looks like this, because its redirect to the sign-in page is cross-origin.
    if (e instanceof TypeError) throw new Error('Could not reach SAP. If this continues, reload the page to sign in again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SAP builds __next / nextLink from its own host name, which the browser can't reach (only the
 * approuter's origin is reachable). Keep just the path and query, and resolve them against the
 * current URL so the next page is requested through the approuter.
 */
function samePageUrl(next, current) {
  const n = new URL(next, current);
  return new URL(n.pathname + n.search, current);
}

async function fetchEntitySet(fetchImpl, config, source, vars, maxPages = 50) {
  let url = buildUrl(config, source, vars);
  const all = [];
  for (let page = 0; url && page < maxPages; page++) {
    const { rows, next } = parseODataPage(await fetchJson(fetchImpl, url, config.sap.requestTimeoutMs));
    all.push(...rows);
    url = next ? samePageUrl(next, url) : null;
  }
  return all;
}

/** Fetches a source and merges in its join entity set(s), as sapClient.fetchSource does. */
async function fetchSource(fetchImpl, config, source, vars) {
  let rows = await fetchEntitySet(fetchImpl, config, source, vars);
  const joins = source.joins ?? (source.join ? [source.join] : []);
  for (const join of joins) {
    const joinRows = await fetchEntitySet(fetchImpl, config, join, vars);
    rows = mergeJoinedRows(rows, joinRows, join.key);
  }
  return rows;
}

/**
 * Returns the analysed close snapshot for a company code / period: read live from SAP through the
 * approuter at `origin`, or demo data when config.demoMode is on. `baseConfig` is the bundled
 * default config. Each source is fetched on its own, so one failing section shows up as its own
 * error instead of failing the whole page (same as the server version).
 */
export async function getBrowserSnapshot(baseConfig, {
  origin, companyCode, fiscalYear, period, plant, today = new Date(), fetchImpl = fetch,
} = {}) {
  const overrides = { sap: { proxyUrl: origin } };
  if (companyCode) overrides.sap.companyCode = companyCode;
  if (fiscalYear) overrides.sap.fiscalYear = String(fiscalYear);
  if (plant !== undefined) overrides.sap.plant = plant;
  const config = deepMerge(baseConfig, overrides);

  const vars = periodVars(config, today);
  if (period) vars.period = String(period).padStart(3, '0');

  let raw;
  if (config.demoMode) {
    raw = mockRaw(config, today);
  } else {
    const results = await Promise.allSettled(
      SOURCE_KEYS.map((k) => fetchSource(fetchImpl, config, config.sources[k], vars)),
    );
    const sessionFailure = results.find((r) => r.status === 'rejected' && r.reason instanceof SessionExpiredError);
    if (sessionFailure) throw sessionFailure.reason;
    raw = Object.fromEntries(
      SOURCE_KEYS.map((k, i) => [k, results[i].status === 'fulfilled' ? results[i].value : results[i].reason]),
    );
  }

  const snapshot = buildSnapshot(raw, config, today);
  return {
    context: {
      companyCode: vars.companyCode,
      fiscalYear: vars.fiscalYear,
      period: vars.period,
      plant: vars.plant,
      demoData: !!config.demoMode,
      // The SAP host name stays in the BTP destination, not in the page.
      system: null,
      syncedAt: snapshot.syncedAt,
    },
    thresholds: config.thresholds,
    demo: !!config.demoMode,
    ...snapshot,
  };
}

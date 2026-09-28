// Thin OData (v2 and v4) client. Extension pages with host permission for the SAP origin are
// exempt from CORS, so a proxy is only needed if your network setup requires one.

import { getAuthHeader, logout, AuthError } from './auth.js';

export class SapError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SapError';
    this.status = status;
  }
}

/** Replaces {name} placeholders; values are escaped for OData string literals. */
export function fillPlaceholders(value, vars) {
  return value.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]).replaceAll("'", "''") : m));
}

/**
 * A query value can be a plain string, or `{ when, then, else }` to pick between two query
 * strings based on whether `vars[when]` is set - e.g. filtering by Plant when the user has set
 * one in Settings, falling back to CompanyCode otherwise (see config.sources.productionOrder).
 */
function resolveQueryValue(value, vars) {
  if (value && typeof value === 'object') return vars[value.when] ? value.then : value.else;
  return value;
}

export function buildUrl(config, source, vars) {
  const url = new URL(source.path, config.sap.proxyUrl || config.sap.baseUrl);
  url.searchParams.set('sap-client', config.sap.client);
  url.searchParams.set('$format', 'json');
  for (const [k, v] of Object.entries(source.query ?? {})) {
    const resolved = resolveQueryValue(v, vars);
    if (resolved !== undefined) url.searchParams.set(k, fillPlaceholders(resolved, vars));
  }
  return url;
}

async function fetchJson(url, authHeader, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      credentials: 'omit',
      signal: ctrl.signal,
    });
    if (res.status === 401) {
      await logout();
      throw new AuthError('SAP session is no longer valid, please sign in again');
    }
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error?.message?.value ?? body?.error?.message ?? '';
      } catch {
        // Non-JSON error body; status code is enough.
      }
      throw new SapError(`SAP returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new SapError(`Request timed out after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts rows and the next-page link from an OData v2 or v4 payload. */
export function parseODataPage(body) {
  if (body?.d) {
    const rows = Array.isArray(body.d) ? body.d : body.d.results ?? [];
    return { rows, next: body.d.__next ?? null };
  }
  return { rows: body?.value ?? [], next: body?.['@odata.nextLink'] ?? null };
}

/**
 * Left-joins `joinRows` onto `mainRows` by a shared key (client-side, since not every standard SAP
 * API that a source needs data from exposes it pre-joined - e.g. API_INSPECTIONLOT_SRV splits lot
 * header (A_InspectionLot) and Usage Decision (A_InspLotUsageDecision) into two separate,
 * independently-fetched entity sets). `key` is a field name, or an array of field names for a
 * composite key (e.g. the manual-accruals source, correlated by AccrualObject + AccrualSubobject
 * across 4 entities - a single field isn't unique enough on its own). A main row with no match
 * (e.g. a lot with no Usage Decision yet) is kept as-is - its joined fields are simply absent,
 * which `normalize()` already treats as blank. On a name collision, the main row wins. If more than
 * one join row shares a key, only the last one read is kept - a known simplification.
 */
export function mergeJoinedRows(mainRows, joinRows, key) {
  const keyOf = Array.isArray(key) ? (r) => key.map((k) => r[k]).join('\u0000') : (r) => r[key];
  const byKey = new Map(joinRows.map((r) => [keyOf(r), r]));
  return mainRows.map((row) => ({ ...byKey.get(keyOf(row)), ...row }));
}

/** Fetches every page of one entity set (a source or one of its joins). */
async function fetchEntitySet(config, source, vars, authHeader, maxPages) {
  let url = buildUrl(config, source, vars);
  const all = [];
  for (let page = 0; url && page < maxPages; page++) {
    const { rows, next } = parseODataPage(await fetchJson(url, authHeader, config.sap.requestTimeoutMs));
    all.push(...rows);
    url = next ? new URL(next, url) : null;
  }
  return all;
}

/**
 * Fetches every page of one configured source, and merges in its join entity sets (if any) - see
 * `mergeJoinedRows`. `source.joins` is an array for more than one (e.g. the manual-accruals
 * source, where description/amount/cost-center/period-amount each live in a separate entity);
 * `source.join` (singular) is still supported for the common one-join case.
 */
export async function fetchSource(config, source, vars, maxPages = 50) {
  const authHeader = await getAuthHeader(config);
  let rows = await fetchEntitySet(config, source, vars, authHeader, maxPages);
  const joins = source.joins ?? (source.join ? [source.join] : []);
  for (const join of joins) {
    const joinRows = await fetchEntitySet(config, join, vars, authHeader, maxPages);
    rows = mergeJoinedRows(rows, joinRows, join.key);
  }
  return rows;
}

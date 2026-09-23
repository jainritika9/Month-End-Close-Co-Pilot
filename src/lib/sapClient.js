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

export function buildUrl(config, source, vars) {
  const url = new URL(source.path, config.sap.proxyUrl || config.sap.baseUrl);
  url.searchParams.set('sap-client', config.sap.client);
  url.searchParams.set('$format', 'json');
  for (const [k, v] of Object.entries(source.query ?? {})) url.searchParams.set(k, fillPlaceholders(v, vars));
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

/** Fetches every page of one configured source. */
export async function fetchSource(config, source, vars, maxPages = 50) {
  const authHeader = await getAuthHeader(config);
  let url = buildUrl(config, source, vars);
  const all = [];
  for (let page = 0; url && page < maxPages; page++) {
    const { rows, next } = parseODataPage(await fetchJson(url, authHeader, config.sap.requestTimeoutMs));
    all.push(...rows);
    url = next ? new URL(next, url) : null;
  }
  return all;
}

// OData (v2 and v4) URL building, page parsing and joins. Pure functions: the callers fetch the
// pages (the MCP server, the localhost dashboard and the BTP app each have their own fetch and auth).

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

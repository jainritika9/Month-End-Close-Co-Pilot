// Config helpers shared by the MCP server, the localhost dashboard and the BTP app. Settings come from
// config/default-config.json (or an override file); no credentials are stored here.

export function deepMerge(base, override) {
  if (override === undefined || override === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base) || Array.isArray(override)) return override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v);
  return out;
}

/**
 * Placeholder values available in source queries ({fiscalYear}, {period}, {companyCode}).
 * Assumes a calendar fiscal year; set sap.fiscalYearStartMonth in the config if yours differs.
 */
export function periodVars(config, date = new Date()) {
  const startMonth = config.sap.fiscalYearStartMonth ?? 1; // 1 = January
  const month = date.getMonth() + 1;
  const period = ((month - startMonth + 12) % 12) + 1;
  const derivedYear = startMonth === 1 || month < startMonth ? date.getFullYear() : date.getFullYear() + 1;
  // A fixed sap.fiscalYear (e.g. "2026") overrides the date-derived year; empty means derive it.
  const fiscalYear = config.sap.fiscalYear ? config.sap.fiscalYear : derivedYear;
  return {
    fiscalYear: String(fiscalYear),
    period: String(period).padStart(3, '0'),
    companyCode: config.sap.companyCode,
    // Some sources (e.g. the EAM/QM-based checklist) have no company code and scope by plant
    // instead - see config.sap.plant.
    plant: config.sap.plant ?? '',
    // The GR/IR clearing G/L account (see config.sap.grirAccount) - a standard line-item API has
    // no "is this a GR/IR posting" flag, only the account it's posted to.
    grirAccount: config.sap.grirAccount ?? '',
    // An OData V2 datetime literal value (no quotes/prefix) for "365 days ago" - lets a source
    // filter to a recent rolling window before sorting a large table, e.g. the maintenance order
    // source's $orderby, which times out without this (sorting the full unfiltered history is much
    // more expensive than sorting a year's worth - see abap/README.md).
    recentCutoff: new Date(date.getTime() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 19),
  };
}

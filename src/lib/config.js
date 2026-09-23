// Loads the bundled default config and merges user overrides from chrome.storage.local.
// Only non-secret settings live here; tokens/credentials live in auth.js (session storage).

const STORAGE_KEY = 'copilotConfig';

let defaultsPromise;

export function loadDefaults() {
  defaultsPromise ??= fetch(chrome.runtime.getURL('config/default-config.json')).then((r) => r.json());
  return defaultsPromise;
}

export function deepMerge(base, override) {
  if (override === undefined || override === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base) || Array.isArray(override)) return override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v);
  return out;
}

export async function getConfig() {
  const defaults = await loadDefaults();
  const { [STORAGE_KEY]: overrides } = await chrome.storage.local.get(STORAGE_KEY);
  return deepMerge(defaults, overrides ?? {});
}

/** Removes anything secret-looking so it can never be persisted. */
export function stripSecrets(config) {
  const clean = JSON.parse(JSON.stringify(config));
  delete clean._comment;
  if (clean.auth?.oauth2) delete clean.auth.oauth2.clientSecret;
  if (clean.auth?.basic) {
    delete clean.auth.basic.user;
    delete clean.auth.basic.password;
  }
  return clean;
}

export async function saveConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEY]: stripSecrets(config) });
}

export async function resetConfig() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * Host-permission patterns the extension needs for the configured SAP endpoints. Ports are left
 * out: match patterns cannot carry them, and a portless pattern covers every port (8000, 44300…).
 */
export function requiredOrigins(config) {
  const urls = [config.sap.baseUrl, config.sap.proxyUrl];
  if (config.auth.method === 'oauth2') urls.push(config.auth.oauth2.tokenUrl);
  return [
    ...new Set(
      urls.filter(Boolean).map((u) => {
        const { protocol, hostname } = new URL(u);
        return `${protocol}//${hostname}/*`;
      }),
    ),
  ];
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
  };
}

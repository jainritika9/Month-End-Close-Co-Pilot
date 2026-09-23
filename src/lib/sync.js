// Orchestrates a data sync: fetch every source (or demo data), build the snapshot, store it.
// Snapshots contain financial data, so they go to chrome.storage.session (memory only) as well.

import { getConfig, periodVars } from './config.js';
import { fetchSource } from './sapClient.js';
import { AuthError } from './auth.js';
import { buildSnapshot, buildAlerts } from './processing.js';
import { mockRaw } from './mockData.js';

const SNAPSHOT_KEY = 'closeSnapshot';
export const SOURCE_KEYS = ['checklist', 'unposted', 'grir', 'accruals'];

export async function getSnapshot() {
  const { [SNAPSHOT_KEY]: snap } = await chrome.storage.session.get(SNAPSHOT_KEY);
  return snap ?? null;
}

export async function clearSnapshot() {
  await chrome.storage.session.remove(SNAPSHOT_KEY);
}

/** Runs a sync. `only` limits it to some sources (the rest are kept from the previous snapshot). */
export async function runSync({ only } = {}) {
  const config = await getConfig();
  const keys = only?.length ? only : SOURCE_KEYS;
  const today = new Date();
  let raw;

  if (config.demoMode) {
    const demo = mockRaw(config, today);
    raw = Object.fromEntries(keys.map((k) => [k, demo[k]]));
  } else {
    const vars = periodVars(config, today);
    const results = await Promise.allSettled(keys.map((k) => fetchSource(config, config.sources[k], vars)));
    // If auth failed, surface that rather than four identical per-source errors.
    const authFailure = results.find((r) => r.status === 'rejected' && r.reason instanceof AuthError);
    if (authFailure) throw authFailure.reason;
    raw = Object.fromEntries(
      keys.map((k, i) => [k, results[i].status === 'fulfilled' ? results[i].value : results[i].reason]),
    );
  }

  if (only?.length) {
    // Partial refresh: rebuild from the fresh sources and keep the others' previous results.
    const previous = await getSnapshot();
    const fresh = buildSnapshot(raw, config, today);
    const summary = { ...(previous?.summary ?? {}), ...fresh.summary };
    const errors = { ...(previous?.errors ?? {}) };
    for (const k of keys) {
      delete errors[k];
      if (fresh.errors[k]) {
        errors[k] = fresh.errors[k];
        delete summary[k];
      }
    }
    const merged = { syncedAt: fresh.syncedAt, summary, errors, alerts: buildAlerts(summary, config.thresholds) };
    return store(merged, config);
  }

  return store(buildSnapshot(raw, config, today), config);
}

async function store(snapshot, config) {
  // JSON round-trip turns Dates into ISO strings (chrome.storage cannot hold Date objects).
  const plain = JSON.parse(JSON.stringify({ ...snapshot, demo: !!config.demoMode }));
  await chrome.storage.session.set({ [SNAPSHOT_KEY]: plain });
  return plain;
}

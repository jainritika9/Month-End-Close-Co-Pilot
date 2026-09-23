// Background service worker: opens the dashboard, runs scheduled syncs, keeps the toolbar badge
// in sync with open alerts and raises desktop notifications for new high-severity exceptions.

import { getConfig } from './lib/config.js';
import { getSessionInfo, AuthError } from './lib/auth.js';
import { runSync } from './lib/sync.js';

const ALARM = 'close-copilot-sync';
const DASHBOARD = chrome.runtime.getURL('src/dashboard/dashboard.html');
const NOTIFIED_KEY = 'notifiedAlerts';

async function openDashboard() {
  const [existing] = await chrome.tabs.query({ url: DASHBOARD });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: DASHBOARD });
  }
}

async function scheduleAlarm() {
  const config = await getConfig();
  await chrome.alarms.clear(ALARM);
  const minutes = Number(config.sync.autoSyncMinutes);
  if (minutes > 0) await chrome.alarms.create(ALARM, { periodInMinutes: Math.max(minutes, 15), delayInMinutes: 1 });
}

function updateBadge(snapshot) {
  const alerts = snapshot?.alerts ?? [];
  const high = alerts.filter((a) => a.severity === 'high').length;
  chrome.action.setBadgeText({ text: alerts.length ? String(alerts.length) : '' });
  chrome.action.setBadgeBackgroundColor({ color: high ? '#c62828' : '#ef8f00' });
}

async function notifyNewAlerts(snapshot) {
  const config = await getConfig();
  if (!config.sync.notifications) return;
  const { [NOTIFIED_KEY]: seen = [] } = await chrome.storage.session.get(NOTIFIED_KEY);
  const high = (snapshot.alerts ?? []).filter((a) => a.severity === 'high');
  const fresh = high.filter((a) => !seen.includes(a.title));
  if (fresh.length) {
    chrome.notifications.create(`close-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Month-end close needs attention',
      message: fresh.map((a) => a.title).join('\n'),
      priority: 2,
    });
  }
  await chrome.storage.session.set({ [NOTIFIED_KEY]: high.map((a) => a.title) });
}

async function backgroundSync() {
  const config = await getConfig();
  const session = await getSessionInfo();
  // Without a session there is nothing we can fetch; never prompt for credentials from the background.
  if (!config.demoMode && !session.signedIn) return;
  try {
    await runSync();
  } catch (e) {
    if (e instanceof AuthError && config.sync.notifications) {
      chrome.notifications.create('close-auth', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Close Co-Pilot: sign-in required',
        message: 'Your SAP session expired. Open the dashboard to sign in again.',
      });
    } else {
      console.warn('Background sync failed', e);
    }
  }
}

chrome.action.onClicked.addListener(openDashboard);
chrome.notifications.onClicked.addListener(openDashboard);
chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) backgroundSync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.closeSnapshot) {
    const snap = changes.closeSnapshot.newValue;
    updateBadge(snap);
    if (snap) notifyNewAlerts(snap);
  }
  if (area === 'local' && changes.copilotConfig) scheduleAlarm();
});

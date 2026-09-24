import { getConfig, periodVars, requiredOrigins } from '../lib/config.js';
import { getSessionInfo, loginBasic, loginOAuth, logout, AuthError } from '../lib/auth.js';
import { runSync, getSnapshot, clearSnapshot } from '../lib/sync.js';
import { setSnapshot, closeDrawer } from './render.js';

const $ = (id) => document.getElementById(id);

let config;

// ---------- Session / sync flow ----------

function showBanner(message) {
  $('banner').hidden = !message;
  $('banner').textContent = message ?? '';
}

async function ensureHostPermission() {
  const origins = requiredOrigins(config);
  if (await chrome.permissions.contains({ origins })) return true;
  // Must be called from a user gesture (button click).
  try {
    return await chrome.permissions.request({ origins });
  } catch (e) {
    throw new Error(`Cannot request access to ${origins.join(', ')}: ${e.message}. Check the URLs in Settings.`);
  }
}

async function refreshSession() {
  const session = await getSessionInfo();
  const needsLogin = !config.demoMode && !session.signedIn;
  $('login').hidden = !needsLogin;
  $('signOut').hidden = config.demoMode || !session.signedIn;
  $('refreshAll').hidden = needsLogin;
  $('sessionInfo').textContent = session.signedIn ? `Signed in${session.user ? ` as ${session.user}` : ''}` : '';
  if (needsLogin) {
    $('content').hidden = true;
    $('loginTarget').textContent = `${config.sap.baseUrl} · client ${config.sap.client}`;
    $('loginOAuth').hidden = config.auth.method !== 'oauth2';
    $('loginBasic').hidden = config.auth.method !== 'basic';
  }
  return { session, needsLogin };
}

async function sync(only) {
  const buttons = [...document.querySelectorAll('[data-refresh], #refreshAll')];
  buttons.forEach((b) => (b.disabled = true));
  showBanner(null);
  try {
    if (!config.demoMode && !(await ensureHostPermission())) {
      showBanner('Access to the SAP host was not granted, so data cannot be loaded. Click Refresh to try again.');
      return;
    }
    setSnapshot(await runSync({ only }));
  } catch (e) {
    if (e instanceof AuthError) {
      await refreshSession();
      $('loginError').hidden = false;
      $('loginError').textContent = e.message;
    } else {
      showBanner(`Sync failed: ${e.message}`);
    }
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function handleLogin(fn) {
  $('loginError').hidden = true;
  try {
    // Request host access first; it needs the click's user gesture.
    if (!(await ensureHostPermission())) throw new Error('Access to the SAP host is required to sign in.');
    await fn();
    await refreshSession();
    await sync();
  } catch (e) {
    $('loginError').hidden = false;
    $('loginError').textContent = e.message;
  }
}

async function init() {
  config = await getConfig();
  const vars = periodVars(config);
  $('period').textContent = `Company code ${vars.companyCode} · Period ${vars.period}/${vars.fiscalYear}`;

  const { needsLogin } = await refreshSession();
  if (needsLogin) return;

  const stored = await getSnapshot();
  if (stored && stored.demo === !!config.demoMode) setSnapshot(stored);
  else if (config.demoMode) await sync(); // Demo needs no user gesture or permission.
  else showBanner('Click "Refresh all" to load today\'s close status from SAP.');
}

// ---------- Wiring ----------

$('refreshAll').addEventListener('click', () => sync());
document.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', () => sync([b.dataset.refresh])));
$('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('signOut').addEventListener('click', async () => {
  await logout();
  await clearSnapshot();
  setSnapshot(null);
  await refreshSession();
});
$('oauthBtn').addEventListener('click', () => handleLogin(() => loginOAuth(config)));
$('loginBasic').addEventListener('submit', (e) => {
  e.preventDefault();
  const user = $('basicUser').value.trim();
  const password = $('basicPassword').value;
  $('basicPassword').value = '';
  handleLogin(() => loginBasic(config, user, password));
});
$('drawerClose').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

// Pick up syncs done by the background worker, and config changes from the options page.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'session' && changes.closeSnapshot?.newValue) {
    setSnapshot(changes.closeSnapshot.newValue);
  }
  if (area === 'local' && changes.copilotConfig) {
    await clearSnapshot();
    setSnapshot(null);
    $('content').hidden = true;
    init();
  }
});

init();

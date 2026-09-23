// Authentication against SAP. Credentials are never persisted: tokens / auth headers are kept in
// chrome.storage.session, which is in-memory only, cleared when the browser closes, and not
// readable by content scripts.

const SESSION_KEY = 'sapSession';

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

async function readSession() {
  const { [SESSION_KEY]: s } = await chrome.storage.session.get(SESSION_KEY);
  return s ?? null;
}

async function writeSession(session) {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
}

export async function logout() {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function getSessionInfo() {
  const s = await readSession();
  if (!s) return { signedIn: false };
  return { signedIn: true, method: s.method, user: s.user ?? null, expiresAt: s.expiresAt ?? null };
}

// ---------- OAuth 2.0 authorization code + PKCE ----------

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(len = 64) {
  return base64Url(crypto.getRandomValues(new Uint8Array(len))).slice(0, len);
}

async function pkcePair() {
  const verifier = randomString(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(digest) };
}

async function tokenRequest(tokenUrl, params) {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
    credentials: 'omit',
  });
  if (!res.ok) throw new AuthError(`Token endpoint returned ${res.status}`);
  const t = await res.json();
  return {
    method: 'oauth2',
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    // Treat the token as expired a minute early to avoid racing the server.
    expiresAt: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000,
  };
}

export async function loginOAuth(config) {
  const o = config.auth.oauth2;
  const redirectUri = chrome.identity.getRedirectURL('sap');
  const { verifier, challenge } = await pkcePair();
  const state = randomString(24);

  const url = new URL(o.authorizeUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: o.clientId,
    redirect_uri: redirectUri,
    scope: o.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    'sap-client': config.sap.client,
  });

  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  if (!responseUrl) throw new AuthError('Sign-in was cancelled');
  const params = new URL(responseUrl).searchParams;
  if (params.get('error')) throw new AuthError(params.get('error_description') || params.get('error'));
  if (params.get('state') !== state) throw new AuthError('OAuth state mismatch');

  const session = await tokenRequest(o.tokenUrl, {
    grant_type: 'authorization_code',
    code: params.get('code'),
    redirect_uri: redirectUri,
    client_id: o.clientId,
    code_verifier: verifier,
  });
  await writeSession(session);
}

// ---------- Basic auth (on-premise Gateway) ----------

export async function loginBasic(config, user, password) {
  const header = 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)));
  const url = new URL(config.auth.basic.pingPath, config.sap.proxyUrl || config.sap.baseUrl);
  url.searchParams.set('sap-client', config.sap.client);
  const res = await fetch(url, { headers: { Authorization: header }, credentials: 'omit' });
  if (res.status === 401 || res.status === 403) throw new AuthError('SAP rejected the user name or password');
  if (!res.ok) throw new AuthError(`SAP login check failed (${res.status})`);
  // Cap at 8 hours; closing the browser clears it sooner.
  await writeSession({ method: 'basic', header, user, expiresAt: Date.now() + 8 * 3600 * 1000 });
}

// ---------- Used by the SAP client ----------

/** Returns the Authorization header value, refreshing OAuth tokens when needed. */
export async function getAuthHeader(config) {
  const s = await readSession();
  if (!s) throw new AuthError('Not signed in to SAP');

  if (s.expiresAt && Date.now() >= s.expiresAt) {
    if (s.method === 'oauth2' && s.refreshToken) {
      try {
        const refreshed = await tokenRequest(config.auth.oauth2.tokenUrl, {
          grant_type: 'refresh_token',
          refresh_token: s.refreshToken,
          client_id: config.auth.oauth2.clientId,
        });
        refreshed.refreshToken ??= s.refreshToken;
        await writeSession(refreshed);
        return `Bearer ${refreshed.accessToken}`;
      } catch {
        // Fall through to sign-out below.
      }
    }
    await logout();
    throw new AuthError('SAP session expired, please sign in again');
  }

  return s.method === 'oauth2' ? `Bearer ${s.accessToken}` : s.header;
}

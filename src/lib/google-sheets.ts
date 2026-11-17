/**
 * Minimal Google Sheets client built on fetch + Web Crypto.
 *
 * Replaces the `googleapis` package, which depends on Node-only APIs and is
 * far too large for Cloudflare Workers. It only implements what this site
 * needs: read-only `spreadsheets.values.get`, authenticated as a service
 * account via the OAuth2 JWT-bearer flow.
 *
 * Env vars are read lazily (inside functions, never at import time) because
 * on Workers secrets are only guaranteed to exist once a request is running.
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";

type CachedToken = { token: string; expiresAt: number };

// Per-isolate cache so a warm Worker doesn't re-sign a JWT for every range.
let cachedToken: CachedToken | null = null;
let cachedKey: { pem: string; key: CryptoKey } | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizePrivateKey(raw: string): string {
  // Handles keys pasted with literal "\n" sequences and keys wrapped in quotes.
  return raw.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.pem === pem) return cachedKey.key;

  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  cachedKey = { pem, key };
  return key;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Reuse the token until 60s before it expires.
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.token;
  }

  const clientEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = normalizePrivateKey(requireEnv("GOOGLE_PRIVATE_KEY"));

  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  const assertion = `${signingInput}.${base64UrlEncode(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Google token request failed (${response.status}): ${await response.text()}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in,
  };

  return data.access_token;
}

async function fetchValues(
  range: string,
  valueRenderOption?: "FORMULA"
): Promise<string[][]> {
  const spreadsheetId = requireEnv("GOOGLE_SHEET_ID");
  const token = await getAccessToken();

  const url = new URL(
    `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  );
  if (valueRenderOption) {
    url.searchParams.set("valueRenderOption", valueRenderOption);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(
      `Sheets API request failed for "${range}" (${response.status}): ${await response.text()}`
    );
  }

  const data = (await response.json()) as { values?: string[][] };
  return data.values ?? [];
}

export async function getSheetData(range: string) {
  return fetchValues(range);
}

/**
 * Fetches a range using the FORMULA render option instead of the default
 * FORMATTED_VALUE. For plain text/number cells this returns the same raw
 * value as normal. For cells containing an `=IMAGE("url")` formula, this
 * is the ONLY render option that exposes the underlying URL.
 *
 * Note: this does NOT work for images inserted via Google Sheets'
 * "Insert image in cell" feature. If a column is meant to hold a photo, the
 * cell must contain either a plain image URL or an `=IMAGE("url")` formula.
 */
export async function getSheetDataAsFormulas(range: string) {
  return fetchValues(range, "FORMULA");
}

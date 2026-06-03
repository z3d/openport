import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityLogIcon,
  ArchiveIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  CounterClockwiseClockIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  EyeClosedIcon,
  EyeOpenIcon,
  FileTextIcon,
  GearIcon,
  GlobeIcon,
  LockClosedIcon,
  LockOpen1Icon,
  PaperPlaneIcon,
  Pencil1Icon,
  PlusIcon,
  RowsIcon,
  UploadIcon,
  TableIcon,
  TrashIcon
} from "@radix-ui/react-icons";

type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

type KeyValueRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
};

type OAuth2GrantType =
  | "client_credentials"
  | "password"
  | "authorization_code"
  | "authorization_code_pkce";

type OAuth2Token = {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: number;
  obtainedAt: number;
};

type OAuth2Auth = {
  type: "oauth2";
  grantType: OAuth2GrantType;
  authUrl: string;
  accessTokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  username: string;
  password: string;
  redirectUri: string;
  clientAuth: "body" | "basic";
  headerPrefix: string;
  token?: OAuth2Token;
};

type RequestAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; key: string; value: string; in: "header" | "query" }
  | OAuth2Auth;

type RequestDraft = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  body: string;
  auth?: RequestAuth;
  environmentId?: string;
};

type Environment = {
  id: string;
  name: string;
  variables: KeyValueRow[];
};

type Collection = {
  id: string;
  name: string;
  requests: RequestDraft[];
};

type HistoryItem = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  status?: number;
  durationMs?: number;
  createdAt: string;
};

type PersistedState = {
  collections: Collection[];
  history: HistoryItem[];
  environments: Environment[];
  activeEnvironmentId: string;
};

type ResponseState = OpenPortResponse | null;

const STORAGE_KEY = "openport:state:v1";
const REQUEST_TABS = ["Params", "Headers", "Auth", "Body", "Env"] as const;
const RESPONSE_TABS = ["Body", "Headers"] as const;
const METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS"
];

function uid(prefix = "id") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

function row(key = "", value = "", enabled = true): KeyValueRow {
  return {
    id: uid("row"),
    key,
    value,
    enabled
  };
}

function requestDraft(overrides: Partial<RequestDraft> = {}): RequestDraft {
  return {
    id: uid("req"),
    name: "Untitled request",
    method: "GET",
    url: "{{baseUrl}}/anything",
    params: [row()],
    headers: [row("Accept", "application/json")],
    body: "{\n  \"ok\": true\n}",
    auth: { type: "none" },
    ...overrides
  };
}

const DEFAULT_ENV_ID = "env-default";

const defaultState: PersistedState = {
  environments: [
    {
      id: DEFAULT_ENV_ID,
      name: "Default",
      variables: [
        row("baseUrl", "https://httpbin.org"),
        row("token", "", false)
      ]
    }
  ],
  activeEnvironmentId: DEFAULT_ENV_ID,
  collections: [
    {
      id: uid("col"),
      name: "Scratchpad",
      requests: [
        requestDraft({
          name: "Echo anything",
          method: "POST",
          url: "{{baseUrl}}/anything",
          headers: [
            row("Accept", "application/json"),
            row("Content-Type", "application/json")
          ],
          body: "{\n  \"project\": \"OpenPort\",\n  \"localFirst\": true\n}"
        }),
        requestDraft({
          name: "Read headers",
          method: "GET",
          url: "{{baseUrl}}/headers",
          headers: [row("Accept", "application/json")],
          body: ""
        })
      ]
    }
  ],
  history: []
};

function migrateEnvironments(parsed: {
  environments?: Environment[];
  environment?: KeyValueRow[];
  activeEnvironmentId?: string;
}): { environments: Environment[]; activeEnvironmentId: string } {
  if (Array.isArray(parsed.environments) && parsed.environments.length) {
    const environments = parsed.environments;
    const activeEnvironmentId =
      environments.find((item) => item.id === parsed.activeEnvironmentId)?.id ??
      environments[0].id;
    return { environments, activeEnvironmentId };
  }

  if (Array.isArray(parsed.environment) && parsed.environment.length) {
    const environment: Environment = {
      id: DEFAULT_ENV_ID,
      name: "Default",
      variables: parsed.environment
    };
    return {
      environments: [environment],
      activeEnvironmentId: environment.id
    };
  }

  return {
    environments: defaultState.environments,
    activeEnvironmentId: defaultState.activeEnvironmentId
  };
}

function loadState(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return defaultState;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedState & {
      environment?: KeyValueRow[];
    };
    return {
      collections: parsed.collections?.length
        ? parsed.collections
        : defaultState.collections,
      history: parsed.history ?? [],
      ...migrateEnvironments(parsed)
    };
  } catch {
    return defaultState;
  }
}

function cloneRequest(request: RequestDraft): RequestDraft {
  return {
    ...request,
    params: request.params.map((item) => ({ ...item, id: uid("row") })),
    headers: request.headers.map((item) => ({ ...item, id: uid("row") }))
  };
}

function compactRows(rows: KeyValueRow[]) {
  const filtered = rows.filter(
    (item) => item.key.trim() || item.value.trim()
  );

  return filtered.length ? filtered : [row()];
}

function interpolate(value: string, environment: KeyValueRow[]) {
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    const found = environment.find(
      (item) => item.enabled && item.key.trim() === key
    );
    return found ? found.value : match;
  });
}

function resolveRows(rows: KeyValueRow[], environment: KeyValueRow[]) {
  return rows.map((item) => ({
    ...item,
    key: interpolate(item.key, environment),
    value: interpolate(item.value, environment)
  }));
}

function buildUrl(baseUrl: string, params: KeyValueRow[]) {
  try {
    const url = new URL(baseUrl);
    params.forEach((item) => {
      const key = item.key.trim();
      if (item.enabled && key) {
        url.searchParams.set(key, item.value);
      }
    });
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function applyAuth(
  auth: RequestAuth | undefined,
  headers: KeyValueRow[],
  url: string,
  environment: KeyValueRow[]
): { headers: KeyValueRow[]; url: string } {
  if (!auth || auth.type === "none") {
    return { headers, url };
  }

  const resolve = (value: string) => interpolate(value, environment);
  const nextHeaders = [...headers];

  if (auth.type === "bearer") {
    const token = resolve(auth.token).trim();
    if (token) {
      nextHeaders.push(row("Authorization", `Bearer ${token}`));
    }
    return { headers: nextHeaders, url };
  }

  if (auth.type === "basic") {
    const encoded = btoa(
      `${resolve(auth.username)}:${resolve(auth.password)}`
    );
    nextHeaders.push(row("Authorization", `Basic ${encoded}`));
    return { headers: nextHeaders, url };
  }

  if (auth.type === "oauth2") {
    const accessToken = auth.token?.accessToken?.trim();
    if (accessToken) {
      const prefix = (auth.headerPrefix || "Bearer").trim();
      nextHeaders.push(
        row("Authorization", prefix ? `${prefix} ${accessToken}` : accessToken)
      );
    }
    return { headers: nextHeaders, url };
  }

  const key = resolve(auth.key).trim();
  const value = resolve(auth.value);
  if (!key) {
    return { headers: nextHeaders, url };
  }

  if (auth.in === "query") {
    return { headers: nextHeaders, url: buildUrl(url, [row(key, value)]) };
  }

  nextHeaders.push(row(key, value));
  return { headers: nextHeaders, url };
}

function tokenizeCurl(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && input[i + 1] !== undefined) {
        current += input[++i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }

    if (char === "\\") {
      if (input[i + 1] === "\n") {
        i++;
      } else if (input[i + 1] !== undefined) {
        current += input[++i];
        started = true;
      }
      continue;
    }

    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }

    current += char;
    started = true;
  }

  if (started) {
    tokens.push(current);
  }

  return tokens;
}

function parseCurl(input: string): Partial<RequestDraft> | null {
  const tokens = tokenizeCurl(input.trim().replace(/^\$\s+/, ""));
  if (!tokens.length || tokens[0] !== "curl") {
    return null;
  }

  let method: HttpMethod | null = null;
  let url = "";
  let body = "";
  let auth: RequestAuth | undefined;
  const headers: KeyValueRow[] = [];
  const valuelessFlags = new Set([
    "--compressed",
    "-L",
    "--location",
    "-s",
    "--silent",
    "-k",
    "--insecure",
    "-i",
    "--include",
    "-v",
    "--verbose",
    "-g",
    "--globoff",
    "-#",
    "--progress-bar"
  ]);

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "-X" || token === "--request") {
      const candidate = (tokens[++i] ?? "").toUpperCase();
      if ((METHODS as string[]).includes(candidate)) {
        method = candidate as HttpMethod;
      }
    } else if (token === "-H" || token === "--header") {
      const header = tokens[++i] ?? "";
      const splitAt = header.indexOf(":");
      if (splitAt > -1) {
        headers.push(
          row(header.slice(0, splitAt).trim(), header.slice(splitAt + 1).trim())
        );
      }
    } else if (
      token === "-d" ||
      token === "--data" ||
      token === "--data-raw" ||
      token === "--data-binary" ||
      token === "--data-ascii"
    ) {
      body = tokens[++i] ?? "";
    } else if (token === "-u" || token === "--user") {
      const credential = tokens[++i] ?? "";
      const splitAt = credential.indexOf(":");
      auth = {
        type: "basic",
        username: splitAt > -1 ? credential.slice(0, splitAt) : credential,
        password: splitAt > -1 ? credential.slice(splitAt + 1) : ""
      };
    } else if (token === "-A" || token === "--user-agent") {
      headers.push(row("User-Agent", tokens[++i] ?? ""));
    } else if (token === "-e" || token === "--referer") {
      headers.push(row("Referer", tokens[++i] ?? ""));
    } else if (token === "--url") {
      url = tokens[++i] ?? "";
    } else if (valuelessFlags.has(token)) {
      // boolean flag, nothing to capture
    } else if (!token.startsWith("-") && !url) {
      url = token;
    }
  }

  if (body && !method) {
    method = "POST";
  }

  if (!url) {
    return null;
  }

  if (!auth) {
    const authHeaderIndex = headers.findIndex(
      (header) => header.key.toLowerCase() === "authorization"
    );
    if (authHeaderIndex > -1) {
      const headerValue = headers[authHeaderIndex].value;
      const match = /^Bearer\s+(.+)$/i.exec(headerValue);
      if (match) {
        auth = { type: "bearer", token: match[1].trim() };
        headers.splice(authHeaderIndex, 1);
      }
    }
  }

  return {
    method: method ?? "GET",
    url,
    headers: headers.length ? headers : [row()],
    body,
    auth: auth ?? { type: "none" }
  };
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function prettyBody(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

async function sendRequest(request: OpenPortRequest): Promise<OpenPortResponse> {
  if (window.openPort) {
    return window.openPort.sendRequest(request);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? 60000
  );
  const startedAt = performance.now();

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(
        request.headers
          .filter((item) => item.enabled && item.key.trim())
          .map((item) => [item.key.trim(), item.value])
      ),
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : request.body || undefined,
      signal: controller.signal
    });
    const body = await response.text();

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      durationMs: Math.round(performance.now() - startedAt),
      sizeBytes: new Blob([body]).size
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Request timed out."
          : error instanceof Error
            ? error.message
            : "Request failed.",
      durationMs: Math.round(performance.now() - startedAt)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomUrlSafe(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

type OAuthTokenResult =
  | { ok: true; token: OAuth2Token }
  | { ok: false; error: string };

function parseTokenResponse(body: string): OAuth2Token | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data.access_token !== "string") {
    return null;
  }
  const expiresIn = Number(data.expires_in);
  return {
    accessToken: data.access_token,
    tokenType: typeof data.token_type === "string" ? data.token_type : undefined,
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    scope: typeof data.scope === "string" ? data.scope : undefined,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Date.now() + expiresIn * 1000
        : undefined,
    obtainedAt: Date.now()
  };
}

async function requestToken(
  auth: OAuth2Auth,
  params: Record<string, string>,
  resolve: (value: string) => string
): Promise<OAuthTokenResult> {
  const tokenUrl = resolve(auth.accessTokenUrl).trim();
  if (!tokenUrl) {
    return { ok: false, error: "An access token URL is required." };
  }

  const form = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      form.set(key, value);
    }
  });

  const headers: KeyValueRow[] = [
    row("Content-Type", "application/x-www-form-urlencoded"),
    row("Accept", "application/json")
  ];

  const clientId = resolve(auth.clientId).trim();
  const clientSecret = resolve(auth.clientSecret);
  if (auth.clientAuth === "basic") {
    headers.push(
      row("Authorization", `Basic ${btoa(`${clientId}:${clientSecret}`)}`)
    );
  } else {
    if (clientId) {
      form.set("client_id", clientId);
    }
    if (clientSecret) {
      form.set("client_secret", clientSecret);
    }
  }

  const response = await sendRequest({
    method: "POST",
    url: tokenUrl,
    headers,
    body: form.toString(),
    timeoutMs: 60000
  });

  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: `Token endpoint returned ${response.status}. ${response.body.slice(0, 300)}`
    };
  }

  const token = parseTokenResponse(response.body);
  if (!token) {
    return {
      ok: false,
      error: "Token response did not contain an access_token."
    };
  }
  return { ok: true, token };
}

async function fetchOAuthToken(
  auth: OAuth2Auth,
  resolve: (value: string) => string,
  refreshToken?: string
): Promise<OAuthTokenResult> {
  const scope = resolve(auth.scope).trim();

  if (refreshToken) {
    const refreshed = await requestToken(
      auth,
      { grant_type: "refresh_token", refresh_token: refreshToken, scope },
      resolve
    );
    if (refreshed.ok) {
      if (!refreshed.token.refreshToken) {
        refreshed.token.refreshToken = refreshToken;
      }
      return refreshed;
    }
    // Refresh failed — fall through to a full grant below.
  }

  if (auth.grantType === "client_credentials") {
    return requestToken(
      auth,
      { grant_type: "client_credentials", scope },
      resolve
    );
  }

  if (auth.grantType === "password") {
    return requestToken(
      auth,
      {
        grant_type: "password",
        username: resolve(auth.username),
        password: resolve(auth.password),
        scope
      },
      resolve
    );
  }

  // Authorization code (optionally with PKCE) — needs the desktop popup.
  if (!window.openPort?.authorize) {
    return {
      ok: false,
      error: "Browser-based OAuth requires the OpenPort desktop app."
    };
  }

  const redirectUri = resolve(auth.redirectUri).trim();
  if (!redirectUri) {
    return {
      ok: false,
      error: "A redirect URL is required for the authorization code flow."
    };
  }

  let authUrl: URL;
  try {
    authUrl = new URL(resolve(auth.authUrl).trim());
  } catch {
    return { ok: false, error: "The authorization URL is not valid." };
  }

  const state = randomUrlSafe(24);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", resolve(auth.clientId).trim());
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  if (scope) {
    authUrl.searchParams.set("scope", scope);
  }

  let verifier = "";
  if (auth.grantType === "authorization_code_pkce") {
    verifier = randomUrlSafe(64);
    authUrl.searchParams.set("code_challenge", await pkceChallenge(verifier));
    authUrl.searchParams.set("code_challenge_method", "S256");
  }

  let callbackUrl: string;
  try {
    callbackUrl = await window.openPort.authorize({
      authUrl: authUrl.toString(),
      redirectUri
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Authorization was cancelled."
    };
  }

  let callback: URL;
  try {
    callback = new URL(callbackUrl);
  } catch {
    return { ok: false, error: "Received an invalid authorization callback." };
  }

  const returnedError = callback.searchParams.get("error");
  if (returnedError) {
    return { ok: false, error: `Authorization failed: ${returnedError}` };
  }
  const returnedState = callback.searchParams.get("state");
  if (returnedState && returnedState !== state) {
    return { ok: false, error: "Authorization state mismatch; aborting." };
  }
  const code = callback.searchParams.get("code");
  if (!code) {
    return {
      ok: false,
      error: "Authorization response did not include a code."
    };
  }

  const exchange: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  };
  if (verifier) {
    exchange.code_verifier = verifier;
  }
  return requestToken(auth, exchange, resolve);
}

function oauthTokenIsFresh(token?: OAuth2Token): boolean {
  if (!token?.accessToken) {
    return false;
  }
  if (!token.expiresAt) {
    return true;
  }
  // Refresh a minute early to avoid racing expiry.
  return token.expiresAt - Date.now() > 60_000;
}

function maskCredential(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "(empty)";
  }
  if (trimmed.includes("{{")) {
    return trimmed;
  }
  if (trimmed.length <= 8) {
    return "••••";
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function maskAuthHeaderValue(value: string): string {
  const idx = value.indexOf(" ");
  if (idx > 0) {
    return `${value.slice(0, idx)} ${maskCredential(value.slice(idx + 1))}`;
  }
  return maskCredential(value);
}

type AuthPreview = { header: string; value: string; pending: boolean } | null;

function previewAuth(
  auth: RequestAuth | undefined,
  url: string,
  environment: KeyValueRow[]
): AuthPreview {
  if (!auth || auth.type === "none") {
    return null;
  }

  if (auth.type === "oauth2") {
    const prefix = (auth.headerPrefix || "Bearer").trim() || "Bearer";
    if (auth.token?.accessToken) {
      return {
        header: "Authorization",
        value: `${prefix} ${maskCredential(auth.token.accessToken)}`,
        pending: false
      };
    }
    return {
      header: "Authorization",
      value: `${prefix} «token fetched on send»`,
      pending: true
    };
  }

  const applied = applyAuth(auth, [], url, environment);
  const authHeader = applied.headers.find(
    (header) => header.key.toLowerCase() === "authorization"
  );
  if (authHeader) {
    return {
      header: "Authorization",
      value: maskAuthHeaderValue(authHeader.value),
      pending: false
    };
  }
  if (applied.headers.length > 0) {
    const header = applied.headers[0];
    return {
      header: header.key,
      value: maskCredential(header.value),
      pending: false
    };
  }
  if (applied.url !== url) {
    return { header: "Query param", value: "appended to URL", pending: false };
  }
  return null;
}

function methodClass(method: HttpMethod) {
  switch (method) {
    case "GET":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "POST":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "PUT":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "PATCH":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "DELETE":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-700";
  }
}

function UrlPreview({
  url,
  environment
}: {
  url: string;
  environment: KeyValueRow[];
}) {
  const segments: React.ReactNode[] = [];
  const pattern = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(url)) !== null) {
    if (match.index > lastIndex) {
      segments.push(<span key={key++}>{url.slice(lastIndex, match.index)}</span>);
    }

    const name = match[1];
    const found = environment.find(
      (item) => item.enabled && item.key.trim() === name
    );

    segments.push(
      <span
        key={key++}
        className={`rounded px-1 ${
          found
            ? "bg-emerald-100 text-emerald-800"
            : "bg-rose-100 text-rose-700"
        }`}
        title={
          found
            ? `${name} = ${
                found.secret ? "••••••" : found.value || "(empty)"
              }`
            : `${name} is not defined`
        }
      >
        {`{{${name}}}`}
      </span>
    );

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < url.length) {
    segments.push(<span key={key++}>{url.slice(lastIndex)}</span>);
  }

  return <>{segments}</>;
}

function StatusPill({ response }: { response: ResponseState }) {
  if (!response) {
    return <span className="status-pill border-zinc-200 text-zinc-500">Idle</span>;
  }

  if (!response.ok) {
    return (
      <span className="status-pill border-rose-200 bg-rose-50 text-rose-700">
        Failed
      </span>
    );
  }

  const tone =
    response.status >= 200 && response.status < 300
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : response.status >= 400
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span className={`status-pill ${tone}`}>
      {response.status} {response.statusText || "Status"}
    </span>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled = false
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="grid size-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function RowEditor({
  rows,
  onRowsChange,
  valuePlaceholder = "Value",
  secrets = false
}: {
  rows: KeyValueRow[];
  onRowsChange: (rows: KeyValueRow[]) => void;
  valuePlaceholder?: string;
  secrets?: boolean;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  function toggleReveal(id: string) {
    setRevealed((current) => ({ ...current, [id]: !current[id] }));
  }

  function updateRow(id: string, patch: Partial<KeyValueRow>) {
    onRowsChange(
      rows.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function removeRow(id: string) {
    const next = rows.filter((item) => item.id !== id);
    onRowsChange(next.length ? next : [row()]);
  }

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
      <div className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_44px] border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
        <div className="px-3 py-2">On</div>
        <div className="px-3 py-2">Key</div>
        <div className="px-3 py-2">{valuePlaceholder}</div>
        <div className="px-3 py-2" />
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map((item) => (
          <div
            className="grid min-h-11 grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_44px] items-center"
            key={item.id}
          >
            <label className="grid place-items-center" title="Toggle row">
              <input
                checked={item.enabled}
                className="size-4 accent-emerald-700"
                type="checkbox"
                onChange={(event) =>
                  updateRow(item.id, { enabled: event.currentTarget.checked })
                }
              />
            </label>
            <input
              aria-label="Key"
              className="h-11 border-x border-zinc-100 bg-transparent px-3 text-sm outline-none placeholder:text-zinc-400 focus:bg-emerald-50/40"
              placeholder="Key"
              value={item.key}
              onChange={(event) => updateRow(item.id, { key: event.target.value })}
            />
            <div className="flex h-11 items-center border-r border-zinc-100">
              <input
                aria-label={valuePlaceholder}
                className="h-11 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-zinc-400 focus:bg-emerald-50/40"
                placeholder={valuePlaceholder}
                type={
                  secrets && item.secret && !revealed[item.id]
                    ? "password"
                    : "text"
                }
                value={item.value}
                onChange={(event) =>
                  updateRow(item.id, { value: event.target.value })
                }
              />
              {secrets ? (
                <div className="flex items-center pr-1">
                  {item.secret ? (
                    <button
                      className="grid size-8 place-items-center text-zinc-400 transition hover:text-zinc-700 active:translate-y-px"
                      type="button"
                      title={revealed[item.id] ? "Hide value" : "Reveal value"}
                      aria-label={
                        revealed[item.id] ? "Hide value" : "Reveal value"
                      }
                      onClick={() => toggleReveal(item.id)}
                    >
                      {revealed[item.id] ? (
                        <EyeOpenIcon className="size-4" />
                      ) : (
                        <EyeClosedIcon className="size-4" />
                      )}
                    </button>
                  ) : null}
                  <button
                    className={`grid size-8 place-items-center transition active:translate-y-px ${
                      item.secret
                        ? "text-emerald-700 hover:text-emerald-800"
                        : "text-zinc-400 hover:text-zinc-700"
                    }`}
                    type="button"
                    title={item.secret ? "Unmark secret" : "Mark as secret"}
                    aria-label={item.secret ? "Unmark secret" : "Mark as secret"}
                    onClick={() => {
                      const nextSecret = !item.secret;
                      updateRow(item.id, { secret: nextSecret });
                      if (!nextSecret) {
                        setRevealed((current) => ({
                          ...current,
                          [item.id]: false
                        }));
                      }
                    }}
                  >
                    {item.secret ? (
                      <LockClosedIcon className="size-4" />
                    ) : (
                      <LockOpen1Icon className="size-4" />
                    )}
                  </button>
                </div>
              ) : null}
            </div>
            <button
              className="grid size-11 place-items-center text-zinc-400 transition hover:text-rose-600 active:translate-y-px"
              type="button"
              title="Remove row"
              aria-label="Remove row"
              onClick={() => removeRow(item.id)}
            >
              <TrashIcon className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        className="flex h-10 w-full items-center justify-center gap-2 border-t border-zinc-200 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 active:translate-y-px"
        type="button"
        onClick={() => onRowsChange([...rows, row()])}
      >
        <PlusIcon className="size-4" />
        Add row
      </button>
    </div>
  );
}

const AUTH_TYPES: { value: RequestAuth["type"]; label: string }[] = [
  { value: "none", label: "No auth" },
  { value: "bearer", label: "Bearer token" },
  { value: "basic", label: "Basic auth" },
  { value: "apiKey", label: "API key" },
  { value: "oauth2", label: "OAuth 2.0" }
];

const OAUTH2_GRANTS: { value: OAuth2GrantType; label: string }[] = [
  { value: "authorization_code", label: "Authorization Code" },
  { value: "authorization_code_pkce", label: "Authorization Code (PKCE)" },
  { value: "client_credentials", label: "Client Credentials" },
  { value: "password", label: "Password Credentials" }
];

function defaultOAuth2(): OAuth2Auth {
  return {
    type: "oauth2",
    grantType: "authorization_code",
    authUrl: "",
    accessTokenUrl: "",
    clientId: "",
    clientSecret: "",
    scope: "",
    username: "",
    password: "",
    redirectUri: "https://oauth.openport.dev/callback",
    clientAuth: "body",
    headerPrefix: "Bearer"
  };
}

function AuthEditor({
  auth,
  onChange,
  oauthBusy = false,
  oauthError = "",
  onFetchToken,
  onClearToken
}: {
  auth: RequestAuth;
  onChange: (auth: RequestAuth) => void;
  oauthBusy?: boolean;
  oauthError?: string;
  onFetchToken?: () => void;
  onClearToken?: () => void;
}) {
  const fieldClass =
    "h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-emerald-600";
  const labelClass =
    "mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500";

  function selectType(type: RequestAuth["type"]) {
    if (type === auth.type) {
      return;
    }
    if (type === "none") {
      onChange({ type: "none" });
    } else if (type === "bearer") {
      onChange({ type: "bearer", token: "" });
    } else if (type === "basic") {
      onChange({ type: "basic", username: "", password: "" });
    } else if (type === "oauth2") {
      onChange(defaultOAuth2());
    } else {
      onChange({ type: "apiKey", key: "", value: "", in: "header" });
    }
  }

  function updateOAuth(patch: Partial<OAuth2Auth>) {
    if (auth.type === "oauth2") {
      onChange({ ...auth, ...patch });
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-zinc-200 bg-white p-4">
      <div>
        <label className={labelClass} htmlFor="auth-type">
          Auth type
        </label>
        <select
          id="auth-type"
          className={fieldClass}
          value={auth.type}
          onChange={(event) =>
            selectType(event.currentTarget.value as RequestAuth["type"])
          }
        >
          {AUTH_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {auth.type === "none" && (
        <p className="text-sm text-zinc-500">
          This request will be sent without an Authorization header.
        </p>
      )}

      {auth.type === "bearer" && (
        <div>
          <label className={labelClass} htmlFor="auth-token">
            Token
          </label>
          <input
            id="auth-token"
            className={`${fieldClass} font-mono`}
            placeholder="{{token}}"
            value={auth.token}
            onChange={(event) =>
              onChange({ type: "bearer", token: event.currentTarget.value })
            }
          />
        </div>
      )}

      {auth.type === "basic" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="auth-username">
              Username
            </label>
            <input
              id="auth-username"
              className={fieldClass}
              value={auth.username}
              onChange={(event) =>
                onChange({ ...auth, username: event.currentTarget.value })
              }
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              className={fieldClass}
              value={auth.password}
              onChange={(event) =>
                onChange({ ...auth, password: event.currentTarget.value })
              }
            />
          </div>
        </div>
      )}

      {auth.type === "apiKey" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="auth-key">
                Key
              </label>
              <input
                id="auth-key"
                className={fieldClass}
                placeholder="X-API-Key"
                value={auth.key}
                onChange={(event) =>
                  onChange({ ...auth, key: event.currentTarget.value })
                }
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="auth-value">
                Value
              </label>
              <input
                id="auth-value"
                className={`${fieldClass} font-mono`}
                placeholder="{{apiKey}}"
                value={auth.value}
                onChange={(event) =>
                  onChange({ ...auth, value: event.currentTarget.value })
                }
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="auth-in">
              Add to
            </label>
            <select
              id="auth-in"
              className={fieldClass}
              value={auth.in}
              onChange={(event) =>
                onChange({
                  ...auth,
                  in: event.currentTarget.value as "header" | "query"
                })
              }
            >
              <option value="header">Header</option>
              <option value="query">Query param</option>
            </select>
          </div>
        </div>
      )}

      {auth.type === "oauth2" && (
        <div className="space-y-3">
          <div>
            <label className={labelClass} htmlFor="oauth-grant">
              Grant type
            </label>
            <select
              id="oauth-grant"
              className={fieldClass}
              value={auth.grantType}
              onChange={(event) =>
                updateOAuth({
                  grantType: event.currentTarget.value as OAuth2GrantType
                })
              }
            >
              {OAUTH2_GRANTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {(auth.grantType === "authorization_code" ||
            auth.grantType === "authorization_code_pkce") && (
            <>
              <div>
                <label className={labelClass} htmlFor="oauth-auth-url">
                  Auth URL
                </label>
                <input
                  id="oauth-auth-url"
                  className={`${fieldClass} font-mono`}
                  placeholder="https://example.com/oauth/authorize"
                  value={auth.authUrl}
                  onChange={(event) =>
                    updateOAuth({ authUrl: event.currentTarget.value })
                  }
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="oauth-redirect">
                  Redirect URL
                </label>
                <input
                  id="oauth-redirect"
                  className={`${fieldClass} font-mono`}
                  value={auth.redirectUri}
                  onChange={(event) =>
                    updateOAuth({ redirectUri: event.currentTarget.value })
                  }
                />
              </div>
            </>
          )}

          <div>
            <label className={labelClass} htmlFor="oauth-token-url">
              Access Token URL
            </label>
            <input
              id="oauth-token-url"
              className={`${fieldClass} font-mono`}
              placeholder="https://example.com/oauth/token"
              value={auth.accessTokenUrl}
              onChange={(event) =>
                updateOAuth({ accessTokenUrl: event.currentTarget.value })
              }
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="oauth-client-id">
                Client ID
              </label>
              <input
                id="oauth-client-id"
                className={`${fieldClass} font-mono`}
                placeholder="{{clientId}}"
                value={auth.clientId}
                onChange={(event) =>
                  updateOAuth({ clientId: event.currentTarget.value })
                }
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="oauth-client-secret">
                Client Secret
              </label>
              <input
                id="oauth-client-secret"
                type="password"
                className={`${fieldClass} font-mono`}
                placeholder="{{clientSecret}}"
                value={auth.clientSecret}
                onChange={(event) =>
                  updateOAuth({ clientSecret: event.currentTarget.value })
                }
              />
            </div>
          </div>

          {auth.grantType === "password" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="oauth-username">
                  Username
                </label>
                <input
                  id="oauth-username"
                  className={fieldClass}
                  value={auth.username}
                  onChange={(event) =>
                    updateOAuth({ username: event.currentTarget.value })
                  }
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="oauth-password">
                  Password
                </label>
                <input
                  id="oauth-password"
                  type="password"
                  className={fieldClass}
                  value={auth.password}
                  onChange={(event) =>
                    updateOAuth({ password: event.currentTarget.value })
                  }
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="oauth-scope">
                Scope
              </label>
              <input
                id="oauth-scope"
                className={fieldClass}
                placeholder="read write"
                value={auth.scope}
                onChange={(event) =>
                  updateOAuth({ scope: event.currentTarget.value })
                }
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="oauth-client-auth">
                Client authentication
              </label>
              <select
                id="oauth-client-auth"
                className={fieldClass}
                value={auth.clientAuth}
                onChange={(event) =>
                  updateOAuth({
                    clientAuth: event.currentTarget.value as "body" | "basic"
                  })
                }
              >
                <option value="body">Send client credentials in body</option>
                <option value="basic">Send as Basic auth header</option>
              </select>
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  Current token
                </p>
                {auth.token?.accessToken ? (
                  <>
                    <p className="truncate font-mono text-xs text-zinc-700">
                      {auth.token.accessToken.slice(0, 12)}…{" "}
                      {auth.token.accessToken.slice(-6)}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {auth.token.expiresAt
                        ? `Expires ${formatDateTime(
                            new Date(auth.token.expiresAt).toISOString()
                          )}`
                        : "No expiry reported"}
                      {auth.token.refreshToken ? " · refreshable" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-zinc-500">
                    No token yet. It is fetched automatically on send.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {auth.token?.accessToken && onClearToken && (
                  <button
                    type="button"
                    className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:border-zinc-300"
                    onClick={onClearToken}
                    disabled={oauthBusy}
                  >
                    Clear
                  </button>
                )}
                {onFetchToken && (
                  <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    onClick={onFetchToken}
                    disabled={oauthBusy}
                  >
                    {oauthBusy ? "Fetching…" : "Get New Token"}
                  </button>
                )}
              </div>
            </div>
            {oauthError && (
              <p className="mt-2 text-xs text-rose-600">{oauthError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EnvironmentEditor({
  environments,
  activeEnvironmentId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onVariablesChange
}: {
  environments: Environment[];
  activeEnvironmentId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onVariablesChange: (id: string, variables: KeyValueRow[]) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const active =
    environments.find((item) => item.id === activeEnvironmentId) ??
    environments[0];

  if (!active) {
    return null;
  }

  function commitRename() {
    onRename(active.id, draftName);
    setRenaming(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {renaming ? (
          <input
            aria-label="Environment name"
            autoFocus
            className="h-9 min-w-0 flex-1 rounded-md border border-emerald-600 bg-white px-2 text-sm font-medium outline-none"
            value={draftName}
            onChange={(event) => setDraftName(event.currentTarget.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(false);
              }
            }}
          />
        ) : (
          <select
            aria-label="Edit environment"
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium outline-none focus:border-emerald-600"
            value={active.id}
            onChange={(event) => onSelect(event.currentTarget.value)}
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
        )}
        <IconButton
          label="Rename environment"
          onClick={() => {
            setDraftName(active.name);
            setRenaming(true);
          }}
        >
          <Pencil1Icon className="size-4" />
        </IconButton>
        <IconButton label="New environment" onClick={onCreate}>
          <PlusIcon className="size-4" />
        </IconButton>
        <IconButton
          label="Delete environment"
          onClick={() => onDelete(active.id)}
        >
          <TrashIcon className="size-4" />
        </IconButton>
      </div>
      <RowEditor
        rows={active.variables}
        valuePlaceholder="Variable value"
        secrets
        onRowsChange={(variables) => onVariablesChange(active.id, variables)}
      />
    </div>
  );
}

function EmptyResponse() {
  return (
    <div className="grid min-h-[360px] place-items-center rounded-md border border-dashed border-zinc-300 bg-white">
      <div className="text-center">
        <GlobeIcon className="mx-auto mb-3 size-10 text-zinc-400" />
        <p className="text-sm font-semibold text-zinc-700">No response yet</p>
        <p className="mt-1 text-xs text-zinc-500">Ready when you are.</p>
      </div>
    </div>
  );
}

function ResponseSkeleton() {
  return (
    <div className="space-y-3 rounded-md border border-zinc-200 bg-white p-4">
      <div className="h-5 w-32 animate-pulse rounded bg-zinc-200" />
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-zinc-100" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-zinc-100" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-zinc-100" />
        <div className="h-3 w-10/12 animate-pulse rounded bg-zinc-100" />
      </div>
    </div>
  );
}

function AppSidebar({
  collections,
  history,
  activeCollectionId,
  activeRequestId,
  collectionsExpanded,
  onSelectRequest,
  onSelectCollection,
  onNewRequest,
  onNewCollection,
  onRenameCollection,
  onDeleteRequest,
  onDeleteCollection,
  onToggleCollections,
  onLoadHistory,
  onClearHistory,
  onExport,
  onImport,
  environments,
  activeEnvironmentId,
  onSelectEnvironment
}: {
  collections: Collection[];
  history: HistoryItem[];
  activeCollectionId: string;
  activeRequestId: string;
  collectionsExpanded: boolean;
  onSelectRequest: (collectionId: string, request: RequestDraft) => void;
  onSelectCollection: (collection: Collection) => void;
  onNewRequest: (collectionId?: string) => void;
  onNewCollection: () => void;
  onRenameCollection: (collectionId: string, name: string) => void;
  onDeleteRequest: (collectionId: string, requestId: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onToggleCollections: () => void;
  onLoadHistory: (item: HistoryItem) => void;
  onClearHistory: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  environments: Environment[];
  activeEnvironmentId: string;
  onSelectEnvironment: (id: string) => void;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(
    null
  );
  const [draftName, setDraftName] = useState("");

  function startRename(collection: Collection) {
    setEditingCollectionId(collection.id);
    setDraftName(collection.name);
  }

  function commitRename() {
    if (editingCollectionId) {
      onRenameCollection(editingCollectionId, draftName);
    }
    setEditingCollectionId(null);
  }
  return (
    <aside className="flex min-h-[100dvh] flex-col border-r border-zinc-200 bg-[#fbfbfa]">
      <div className="border-b border-zinc-200 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-md bg-zinc-950 text-white">
            <ActivityLogIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-950">
              OpenPort
            </h1>
            <p className="text-xs text-zinc-500">Local API workbench</p>
          </div>
        </div>
      </div>

      <div className="border-b border-zinc-200 px-4 py-3">
        <label
          className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400"
          htmlFor="active-environment"
        >
          Environment
        </label>
        <div className="flex items-center gap-2">
          <GlobeIcon className="size-4 shrink-0 text-zinc-400" />
          <select
            id="active-environment"
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-emerald-600"
            value={activeEnvironmentId}
            onChange={(event) => onSelectEnvironment(event.currentTarget.value)}
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-3">
        <button
          className="flex min-h-8 flex-1 items-center gap-2 rounded-md px-1 text-left text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 active:translate-y-px"
          type="button"
          aria-expanded={collectionsExpanded}
          onClick={onToggleCollections}
        >
          {collectionsExpanded ? (
            <ChevronDownIcon className="size-4" />
          ) : (
            <ChevronRightIcon className="size-4" />
          )}
          <FileTextIcon className="size-4" />
          Collections
        </button>
        <IconButton label="New collection" onClick={onNewCollection}>
          <PlusIcon className="size-4" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {collectionsExpanded &&
          collections.map((collection) => (
            <div className="mb-4" key={collection.id}>
              <div className="mb-1 flex items-center gap-1">
                {editingCollectionId === collection.id ? (
                  <input
                    aria-label="Collection name"
                    autoFocus
                    className="h-8 min-w-0 flex-1 rounded-md border border-emerald-600 bg-white px-2 text-xs font-semibold text-zinc-950 outline-none"
                    value={draftName}
                    onChange={(event) => setDraftName(event.currentTarget.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingCollectionId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    className={`flex min-h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left text-xs font-semibold transition hover:bg-zinc-100 active:translate-y-px ${
                      activeCollectionId === collection.id
                        ? "bg-zinc-100 text-zinc-950"
                        : "text-zinc-500"
                    }`}
                    type="button"
                    onClick={() => onSelectCollection(collection)}
                    onDoubleClick={() => startRename(collection)}
                  >
                    <span className="min-w-0 truncate">{collection.name}</span>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {collection.requests.length}
                    </span>
                  </button>
                )}
                <IconButton
                  label={`Rename ${collection.name}`}
                  onClick={() => startRename(collection)}
                >
                  <Pencil1Icon className="size-4" />
                </IconButton>
                <IconButton
                  label={`New request in ${collection.name}`}
                  onClick={() => onNewRequest(collection.id)}
                >
                  <PlusIcon className="size-4" />
                </IconButton>
                <IconButton
                  label={`Delete ${collection.name}`}
                  onClick={() => onDeleteCollection(collection.id)}
                >
                  <TrashIcon className="size-4" />
                </IconButton>
              </div>
              <div className="space-y-1">
                {collection.requests.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-zinc-400">
                    No saved requests
                  </div>
                ) : (
                  collection.requests.map((request) => (
                    <div
                      className="group flex items-center gap-1"
                      key={request.id}
                    >
                      <button
                        className={`sidebar-item min-w-0 flex-1 ${
                          activeRequestId === request.id
                            ? "sidebar-item-active"
                            : ""
                        }`}
                        type="button"
                        onClick={() => onSelectRequest(collection.id, request)}
                      >
                        <span
                          className={`method-chip ${methodClass(request.method)}`}
                        >
                          {request.method}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">
                          {request.name}
                        </span>
                      </button>
                      <button
                        className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-400 opacity-0 transition hover:text-rose-600 focus-visible:opacity-100 active:translate-y-px group-hover:opacity-100"
                        type="button"
                        title={`Delete ${request.name}`}
                        aria-label={`Delete ${request.name}`}
                        onClick={() => onDeleteRequest(collection.id, request.id)}
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
      </div>

      <div className="border-t border-zinc-200 px-2 py-3">
        <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
          <span className="flex items-center gap-2">
            <CounterClockwiseClockIcon className="size-4" />
            History
          </span>
          {history.length > 0 && (
            <button
              className="rounded px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-zinc-400 transition hover:bg-zinc-100 hover:text-rose-600 active:translate-y-px"
              type="button"
              onClick={onClearHistory}
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {history.length === 0 ? (
            <div className="px-2 py-4 text-xs text-zinc-500">No calls yet</div>
          ) : (
            history.slice(0, 12).map((item) => (
              <button
                className="sidebar-item"
                key={item.id}
                type="button"
                onClick={() => onLoadHistory(item)}
              >
                <span className={`method-chip ${methodClass(item.method)}`}>
                  {item.method}
                </span>
                <span className="min-w-0 flex-1 truncate text-left">
                  {item.url}
                </span>
                <span className="text-[11px] text-zinc-400">
                  {item.status ?? "-"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-200 px-3 py-3">
        <input
          ref={importInputRef}
          className="hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              onImport(file);
            }
            event.currentTarget.value = "";
          }}
        />
        <button
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 active:translate-y-px"
          type="button"
          onClick={() => importInputRef.current?.click()}
        >
          <UploadIcon className="size-4" />
          Import
        </button>
        <button
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 active:translate-y-px"
          type="button"
          onClick={onExport}
        >
          <DownloadIcon className="size-4" />
          Export
        </button>
      </div>
    </aside>
  );
}

export function App() {
  const [state, setState] = useState<PersistedState>(() => loadState());
  const [activeRequest, setActiveRequest] = useState<RequestDraft>(() =>
    cloneRequest(defaultState.collections[0].requests[0])
  );
  const [activeCollectionId, setActiveCollectionId] = useState(
    defaultState.collections[0].id
  );
  const [collectionsExpanded, setCollectionsExpanded] = useState(true);
  const [requestTab, setRequestTab] =
    useState<(typeof REQUEST_TABS)[number]>("Params");
  const [responseTab, setResponseTab] =
    useState<(typeof RESPONSE_TABS)[number]>("Body");
  const [response, setResponse] = useState<ResponseState>(null);
  const [isSending, setIsSending] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [curlError, setCurlError] = useState("");

  const activeEnvironmentId = state.environments.some(
    (item) => item.id === state.activeEnvironmentId
  )
    ? state.activeEnvironmentId
    : state.environments[0]?.id ?? "";

  const effectiveEnvironmentId =
    activeRequest.environmentId &&
    state.environments.some((item) => item.id === activeRequest.environmentId)
      ? activeRequest.environmentId
      : activeEnvironmentId;

  const activeVariables = useMemo(
    () =>
      state.environments.find((item) => item.id === effectiveEnvironmentId)
        ?.variables ?? [],
    [state.environments, effectiveEnvironmentId]
  );

  const activeEnvironmentName =
    state.environments.find((item) => item.id === activeEnvironmentId)?.name ??
    "";

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!state.collections.some((collection) => collection.id === activeCollectionId)) {
      setActiveCollectionId(state.collections[0]?.id ?? "");
    }
  }, [activeCollectionId, state.collections]);

  const canSend = activeRequest.url.trim().length > 0;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!isSending && canSend) {
          void handleSend();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSend, isSending, activeRequest, activeVariables]);

  const resolvedPreview = useMemo(() => {
    const resolvedUrl = interpolate(activeRequest.url, activeVariables);
    return buildUrl(
      resolvedUrl,
      resolveRows(activeRequest.params, activeVariables)
    );
  }, [activeRequest.params, activeRequest.url, activeVariables]);

  const authPreview = useMemo(
    () =>
      previewAuth(
        activeRequest.auth,
        interpolate(activeRequest.url, activeVariables),
        activeVariables
      ),
    [activeRequest.auth, activeRequest.url, activeVariables]
  );

  function updateActive(patch: Partial<RequestDraft>) {
    setActiveRequest((current) => ({ ...current, ...patch }));
  }

  function importCurl() {
    const parsed = parseCurl(curlText);
    if (!parsed) {
      setCurlError("Could not parse that. Paste a command starting with curl.");
      return;
    }

    setActiveRequest((current) => ({
      ...current,
      method: parsed.method ?? current.method,
      url: parsed.url ?? current.url,
      headers: parsed.headers ?? current.headers,
      body: parsed.body ?? current.body,
      auth: parsed.auth ?? { type: "none" }
    }));
    setResponse(null);
    setCurlText("");
    setCurlError("");
    setCurlOpen(false);
    setRequestTab(parsed.auth && parsed.auth.type !== "none" ? "Auth" : "Headers");
  }

  function saveRequest() {
    const cleanRequest: RequestDraft = {
      ...activeRequest,
      params: compactRows(activeRequest.params),
      headers: compactRows(activeRequest.headers)
    };

    setState((current) => {
      const collections = current.collections.length
        ? current.collections
        : defaultState.collections;
      const targetCollectionId = activeCollectionId || collections[0]?.id;

      if (!targetCollectionId) {
        return current;
      }

      return {
        ...current,
        collections: collections.map((collection) => {
          if (collection.id !== targetCollectionId) {
            return collection;
          }

          const existingIndex = collection.requests.findIndex(
            (item) => item.id === cleanRequest.id
          );
          const requests =
            existingIndex >= 0
              ? collection.requests.map((item) =>
                  item.id === cleanRequest.id ? cleanRequest : item
                )
              : [cleanRequest, ...collection.requests];

          return { ...collection, requests };
        })
      };
    });

    setActiveRequest(cleanRequest);
    setSavedNotice("Saved");
    window.setTimeout(() => setSavedNotice(""), 1600);
  }

  async function runOAuthFetch(
    auth: OAuth2Auth,
    useRefresh: boolean
  ): Promise<{ ok: true; auth: OAuth2Auth } | { ok: false; error: string }> {
    setOauthError("");
    setOauthBusy(true);
    const resolve = (value: string) => interpolate(value, activeVariables);
    const refreshToken =
      useRefresh && auth.token?.refreshToken
        ? auth.token.refreshToken
        : undefined;
    const result = await fetchOAuthToken(auth, resolve, refreshToken);
    setOauthBusy(false);
    if (!result.ok) {
      setOauthError(result.error);
      return { ok: false, error: result.error };
    }
    const nextAuth: OAuth2Auth = { ...auth, token: result.token };
    updateActive({ auth: nextAuth });
    return { ok: true, auth: nextAuth };
  }

  function handleFetchToken() {
    if (activeRequest.auth?.type === "oauth2") {
      void runOAuthFetch(activeRequest.auth, false);
    }
  }

  function handleClearToken() {
    if (activeRequest.auth?.type === "oauth2") {
      updateActive({ auth: { ...activeRequest.auth, token: undefined } });
      setOauthError("");
    }
  }

  async function handleSend() {
    setIsSending(true);
    setResponse(null);

    let auth = activeRequest.auth;
    if (auth?.type === "oauth2" && !oauthTokenIsFresh(auth.token)) {
      const obtained = await runOAuthFetch(auth, true);
      if (!obtained.ok) {
        setResponse({
          ok: false,
          error: `OAuth token request failed. ${obtained.error}`,
          durationMs: 0
        });
        setIsSending(false);
        return;
      }
      auth = obtained.auth;
    }

    const resolvedUrl = buildUrl(
      interpolate(activeRequest.url, activeVariables),
      resolveRows(activeRequest.params, activeVariables)
    );
    const resolvedHeaders = resolveRows(activeRequest.headers, activeVariables);
    const withAuth = applyAuth(
      auth,
      resolvedHeaders,
      resolvedUrl,
      activeVariables
    );
    const preparedUrl = withAuth.url;
    const preparedHeaders = withAuth.headers;
    const preparedBody = interpolate(activeRequest.body, activeVariables);

    const result = await sendRequest({
      method: activeRequest.method,
      url: preparedUrl,
      headers: preparedHeaders,
      body: preparedBody,
      timeoutMs: 60000
    });

    setResponse(result);
    setIsSending(false);

    setState((current) => ({
      ...current,
      history: [
        {
          id: uid("hist"),
          name: activeRequest.name,
          method: activeRequest.method,
          url: preparedUrl,
          status: result.ok ? result.status : undefined,
          durationMs: result.durationMs,
          createdAt: new Date().toISOString()
        },
        ...current.history
      ].slice(0, 60)
    }));
  }

  function startNewRequest(collectionId = activeCollectionId) {
    if (collectionId) {
      setActiveCollectionId(collectionId);
    }
    setActiveRequest(
      requestDraft({
        id: uid("req"),
        name: "Untitled request",
        url: "{{baseUrl}}/anything"
      })
    );
    setResponse(null);
    setRequestTab("Params");
  }

  function selectCollection(collection: Collection) {
    setActiveCollectionId(collection.id);
    setCollectionsExpanded(true);

    if (collection.requests[0]) {
      setActiveRequest(cloneRequest(collection.requests[0]));
    } else {
      setActiveRequest(
        requestDraft({
          id: uid("req"),
          name: "Untitled request",
          url: "{{baseUrl}}/anything"
        })
      );
    }

    setResponse(null);
    setRequestTab("Params");
  }

  function loadHistory(item: HistoryItem) {
    setActiveRequest(
      requestDraft({
        name: item.name,
        method: item.method,
        url: item.url,
        body: ""
      })
    );
    setResponse(null);
    setRequestTab("Params");
  }

  function copyResponse() {
    if (response?.ok) {
      navigator.clipboard.writeText(response.body);
    }
  }

  function deleteRequest(collectionId: string, requestId: string) {
    setState((current) => ({
      ...current,
      collections: current.collections.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              requests: collection.requests.filter(
                (item) => item.id !== requestId
              )
            }
          : collection
      )
    }));

    if (activeRequest.id === requestId) {
      startNewRequest(collectionId);
    }
  }

  function createCollection() {
    const existing = new Set(
      state.collections.map((collection) => collection.name)
    );
    let index = state.collections.length + 1;
    let name = `Collection ${index}`;
    while (existing.has(name)) {
      index += 1;
      name = `Collection ${index}`;
    }

    const collection: Collection = { id: uid("col"), name, requests: [] };

    setState((current) => ({
      ...current,
      collections: [...current.collections, collection]
    }));
    setActiveCollectionId(collection.id);
    setCollectionsExpanded(true);
    startNewRequest(collection.id);
  }

  function renameCollection(collectionId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    setState((current) => ({
      ...current,
      collections: current.collections.map((collection) =>
        collection.id === collectionId
          ? { ...collection, name: trimmed }
          : collection
      )
    }));
  }

  function deleteCollection(collectionId: string) {
    const target = state.collections.find(
      (collection) => collection.id === collectionId
    );

    if (!target) {
      return;
    }

    if (
      target.requests.length > 0 &&
      !window.confirm(
        `Delete "${target.name}" and its ${target.requests.length} request(s)?`
      )
    ) {
      return;
    }

    const remaining = state.collections.filter(
      (collection) => collection.id !== collectionId
    );

    setState((current) => ({
      ...current,
      collections: current.collections.filter(
        (collection) => collection.id !== collectionId
      )
    }));

    if (activeCollectionId === collectionId) {
      const next = remaining[0];
      if (next) {
        selectCollection(next);
      } else {
        setActiveCollectionId("");
        startNewRequest("");
      }
    }
  }

  function clearHistory() {
    setState((current) => ({ ...current, history: [] }));
  }

  function selectActiveEnvironment(id: string) {
    setState((current) => ({ ...current, activeEnvironmentId: id }));
  }

  function updateEnvironmentVariables(id: string, variables: KeyValueRow[]) {
    setState((current) => ({
      ...current,
      environments: current.environments.map((environment) =>
        environment.id === id ? { ...environment, variables } : environment
      )
    }));
  }

  function createEnvironment() {
    const id = uid("env");
    setState((current) => ({
      ...current,
      environments: [
        ...current.environments,
        {
          id,
          name: `Environment ${current.environments.length + 1}`,
          variables: [row()]
        }
      ],
      activeEnvironmentId: id
    }));
  }

  function renameEnvironment(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setState((current) => ({
      ...current,
      environments: current.environments.map((environment) =>
        environment.id === id ? { ...environment, name: trimmed } : environment
      )
    }));
  }

  function deleteEnvironment(id: string) {
    setState((current) => {
      if (current.environments.length <= 1) {
        return current;
      }
      const environments = current.environments.filter(
        (environment) => environment.id !== id
      );
      return {
        ...current,
        environments,
        activeEnvironmentId:
          current.activeEnvironmentId === id
            ? environments[0].id
            : current.activeEnvironmentId
      };
    });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `openport-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importData(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<PersistedState>;

        if (!Array.isArray(parsed.collections)) {
          throw new Error("missing collections");
        }

        const next: PersistedState = {
          collections: parsed.collections.length
            ? parsed.collections
            : defaultState.collections,
          history: Array.isArray(parsed.history) ? parsed.history : [],
          ...migrateEnvironments(
            parsed as {
              environments?: Environment[];
              environment?: KeyValueRow[];
              activeEnvironmentId?: string;
            }
          )
        };

        setState(next);

        const firstCollection = next.collections[0];
        setActiveCollectionId(firstCollection?.id ?? "");
        setCollectionsExpanded(true);
        if (firstCollection?.requests[0]) {
          setActiveRequest(cloneRequest(firstCollection.requests[0]));
        } else {
          startNewRequest(firstCollection?.id ?? "");
        }
        setResponse(null);
        setRequestTab("Params");
      } catch {
        window.alert("Could not import: the file is not valid OpenPort JSON.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="min-h-[100dvh] bg-[#f7f7f5] text-zinc-950">
      <div className="grid min-h-[100dvh] grid-cols-1 lg:grid-cols-[282px_minmax(0,1fr)]">
        <AppSidebar
          activeCollectionId={activeCollectionId}
          activeRequestId={activeRequest.id}
          collectionsExpanded={collectionsExpanded}
          collections={state.collections}
          history={state.history}
          onLoadHistory={loadHistory}
          onNewRequest={startNewRequest}
          onNewCollection={createCollection}
          onRenameCollection={renameCollection}
          onDeleteRequest={deleteRequest}
          onDeleteCollection={deleteCollection}
          onClearHistory={clearHistory}
          onExport={exportData}
          onImport={importData}
          environments={state.environments}
          activeEnvironmentId={activeEnvironmentId}
          onSelectEnvironment={selectActiveEnvironment}
          onSelectCollection={selectCollection}
          onToggleCollections={() =>
            setCollectionsExpanded((isExpanded) => !isExpanded)
          }
          onSelectRequest={(collectionId, request) => {
            setActiveCollectionId(collectionId);
            setActiveRequest(cloneRequest(request));
            setResponse(null);
            setRequestTab("Params");
          }}
        />

        <main className="min-w-0">
          <header className="border-b border-zinc-200 bg-[#fbfbfa]/95 px-4 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3">
              <label className="sr-only" htmlFor="request-name">
                Request name
              </label>
              <input
                id="request-name"
                className="h-10 w-56 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium outline-none transition placeholder:text-zinc-400 focus:border-emerald-600"
                value={activeRequest.name}
                onChange={(event) =>
                  updateActive({ name: event.currentTarget.value })
                }
              />

              <div className="flex min-w-0 flex-1 rounded-md border border-zinc-200 bg-white shadow-sm">
                <label className="sr-only" htmlFor="request-method">
                  Method
                </label>
                <select
                  id="request-method"
                  className="h-10 w-[104px] rounded-l-md border-r border-zinc-200 bg-zinc-50 px-3 text-sm font-bold text-zinc-700 outline-none"
                  value={activeRequest.method}
                  onChange={(event) =>
                    updateActive({
                      method: event.currentTarget.value as HttpMethod
                    })
                  }
                >
                  {METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="request-url">
                  URL
                </label>
                <input
                  id="request-url"
                  className="h-10 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm outline-none placeholder:text-zinc-400"
                  placeholder="https://api.example.com/v1"
                  value={activeRequest.url}
                  onChange={(event) =>
                    updateActive({ url: event.currentTarget.value })
                  }
                />
              </div>

              <button
                className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 active:translate-y-px"
                type="button"
                onClick={saveRequest}
              >
                <BookmarkIcon className="size-4" />
                {savedNotice || "Save"}
              </button>

              <button
                className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                title="Send request (⌘/Ctrl + Enter)"
                disabled={isSending || !canSend}
                onClick={handleSend}
              >
                <PaperPlaneIcon className="size-4" />
                {isSending ? "Sending" : "Send"}
              </button>
            </div>
          </header>

          <section className="grid min-h-[calc(100dvh-65px)] grid-cols-1 xl:grid-cols-[minmax(0,0.98fr)_minmax(420px,1.02fr)]">
            <div className="min-w-0 border-r border-zinc-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-950">
                    Request
                  </h2>
                  <p
                    className="mt-1 truncate font-mono text-xs text-zinc-500"
                    title={resolvedPreview}
                  >
                    <UrlPreview
                      url={activeRequest.url}
                      environment={activeVariables}
                    />
                  </p>
                  {authPreview && (
                    <p
                      className="mt-1 flex items-center gap-1 truncate font-mono text-[11px] text-zinc-400"
                      title={`${authPreview.header}: ${authPreview.value}`}
                    >
                      <LockClosedIcon className="size-3 shrink-0" />
                      <span className="truncate">
                        {authPreview.header}: {authPreview.value}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="request-environment">
                    Request environment
                  </label>
                  <select
                    id="request-environment"
                    className="h-8 max-w-[150px] rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-600 outline-none focus:border-emerald-600"
                    title="Environment used for this request"
                    value={activeRequest.environmentId ?? ""}
                    onChange={(event) =>
                      updateActive({
                        environmentId: event.currentTarget.value || undefined
                      })
                    }
                  >
                    <option value="">
                      Active env{activeEnvironmentName ? ` (${activeEnvironmentName})` : ""}
                    </option>
                    {state.environments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 active:translate-y-px"
                    type="button"
                    onClick={() => {
                      setCurlError("");
                      setCurlOpen((open) => !open);
                    }}
                  >
                    <DownloadIcon className="size-3.5" />
                    Import cURL
                  </button>
                  <span
                    className={`method-chip ${methodClass(activeRequest.method)}`}
                  >
                    {activeRequest.method}
                  </span>
                </div>
              </div>

              {curlOpen && (
                <div className="mb-4 rounded-md border border-zinc-200 bg-white p-3">
                  <label className="sr-only" htmlFor="curl-input">
                    cURL command
                  </label>
                  <textarea
                    id="curl-input"
                    className="min-h-[96px] w-full resize-y rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-5 outline-none placeholder:text-zinc-400 focus:border-emerald-600 focus:bg-white"
                    spellCheck={false}
                    placeholder="curl https://api.example.com/users -H 'Authorization: Bearer ...'"
                    value={curlText}
                    onChange={(event) => setCurlText(event.currentTarget.value)}
                  />
                  {curlError ? (
                    <p className="mt-2 text-xs font-medium text-rose-600">
                      {curlError}
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
                      type="button"
                      onClick={() => {
                        setCurlOpen(false);
                        setCurlError("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                      type="button"
                      aria-label="Run cURL import"
                      disabled={!curlText.trim()}
                      onClick={importCurl}
                    >
                      Import
                    </button>
                  </div>
                </div>
              )}

              <div className="mb-4 flex rounded-md border border-zinc-200 bg-white p-1">
                {REQUEST_TABS.map((tab) => (
                  <button
                    className={`tab-button ${
                      requestTab === tab ? "tab-button-active" : ""
                    }`}
                    key={tab}
                    type="button"
                    onClick={() => setRequestTab(tab)}
                  >
                    {tab === "Params" && <RowsIcon className="size-4" />}
                    {tab === "Headers" && <ArchiveIcon className="size-4" />}
                    {tab === "Auth" && <LockClosedIcon className="size-4" />}
                    {tab === "Body" && <CodeIcon className="size-4" />}
                    {tab === "Env" && <GearIcon className="size-4" />}
                    {tab}
                  </button>
                ))}
              </div>

              {requestTab === "Params" && (
                <RowEditor
                  rows={activeRequest.params}
                  onRowsChange={(params) => updateActive({ params })}
                />
              )}

              {requestTab === "Headers" && (
                <RowEditor
                  rows={activeRequest.headers}
                  onRowsChange={(headers) => updateActive({ headers })}
                />
              )}

              {requestTab === "Auth" && (
                <AuthEditor
                  auth={activeRequest.auth ?? { type: "none" }}
                  onChange={(auth) => updateActive({ auth })}
                  oauthBusy={oauthBusy}
                  oauthError={oauthError}
                  onFetchToken={handleFetchToken}
                  onClearToken={handleClearToken}
                />
              )}

              {requestTab === "Body" && (
                <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
                  <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                    Raw body
                  </div>
                  <label className="sr-only" htmlFor="request-body">
                    Request body
                  </label>
                  <textarea
                    id="request-body"
                    className="min-h-[360px] w-full resize-y bg-white p-4 font-mono text-sm leading-6 outline-none placeholder:text-zinc-400 focus:bg-emerald-50/30"
                    spellCheck={false}
                    value={activeRequest.body}
                    onChange={(event) =>
                      updateActive({ body: event.currentTarget.value })
                    }
                  />
                </div>
              )}

              {requestTab === "Env" && (
                <EnvironmentEditor
                  environments={state.environments}
                  activeEnvironmentId={activeEnvironmentId}
                  onSelect={selectActiveEnvironment}
                  onCreate={createEnvironment}
                  onRename={renameEnvironment}
                  onDelete={deleteEnvironment}
                  onVariablesChange={updateEnvironmentVariables}
                />
              )}
            </div>

            <div className="min-w-0 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-zinc-950">
                    Response
                  </h2>
                  <StatusPill response={response} />
                </div>
                <div className="flex items-center gap-2">
                  {response?.ok && (
                    <>
                      <span className="metric">{response.durationMs} ms</span>
                      <span className="metric">
                        {formatBytes(response.sizeBytes)}
                      </span>
                    </>
                  )}
                  <IconButton
                    label="Copy response body"
                    onClick={copyResponse}
                    disabled={!response?.ok}
                  >
                    <CopyIcon className="size-4" />
                  </IconButton>
                </div>
              </div>

              <div className="mb-4 flex rounded-md border border-zinc-200 bg-white p-1">
                {RESPONSE_TABS.map((tab) => (
                  <button
                    className={`tab-button ${
                      responseTab === tab ? "tab-button-active" : ""
                    }`}
                    key={tab}
                    type="button"
                    onClick={() => setResponseTab(tab)}
                  >
                    {tab === "Body" && <CodeIcon className="size-4" />}
                    {tab === "Headers" && <TableIcon className="size-4" />}
                    {tab}
                  </button>
                ))}
              </div>

              {isSending && <ResponseSkeleton />}

              {!isSending && !response && <EmptyResponse />}

              {!isSending && response && !response.ok && (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-rose-800">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <ExclamationTriangleIcon className="size-4" />
                    Request failed
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-sm">
                    {response.error}
                  </pre>
                  <div className="mt-3 text-xs text-rose-700">
                    {response.durationMs} ms
                  </div>
                </div>
              )}

              {!isSending && response?.ok && responseTab === "Body" && (
                <pre className="response-code">{prettyBody(response.body)}</pre>
              )}

              {!isSending && response?.ok && responseTab === "Headers" && (
                <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
                  <div className="grid grid-cols-[minmax(180px,0.4fr)_minmax(0,0.6fr)] border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                    <div className="px-3 py-2">Header</div>
                    <div className="px-3 py-2">Value</div>
                  </div>
                  <div className="divide-y divide-zinc-100">
                    {Object.entries(response.headers).map(([key, value]) => (
                      <div
                        className="grid grid-cols-[minmax(180px,0.4fr)_minmax(0,0.6fr)] text-sm"
                        key={key}
                      >
                        <div className="border-r border-zinc-100 px-3 py-2 font-mono text-zinc-600">
                          {key}
                        </div>
                        <div className="min-w-0 break-words px-3 py-2 font-mono text-zinc-800">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {state.history[0] && (
                <div className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
                  Last call: {formatDateTime(state.history[0].createdAt)}
                  {state.history[0].durationMs !== undefined
                    ? `, ${state.history[0].durationMs} ms`
                    : ""}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

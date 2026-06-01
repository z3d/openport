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

type RequestAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; key: string; value: string; in: "header" | "query" };

type RequestDraft = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  body: string;
  auth?: RequestAuth;
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
  environment: KeyValueRow[];
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

const defaultState: PersistedState = {
  environment: [
    row("baseUrl", "https://httpbin.org"),
    row("token", "", false)
  ],
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

function loadState(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return defaultState;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      collections: parsed.collections?.length
        ? parsed.collections
        : defaultState.collections,
      history: parsed.history ?? [],
      environment: parsed.environment?.length
        ? parsed.environment
        : defaultState.environment
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
  { value: "apiKey", label: "API key" }
];

function AuthEditor({
  auth,
  onChange
}: {
  auth: RequestAuth;
  onChange: (auth: RequestAuth) => void;
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
    } else {
      onChange({ type: "apiKey", key: "", value: "", in: "header" });
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
  onImport
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
  const [savedNotice, setSavedNotice] = useState("");
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [curlError, setCurlError] = useState("");

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
  }, [canSend, isSending, activeRequest, state.environment]);

  const resolvedPreview = useMemo(() => {
    const resolvedUrl = interpolate(activeRequest.url, state.environment);
    return buildUrl(
      resolvedUrl,
      resolveRows(activeRequest.params, state.environment)
    );
  }, [activeRequest.params, activeRequest.url, state.environment]);

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

  async function handleSend() {
    setIsSending(true);
    setResponse(null);

    const resolvedUrl = buildUrl(
      interpolate(activeRequest.url, state.environment),
      resolveRows(activeRequest.params, state.environment)
    );
    const resolvedHeaders = resolveRows(
      activeRequest.headers,
      state.environment
    );
    const withAuth = applyAuth(
      activeRequest.auth,
      resolvedHeaders,
      resolvedUrl,
      state.environment
    );
    const preparedUrl = withAuth.url;
    const preparedHeaders = withAuth.headers;
    const preparedBody = interpolate(activeRequest.body, state.environment);

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
          environment:
            Array.isArray(parsed.environment) && parsed.environment.length
              ? parsed.environment
              : defaultState.environment
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
                      environment={state.environment}
                    />
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
                <RowEditor
                  rows={state.environment}
                  valuePlaceholder="Variable value"
                  secrets
                  onRowsChange={(environment) =>
                    setState((current) => ({ ...current, environment }))
                  }
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

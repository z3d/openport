import { useEffect, useMemo, useState } from "react";
import {
  ActivityLogIcon,
  ArchiveIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  CounterClockwiseClockIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  GearIcon,
  GlobeIcon,
  PaperPlaneIcon,
  PlusCircledIcon,
  PlusIcon,
  RowsIcon,
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
};

type RequestDraft = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  body: string;
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
const REQUEST_TABS = ["Params", "Headers", "Body", "Env"] as const;
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
  valuePlaceholder = "Value"
}: {
  rows: KeyValueRow[];
  onRowsChange: (rows: KeyValueRow[]) => void;
  valuePlaceholder?: string;
}) {
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
            <input
              aria-label={valuePlaceholder}
              className="h-11 border-r border-zinc-100 bg-transparent px-3 text-sm outline-none placeholder:text-zinc-400 focus:bg-emerald-50/40"
              placeholder={valuePlaceholder}
              value={item.value}
              onChange={(event) =>
                updateRow(item.id, { value: event.target.value })
              }
            />
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
  onDeleteRequest,
  onDeleteCollection,
  onToggleCollections,
  onLoadHistory,
  onClearHistory
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
  onDeleteRequest: (collectionId: string, requestId: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onToggleCollections: () => void;
  onLoadHistory: (item: HistoryItem) => void;
  onClearHistory: () => void;
}) {
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
          <PlusCircledIcon className="size-4" />
        </IconButton>
        <IconButton
          label="New request"
          onClick={() => onNewRequest(activeCollectionId)}
        >
          <PlusIcon className="size-4" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {collectionsExpanded &&
          collections.map((collection) => (
            <div className="mb-4" key={collection.id}>
              <div className="mb-1 flex items-center gap-1">
                <button
                  className={`flex min-h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left text-xs font-semibold transition hover:bg-zinc-100 active:translate-y-px ${
                    activeCollectionId === collection.id
                      ? "bg-zinc-100 text-zinc-950"
                      : "text-zinc-500"
                  }`}
                  type="button"
                  onClick={() => onSelectCollection(collection)}
                >
                  <span className="min-w-0 truncate">{collection.name}</span>
                  <span className="font-mono text-[11px] text-zinc-400">
                    {collection.requests.length}
                  </span>
                </button>
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

    const preparedUrl = buildUrl(
      interpolate(activeRequest.url, state.environment),
      resolveRows(activeRequest.params, state.environment)
    );
    const preparedHeaders = resolveRows(
      activeRequest.headers,
      state.environment
    );
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
          onDeleteRequest={deleteRequest}
          onDeleteCollection={deleteCollection}
          onClearHistory={clearHistory}
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
                  <p className="mt-1 truncate font-mono text-xs text-zinc-500">
                    {resolvedPreview}
                  </p>
                </div>
                <span className={`method-chip ${methodClass(activeRequest.method)}`}>
                  {activeRequest.method}
                </span>
              </div>

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

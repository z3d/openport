import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

type RequestHeader = {
  key: string;
  value: string;
  enabled: boolean;
};

type ClientRequest = {
  method: string;
  url: string;
  headers: RequestHeader[];
  body: string;
  timeoutMs?: number;
};

const allowedMethods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS"
]);

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "openport",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

function registerAppProtocol() {
  protocol.handle("openport", (request) => {
    const url = new URL(request.url);
    const requestedPath =
      decodeURIComponent(url.pathname) === "/"
        ? "/index.html"
        : decodeURIComponent(url.pathname);
    const filePath = path.join(__dirname, "../dist", requestedPath);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    title: "OpenPort",
    backgroundColor: "#f7f7f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadURL("openport://app/index.html");
  }
}

function toHeaderRecord(headers: RequestHeader[]) {
  return headers.reduce<Record<string, string>>((acc, header) => {
    const key = header.key.trim();
    if (header.enabled && key) {
      acc[key] = header.value;
    }
    return acc;
  }, {});
}

ipcMain.handle("http:send", async (_event, request: ClientRequest) => {
  const method = request.method.toUpperCase();

  if (!allowedMethods.has(method)) {
    return {
      ok: false,
      error: `Unsupported method: ${request.method}`,
      durationMs: 0
    };
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return {
      ok: false,
      error: "Request URL must include a valid protocol, such as https://",
      durationMs: 0
    };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return {
      ok: false,
      error: "Only http and https requests are supported.",
      durationMs: 0
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? 60000
  );
  const startedAt = performance.now();

  try {
    const requestInit: Parameters<typeof fetch>[1] = {
      method,
      headers: toHeaderRecord(request.headers),
      redirect: "follow",
      signal: controller.signal
    };

    if (!["GET", "HEAD"].includes(method) && request.body.trim()) {
      requestInit.body = request.body;
    }

    const response = await fetch(url, requestInit);
    const buffer = await response.arrayBuffer();
    const body = new TextDecoder().decode(buffer);
    const durationMs = Math.round(performance.now() - startedAt);

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      durationMs,
      sizeBytes: buffer.byteLength
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Request timed out."
        : error instanceof Error
          ? error.message
          : "Request failed.";

    return {
      ok: false,
      error: message,
      durationMs
    };
  } finally {
    clearTimeout(timeout);
  }
});

app.whenReady().then(() => {
  registerAppProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

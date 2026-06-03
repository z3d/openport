# OpenPort

OpenPort is an MIT-licensed desktop HTTP client built with Electron, React, TypeScript, Vite, and Tailwind CSS.

It is a local-first alternative for API request building: collections, history, headers, query params, raw bodies, environment variables, and response inspection live on your machine.

## Features

- **Collections & history** — organize saved requests and replay recent calls.
- **Environments** — global and per-request variables, with maskable secrets.
- **Request building** — methods, query params, headers, raw bodies, and `{{variable}}` interpolation with live preview.
- **Authentication**
  - No auth, Bearer token, Basic auth, and API key (header or query).
  - **OAuth 2.0** with the Authorization Code, Authorization Code + PKCE, Client Credentials, and Password Credentials grants. Fetched access tokens are cached, auto-refreshed (using the `refresh_token` grant when available), and applied as the request's `Authorization` header. Interactive grants open a desktop popup for the login redirect.
- **cURL import** — paste a `curl` command to populate a request.
- **Import / export** — move collections in and out as JSON.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Package For Windows

```bash
npm run dist:win
```

The Windows installer and portable executable are written to `release/` when Electron Builder can complete on the host machine. A portable x64 build can also be distributed as a zip: unzip it on Windows and run `OpenPort.exe`.

## Project Shape

- `electron/` contains the desktop shell, secure preload bridge, and network IPC.
- `src/` contains the React app.
- Request data is stored in browser local storage for now.

## Why This Exists

API clients should be fast, inspectable, and boring in the best possible way. This project starts there.

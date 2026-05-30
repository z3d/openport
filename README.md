# OpenPort

OpenPort is an MIT-licensed desktop HTTP client built with Electron, React, TypeScript, Vite, and Tailwind CSS.

It is a local-first alternative for API request building: collections, history, headers, query params, raw bodies, environment variables, and response inspection live on your machine.

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

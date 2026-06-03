import { contextBridge, ipcRenderer } from "electron";

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

contextBridge.exposeInMainWorld("openPort", {
  sendRequest: (request: ClientRequest) => ipcRenderer.invoke("http:send", request),
  authorize: (options: { authUrl: string; redirectUri: string }) =>
    ipcRenderer.invoke("oauth:authorize", options)
});

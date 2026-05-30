/// <reference types="vite/client" />

type OpenPortHeader = {
  key: string;
  value: string;
  enabled: boolean;
};

type OpenPortRequest = {
  method: string;
  url: string;
  headers: OpenPortHeader[];
  body: string;
  timeoutMs?: number;
};

type OpenPortResponse =
  | {
      ok: true;
      status: number;
      statusText: string;
      url: string;
      headers: Record<string, string>;
      body: string;
      durationMs: number;
      sizeBytes: number;
    }
  | {
      ok: false;
      error: string;
      durationMs: number;
    };

interface Window {
  openPort?: {
    sendRequest: (request: OpenPortRequest) => Promise<OpenPortResponse>;
  };
}

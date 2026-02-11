import { useState, useCallback } from "react";

const GATEWAY_BASE = "http://127.0.0.1:18789";

interface GatewayOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Hook for making Gateway HTTP API calls */
export function useGateway<T>() {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async (path: string, options: GatewayOptions = {}): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        const url = `${GATEWAY_BASE}${path}`;
        const fetchOptions: RequestInit = {
          method: options.method || "GET",
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
        };

        if (options.body !== undefined) {
          fetchOptions.body = JSON.stringify(options.body);
        }

        const resp = await fetch(url, fetchOptions);

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Gateway error (${resp.status}): ${text}`);
        }

        const result = (await resp.json()) as T;
        setData(result);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const get = useCallback(
    (path: string) => request(path, { method: "GET" }),
    [request]
  );

  const post = useCallback(
    (path: string, body?: unknown) =>
      request(path, { method: "POST", body }),
    [request]
  );

  const put = useCallback(
    (path: string, body?: unknown) =>
      request(path, { method: "PUT", body }),
    [request]
  );

  const del = useCallback(
    (path: string) => request(path, { method: "DELETE" }),
    [request]
  );

  return { data, loading, error, request, get, post, put, del };
}

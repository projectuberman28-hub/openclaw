import { useState, useEffect, useRef, useCallback } from "react";
import type { ServiceStatus } from "../lib/protocol";
import { tauriInvoke } from "./useTauri";

interface HealthState {
  services: ServiceStatus[];
  gatewayConnected: boolean;
  ollamaConnected: boolean;
  lastChecked: Date | null;
}

/** Poll service health at regular intervals */
export function useHealth(intervalMs = 10000) {
  const [health, setHealth] = useState<HealthState>({
    services: [],
    gatewayConnected: false,
    ollamaConnected: false,
    lastChecked: null,
  });
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const check = useCallback(async () => {
    setLoading(true);
    try {
      const services = await tauriInvoke<ServiceStatus[]>(
        "get_services_status"
      );

      const gatewayService = services.find((s) => s.name === "Gateway");
      const ollamaService = services.find((s) => s.name === "Ollama");

      setHealth({
        services,
        gatewayConnected: gatewayService?.running ?? false,
        ollamaConnected: ollamaService?.running ?? false,
        lastChecked: new Date(),
      });
    } catch {
      // Services may not be available yet
      setHealth((prev) => ({
        ...prev,
        lastChecked: new Date(),
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [check, intervalMs]);

  return { ...health, loading, refresh: check };
}

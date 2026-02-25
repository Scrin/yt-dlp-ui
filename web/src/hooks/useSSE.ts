import { useEffect, useRef, useCallback, useState } from "react";
import type { Job, SSEEvent } from "../types";

export function useSSE() {
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource("/api/events");
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);
        setJobs((prev) => {
          const next = new Map(prev);
          if (event.type === "job:removed") {
            next.delete(event.job.id);
          } else {
            next.set(event.job.id, event.job);
          }
          return next;
        });
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 2 seconds
      setTimeout(connect, 2000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
    };
  }, [connect]);

  return { jobs, connected };
}

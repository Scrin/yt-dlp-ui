import { useEffect, useRef, useState } from "react";
import type { Job, SSEEvent } from "../types";

// useSSE subscribes to the server's Server-Sent Events stream (/api/events)
// and maintains a live Map of jobs keyed by id. On connection error it
// reconnects with a 2-second backoff. Pending reconnect timers and open
// EventSource connections are cleaned up on unmount so the hook is safe in
// React StrictMode (where effects run twice in development).
export function useSSE(): { jobs: Map<string, Job>; connected: boolean } {
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // connect is defined inside the effect so it can recurse via setTimeout
    // without the function self-referencing its own `const` binding (which
    // ESLint's react-hooks/immutability flags).
    const connect = () => {
      if (cancelled) return;
      esRef.current?.close();

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
          // Ignore malformed events; state will self-correct on reconnect.
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  return { jobs, connected };
}

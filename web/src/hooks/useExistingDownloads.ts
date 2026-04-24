import { useEffect, useMemo, useState } from "react";
import type { FileInfo } from "../types";
import { listFiles } from "../lib/api";
import { extractVideoId } from "../lib/filenameId";

// useExistingDownloads fetches the downloads directory once on mount and
// groups files by parsed video id so pickers can show "already downloaded"
// indicators. Snapshot-only: it does not refresh live — the picker is short-
// lived and the underlying data rarely changes while a picker is open.
// `loaded` flips true once the fetch resolves (success or failure), so
// callers can defer derived state like default selections until the real
// snapshot is available.
export function useExistingDownloads(): {
  byId: Map<string, FileInfo[]>;
  loaded: boolean;
} {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listFiles()
      .then((data) => {
        if (!cancelled) {
          setFiles(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        // Best-effort: if listing fails, pickers simply show nothing as
        // already-downloaded. Not worth surfacing an error.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, FileInfo[]>();
    for (const f of files) {
      const id = extractVideoId(f.name);
      if (!id) continue;
      const list = m.get(id);
      if (list) list.push(f);
      else m.set(id, [f]);
    }
    return m;
  }, [files]);

  return { byId, loaded };
}

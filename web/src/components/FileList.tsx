import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { FileInfo } from "../types";
import { listFiles, deleteFile } from "../lib/api";

interface Props {
  refreshTrigger: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FileList({ refreshTrigger }: Props) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const data = await listFiles();
      setFiles(data);
    } catch {
      // Silently fail — will retry
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll when there are active downloads
  useEffect(() => {
    if (!refreshTrigger) return;
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [refreshTrigger, refresh]);

  // Also refresh when active downloads finish
  useEffect(() => {
    if (!refreshTrigger) {
      refresh();
    }
  }, [refreshTrigger, refresh]);

  const handleDelete = useCallback(
    async (name: string) => {
      setDeleting((prev) => new Set(prev).add(name));
      try {
        await deleteFile(name);
        setFiles((prev) => prev.filter((f) => f.name !== name));
      } catch {
        // Silently fail — file list will self-correct on next refresh
      } finally {
        setDeleting((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    },
    []
  );

  if (loading) return null;
  if (files.length === 0) return null;

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
        Files
      </h2>
      <div className="space-y-1">
        <AnimatePresence mode="popLayout">
          {files.map((file) => (
            <motion.div
              key={file.name}
              layout
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-900"
            >
              <a
                href={`/files/${encodeURIComponent(file.name)}`}
                download
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {file.name}
                </span>
                <span className="flex-shrink-0 text-xs text-zinc-500">
                  {formatBytes(file.size)}
                </span>
                <span className="flex-shrink-0 text-xs text-zinc-600">
                  {formatDate(file.mod_time)}
                </span>
              </a>
              <button
                onClick={() => handleDelete(file.name)}
                disabled={deleting.has(file.name)}
                className="flex-shrink-0 rounded p-1 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
                title="Delete file"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

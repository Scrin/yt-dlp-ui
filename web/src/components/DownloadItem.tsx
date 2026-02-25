import { motion } from "framer-motion";
import type { Job } from "../types";
import { ProgressBar } from "./ProgressBar";
import { cancelDownload } from "../lib/api";

interface Props {
  job: Job;
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

function formatETA(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

const statusConfig: Record<
  string,
  { label: string; color: string }
> = {
  queued: { label: "Queued", color: "bg-zinc-600" },
  downloading: { label: "Downloading", color: "bg-blue-500" },
  processing: { label: "Processing", color: "bg-yellow-500" },
  complete: { label: "Complete", color: "bg-emerald-500" },
  error: { label: "Error", color: "bg-red-500" },
  cancelled: { label: "Cancelled", color: "bg-zinc-600" },
};

export function DownloadItem({ job }: Props) {
  const status = statusConfig[job.status] || statusConfig.queued;
  const isActive = job.status === "downloading" || job.status === "processing" || job.status === "queued";

  const handleCancel = async () => {
    try {
      await cancelDownload(job.id);
    } catch {
      // Ignore cancel errors
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {job.title || job.url}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white ${status.color}`}
          >
            {status.label}
          </span>
          {isActive && (
            <button
              onClick={handleCancel}
              className="text-xs text-zinc-500 transition-colors hover:text-red-400"
              title="Cancel download"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {job.status === "downloading" && (
        <>
          <ProgressBar percent={job.progress.percent} />
          <div className="mt-1.5 flex justify-between text-xs text-zinc-500">
            <span>{job.progress.percent.toFixed(1)}%</span>
            <span>
              {formatSpeed(job.progress.speed)}
              {job.progress.eta > 0 && ` · ETA ${formatETA(job.progress.eta)}`}
            </span>
          </div>
        </>
      )}

      {job.status === "processing" && (
        <div className="mt-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-yellow-500"
              animate={{ x: ["-100%", "100%"] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              style={{ width: "40%" }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">Post-processing...</p>
        </div>
      )}

      {job.status === "complete" && job.filename && (
        <a
          href={`/files/${encodeURIComponent(job.filename)}`}
          download
          className="mt-1 inline-block text-xs text-emerald-400 transition-colors hover:text-emerald-300"
        >
          {job.filename}
        </a>
      )}

      {job.status === "error" && job.error && (
        <p className="mt-1 text-xs text-red-400">{job.error}</p>
      )}
    </motion.div>
  );
}

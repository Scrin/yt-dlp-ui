import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { VideoInfo, Format } from "../types";
import { startDownload } from "../lib/api";

interface Props {
  videoInfo: VideoInfo;
  onClose: () => void;
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type FormatGroup = "video" | "audio";

function classifyFormat(f: Format): FormatGroup {
  const hasVideo = f.vcodec && f.vcodec !== "none";
  if (hasVideo) return "video";
  return "audio";
}

function filterUsableFormats(formats: Format[]): Format[] {
  return formats.filter((f) => {
    // Skip formats with no useful codec info or storyboard/manifests
    if (f.protocol === "mhtml" || f.protocol === "m3u8_native") return false;
    if (f.format_note?.toLowerCase().includes("storyboard")) return false;
    const hasVideo = f.vcodec && f.vcodec !== "none";
    const hasAudio = f.acodec && f.acodec !== "none";
    return hasVideo || hasAudio;
  });
}

export function FormatPicker({ videoInfo, onClose }: Props) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usable = filterUsableFormats(videoInfo.formats);
  const groups: Record<FormatGroup, Format[]> = { video: [], audio: [] };
  for (const f of usable) {
    groups[classifyFormat(f)].push(f);
  }

  // Sort video by height desc, audio by abr desc
  groups.video.sort((a, b) => (b.height || 0) - (a.height || 0));
  groups.audio.sort((a, b) => (b.abr || 0) - (a.abr || 0));

  const handleDownload = async (format: Format) => {
    setDownloading(format.format_id);
    setError(null);
    try {
      await startDownload(videoInfo.webpage_url, format, videoInfo.title);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start download");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="rounded-xl border border-zinc-800 bg-zinc-900 p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{videoInfo.title}</h2>
            <p className="text-sm text-zinc-500">
              {videoInfo.uploader}
              {videoInfo.duration > 0 && ` · ${formatDuration(videoInfo.duration)}`}
            </p>
          </div>
          {videoInfo.thumbnail && (
            <img
              src={videoInfo.thumbnail}
              alt=""
              className="h-16 w-28 flex-shrink-0 rounded-lg object-cover"
            />
          )}
          <button
            onClick={onClose}
            className="flex-shrink-0 text-zinc-500 transition-colors hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-3 text-sm text-red-400"
          >
            {error}
          </motion.p>
        )}

        {(["video", "audio"] as FormatGroup[]).map(
          (group) =>
            groups[group].length > 0 && (
              <div key={group} className="mb-4 last:mb-0">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  {group === "video" ? "Video" : "Audio Only"}
                </h3>
                <div className="space-y-1">
                  {groups[group].map((f) => (
                    <FormatRow
                      key={f.format_id}
                      format={f}
                      group={group}
                      loading={downloading === f.format_id}
                      onDownload={() => handleDownload(f)}
                    />
                  ))}
                </div>
              </div>
            )
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function FormatRow({
  format: f,
  group,
  loading,
  onDownload,
}: {
  format: Format;
  group: FormatGroup;
  loading: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-800/50">
      <div className="min-w-0 flex-1">
        <span className="font-mono text-sm">
          {group === "video" ? (
            <>
              {f.height ? `${f.height}p` : f.resolution}
              {f.fps ? ` ${Math.round(f.fps)}fps` : ""}
            </>
          ) : (
            <>
              {f.abr ? `${Math.round(f.abr)}kbps` : f.format_note}
            </>
          )}
        </span>
        <span className="ml-2 text-xs text-zinc-500">
          {f.ext}
          {f.vcodec && f.vcodec !== "none" && ` · ${f.vcodec}`}
          {f.acodec && f.acodec !== "none" && ` · ${f.acodec}`}
        </span>
      </div>
      <span className="text-xs text-zinc-500">{formatBytes(f.filesize)}</span>
      <motion.button
        onClick={onDownload}
        disabled={loading}
        className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
        whileTap={{ scale: 0.95 }}
      >
        {loading ? "..." : "Download"}
      </motion.button>
    </div>
  );
}

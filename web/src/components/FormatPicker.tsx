import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { VideoInfo, Format } from "../types";
import { startDownload } from "../lib/api";
import { useExistingDownloads } from "../hooks/useExistingDownloads";
import { extractQualityTag } from "../lib/filenameId";

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

function hasAudio(f: Format): boolean {
  return Boolean(f.acodec && f.acodec !== "none");
}

function filterUsableFormats(formats: Format[]): Format[] {
  return formats.filter((f) => {
    // Skip formats with no useful codec info or storyboard/manifests
    if (f.protocol === "mhtml" || f.protocol === "m3u8_native") return false;
    if (f.format_note?.toLowerCase().includes("storyboard")) return false;
    const hasVideoCodec = f.vcodec && f.vcodec !== "none";
    const hasAudioCodec = f.acodec && f.acodec !== "none";
    return hasVideoCodec || hasAudioCodec;
  });
}

function describeVideo(f: Format): string {
  const parts: string[] = [];
  if (f.height) parts.push(`${f.height}p`);
  else if (f.resolution) parts.push(f.resolution);
  if (f.vcodec && f.vcodec !== "none") parts.push(f.vcodec);
  return parts.join(" ");
}

function describeAudio(f: Format): string {
  const parts: string[] = [];
  if (f.abr) parts.push(`${Math.round(f.abr)}kbps`);
  if (f.acodec && f.acodec !== "none") parts.push(f.acodec);
  return parts.join(" ");
}

export function FormatPicker({ videoInfo, onClose }: Props) {
  const groups = useMemo(() => {
    const usable = filterUsableFormats(videoInfo.formats);
    const g: Record<FormatGroup, Format[]> = { video: [], audio: [] };
    for (const f of usable) g[classifyFormat(f)].push(f);
    g.video.sort((a, b) => (b.height || 0) - (a.height || 0));
    g.audio.sort((a, b) => (b.abr || 0) - (a.abr || 0));
    return g;
  }, [videoInfo.formats]);

  const { byId: existingByID } = useExistingDownloads();
  const existingForThisVideo = existingByID.get(videoInfo.id) ?? [];

  // On mount, preselect sensible defaults: top video, plus top audio only when
  // the top video is video-only (combined videos already carry audio).
  // `null` is a valid selection meaning the user explicitly wants no video/audio.
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(
    () => groups.video[0]?.format_id ?? null
  );
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(() => {
    const topVideo = groups.video[0];
    const topAudio = groups.audio[0];
    if (!topAudio) return null;
    if (!topVideo) return topAudio.format_id;
    return hasAudio(topVideo) ? null : topAudio.format_id;
  });

  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedVideo = groups.video.find((f) => f.format_id === selectedVideoId) ?? null;
  const selectedAudio = groups.audio.find((f) => f.format_id === selectedAudioId) ?? null;
  const willBeSilent = selectedVideo !== null && !hasAudio(selectedVideo) && selectedAudio === null;
  const canDownload = (selectedVideo !== null || selectedAudio !== null) && !downloading;

  const summary =
    [selectedVideo && describeVideo(selectedVideo), selectedAudio && describeAudio(selectedAudio)]
      .filter(Boolean)
      .join(" + ") || "Nothing selected";

  const handleSelect = (group: FormatGroup, formatId: string | null) => {
    if (group === "video") {
      setSelectedVideoId(formatId);
    } else {
      setSelectedAudioId(formatId);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      await startDownload(videoInfo.webpage_url, selectedVideo, selectedAudio, videoInfo.title);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start download");
    } finally {
      setDownloading(false);
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

        {existingForThisVideo.length > 0 && (
          <div className="mb-4 rounded-lg border border-emerald-950 bg-emerald-950/30 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">
              Already downloaded
            </p>
            <ul className="mt-1.5 space-y-1">
              {existingForThisVideo.map((f) => {
                const tag = extractQualityTag(f.name);
                return (
                  <li key={f.name} className="flex items-center gap-2 text-sm">
                    <a
                      href={`/files/${encodeURIComponent(f.name)}`}
                      download
                      title={f.name}
                      className="min-w-0 flex-1 truncate font-mono text-xs text-emerald-300 hover:text-emerald-200"
                    >
                      {tag ?? f.name}
                    </a>
                    <span className="flex-shrink-0 text-xs text-zinc-500">
                      {formatBytes(f.size)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[11px] text-zinc-500">
              You can still download a different version below.
            </p>
          </div>
        )}

        {(["video", "audio"] as FormatGroup[]).map((group) => {
          if (groups[group].length === 0) return null;
          const otherGroup: FormatGroup = group === "video" ? "audio" : "video";
          // Only offer a "None" opt-out when the other group has real options —
          // otherwise opting out would leave nothing to download.
          const showNone = groups[otherGroup].length > 0;
          const selectedId = group === "video" ? selectedVideoId : selectedAudioId;
          return (
            <div key={group} className="mb-4 last:mb-0" role="radiogroup">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                {group === "video" ? "Video" : "Audio"}
              </h3>
              <div className="space-y-1">
                {showNone && (
                  <NoneRow
                    label={group === "video" ? "No video (audio only)" : "No audio (silent)"}
                    selected={selectedId === null}
                    onSelect={() => handleSelect(group, null)}
                  />
                )}
                {groups[group].map((f) => (
                  <FormatRow
                    key={f.format_id}
                    format={f}
                    group={group}
                    selected={selectedId === f.format_id}
                    onSelect={() => handleSelect(group, f.format_id)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div className="mt-5 flex items-center gap-3 border-t border-zinc-800 pt-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm text-zinc-300">{summary}</p>
            {willBeSilent && (
              <p className="mt-0.5 text-xs text-amber-400">
                No audio selected — file will be silent
              </p>
            )}
            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-0.5 text-xs text-red-400"
              >
                {error}
              </motion.p>
            )}
          </div>
          <motion.button
            onClick={handleDownload}
            disabled={!canDownload}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            whileTap={canDownload ? { scale: 0.95 } : undefined}
          >
            {downloading ? "Starting..." : "Download"}
          </motion.button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function NoneRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
        selected ? "bg-zinc-800 ring-1 ring-zinc-600" : "hover:bg-zinc-800/50"
      }`}
    >
      <span
        className={`h-3 w-3 flex-shrink-0 rounded-full border ${
          selected ? "border-zinc-200 bg-zinc-200" : "border-zinc-600"
        }`}
        aria-hidden="true"
      />
      <span className="flex-1 text-sm italic text-zinc-400">{label}</span>
    </button>
  );
}

function FormatRow({
  format: f,
  group,
  selected,
  onSelect,
}: {
  format: Format;
  group: FormatGroup;
  selected: boolean;
  onSelect: () => void;
}) {
  const embeddedAudio = group === "video" && hasAudio(f);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
        selected
          ? "bg-zinc-800 ring-1 ring-zinc-600"
          : "hover:bg-zinc-800/50"
      }`}
    >
      <span
        className={`h-3 w-3 flex-shrink-0 rounded-full border ${
          selected ? "border-zinc-200 bg-zinc-200" : "border-zinc-600"
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-sm">
          {group === "video" ? (
            <>
              {f.height ? `${f.height}p` : f.resolution}
              {f.fps ? ` ${Math.round(f.fps)}fps` : ""}
            </>
          ) : (
            <>{f.abr ? `${Math.round(f.abr)}kbps` : f.format_note}</>
          )}
        </span>
        <span className="ml-2 text-xs text-zinc-500">
          {f.ext}
          {f.vcodec && f.vcodec !== "none" && ` · ${f.vcodec}`}
          {f.acodec && f.acodec !== "none" && ` · ${f.acodec}`}
        </span>
        {embeddedAudio && (
          <span className="ml-2 rounded-full border border-emerald-800 bg-emerald-950 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
            includes audio
          </span>
        )}
      </div>
      <span className="text-xs text-zinc-500">{formatBytes(f.filesize)}</span>
    </button>
  );
}

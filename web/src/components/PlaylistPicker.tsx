import { memo, useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PlaylistInfo } from "../types";
import { startPlaylistItemDownload } from "../lib/api";

interface Props {
  playlist: PlaylistInfo;
  onClose: () => void;
}

interface Profile {
  id: string;
  label: string;
  description: string;
  selector: string;
}

// yt-dlp format selectors for common codec preferences.
//
// CONSISTENCY CONTRACT: each codec-specific profile must name in the
// filename exactly what was downloaded. We use `bv[filter]+ba[filter]` (no
// star) in the primary branch so yt-dlp always picks a video-only + audio-only
// pair and merges them, producing predictable `<height>p_<vcodec>_<acodec>`
// filenames via buildQualityTag. The star form `bv*/ba*` can match combined
// streams and confuses the merge logic (yt-dlp may return only the video
// stream for some codec/site combinations — see commit history for the H.264
// incident). The trailing `/b` branches are universal fallbacks.
const PROFILES: Profile[] = [
  {
    id: "vp9-opus",
    label: "VP9 + Opus (best for YouTube)",
    description: "Prefers VP9 video + Opus audio; falls back to best available.",
    selector: "bv[vcodec^=vp9]+ba[acodec^=opus]/bv*+ba*/b",
  },
  {
    id: "av1-opus",
    label: "AV1 + Opus (smaller files, newer)",
    description: "Prefers AV1 video + Opus audio; falls back to best available.",
    selector: "bv[vcodec^=av01]+ba[acodec^=opus]/bv*+ba*/b",
  },
  {
    id: "h264-aac",
    label: "H.264 + AAC (mp4 compatibility)",
    description: "Prefers H.264 video + AAC audio in an mp4 container; broadest device support.",
    selector: "bv[vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4]/b",
  },
  {
    id: "best",
    label: "Best available (any codec)",
    description: "Best video + best audio regardless of codec.",
    selector: "bv*+ba*/b",
  },
  {
    id: "audio-opus",
    label: "Audio only — Opus",
    description: "Best Opus audio track; falls back to best available audio.",
    selector: "ba*[acodec^=opus]/ba*/b",
  },
  {
    id: "audio-m4a",
    label: "Audio only — AAC/m4a",
    description: "Best m4a/AAC audio; falls back to best available audio.",
    selector: "ba*[ext=m4a]/ba*/b",
  },
];

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlaylistPicker({ playlist, onClose }: Props) {
  const [profileId, setProfileId] = useState<string>(PROFILES[0].id);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customSelector, setCustomSelector] = useState("");

  // Deduplicate by video id. YouTube Mix ("list=RD...") playlists routinely
  // include the same video at multiple positions; without dedup a single
  // user selection would submit N downloads for the same video.
  const entries = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof playlist.entries = [];
    for (const e of playlist.entries) {
      if (!e.id || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  }, [playlist.entries]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(entries.map((e) => e.id))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const profile = useMemo(
    () => PROFILES.find((p) => p.id === profileId) ?? PROFILES[0],
    [profileId]
  );

  const effectiveSelector = customSelector.trim() || profile.selector;

  // useCallback so EntryRow's onToggle reference is stable across renders,
  // letting React.memo skip re-rendering rows whose `selected` didn't change.
  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    () => setSelectedIds(new Set(entries.map((e) => e.id))),
    [entries]
  );
  const selectNone = useCallback(() => setSelectedIds(new Set()), []);

  const handleDownload = async () => {
    const toDownload = entries.filter((e) => selectedIds.has(e.id));
    if (toDownload.length === 0) return;

    setSubmitting(true);
    setError(null);
    setProgress({ done: 0, total: toDownload.length });

    try {
      for (let i = 0; i < toDownload.length; i++) {
        const entry = toDownload[i];
        await startPlaylistItemDownload(
          entry.url,
          effectiveSelector,
          entry.title,
          playlist.title
        );
        setProgress({ done: i + 1, total: toDownload.length });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit playlist");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCount = selectedIds.size;
  const canSubmit = selectedCount > 0 && !submitting && effectiveSelector.length > 0;

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
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Playlist
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold">{playlist.title}</h2>
            <p className="text-sm text-zinc-500">
              {playlist.uploader}
              {playlist.uploader && " · "}
              {entries.length} videos
              {entries.length !== playlist.entries.length &&
                ` (${playlist.entries.length - entries.length} duplicates hidden)`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-zinc-500 transition-colors hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        <div className="mb-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Codec preference
          </h3>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={submitting}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
          >
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">{profile.description}</p>

          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="mt-2 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            {advancedOpen ? "▾" : "▸"} Advanced — custom yt-dlp -f selector
          </button>
          {advancedOpen && (
            <div className="mt-2 space-y-1">
              <input
                type="text"
                value={customSelector}
                onChange={(e) => setCustomSelector(e.target.value)}
                placeholder={profile.selector}
                disabled={submitting}
                spellCheck={false}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs outline-none focus:border-zinc-600"
              />
              <p className="text-xs text-zinc-500">
                Overrides the profile above when non-empty. Passed directly to{" "}
                <code className="text-zinc-400">yt-dlp -f</code>.
              </p>
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Videos ({selectedCount}/{entries.length} selected)
            </h3>
            <div className="flex gap-3 text-xs">
              <button
                onClick={selectAll}
                disabled={submitting}
                className="text-zinc-500 transition-colors hover:text-zinc-300"
              >
                All
              </button>
              <button
                onClick={selectNone}
                disabled={submitting}
                className="text-zinc-500 transition-colors hover:text-zinc-300"
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            {entries.map((entry, idx) => (
              <EntryRow
                key={entry.id}
                id={entry.id}
                index={idx}
                title={entry.title}
                duration={entry.duration}
                selected={selectedIds.has(entry.id)}
                disabled={submitting}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-zinc-800 pt-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-zinc-500">
              -f {effectiveSelector}
            </p>
            {progress && submitting && (
              <p className="mt-0.5 text-xs text-zinc-400">
                Queuing {progress.done}/{progress.total}...
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
            disabled={!canSubmit}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            whileTap={canSubmit ? { scale: 0.95 } : undefined}
          >
            {submitting
              ? "Queuing..."
              : `Download ${selectedCount} ${selectedCount === 1 ? "video" : "videos"}`}
          </motion.button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Memoized so toggling one checkbox in a 1000-row playlist only re-renders
// that single row, not the whole list.
const EntryRow = memo(function EntryRow({
  id,
  index,
  title,
  duration,
  selected,
  disabled,
  onToggle,
}: {
  id: string;
  index: number;
  title: string;
  duration: number;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors ${
        selected ? "bg-zinc-800" : "hover:bg-zinc-800/50"
      }`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "32px" }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(id)}
        disabled={disabled}
        className="h-4 w-4 flex-shrink-0 accent-zinc-200"
      />
      <span className="w-8 flex-shrink-0 text-right font-mono text-xs text-zinc-600">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {duration > 0 && (
        <span className="flex-shrink-0 font-mono text-xs text-zinc-500">
          {formatDuration(duration)}
        </span>
      )}
    </label>
  );
});

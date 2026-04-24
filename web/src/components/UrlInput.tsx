import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { ResolveResult } from "../types";
import { resolveUrl, type ResolveMode } from "../lib/api";

interface Props {
  onResult: (result: ResolveResult) => void;
}

// A URL is ambiguous when it carries both a video id (`v`) and a playlist id
// (`list`) — e.g. `watch?v=X&list=Y` or YouTube Mix `&list=RD...` URLs. yt-dlp
// needs --no-playlist / --yes-playlist to resolve the user's intent.
function isAmbiguousUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.searchParams.has("v") && u.searchParams.has("list");
  } catch {
    return false;
  }
}

export function UrlInput({ onResult }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState<ResolveMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedUrl = url.trim();
  const ambiguous = useMemo(() => isAmbiguousUrl(trimmedUrl), [trimmedUrl]);

  const fetch = async (mode: ResolveMode) => {
    if (!trimmedUrl || loading) return;
    setLoading(mode);
    setError(null);
    try {
      const result = await resolveUrl(trimmedUrl, mode);
      onResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve URL");
    } finally {
      setLoading(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ambiguous) return; // user must pick a specific button
    fetch("");
  };

  const spinner = (
    <motion.span
      className="inline-block"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    >
      ⟳
    </motion.span>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a video, audio, or playlist URL..."
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600"
          disabled={loading !== null}
        />
        {ambiguous ? (
          <>
            <motion.button
              type="button"
              onClick={() => fetch("video")}
              disabled={!trimmedUrl || loading !== null}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
              whileTap={{ scale: 0.97 }}
              title="Download just this video"
            >
              {loading === "video" ? spinner : "Video"}
            </motion.button>
            <motion.button
              type="button"
              onClick={() => fetch("playlist")}
              disabled={!trimmedUrl || loading !== null}
              className="rounded-lg bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              whileTap={{ scale: 0.97 }}
              title="Download the entire playlist"
            >
              {loading === "playlist" ? spinner : "Playlist"}
            </motion.button>
          </>
        ) : (
          <motion.button
            type="submit"
            disabled={!trimmedUrl || loading !== null}
            className="rounded-lg bg-zinc-100 px-6 py-3 font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            whileTap={{ scale: 0.97 }}
          >
            {loading !== null ? spinner : "Fetch"}
          </motion.button>
        )}
      </div>

      {ambiguous && (
        <p className="text-xs text-zinc-500">
          This URL contains both a video and a playlist — pick which one to download.
        </p>
      )}

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm text-red-400"
        >
          {error}
        </motion.p>
      )}
    </form>
  );
}

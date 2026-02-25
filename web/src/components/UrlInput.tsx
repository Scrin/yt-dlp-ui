import { useState } from "react";
import { motion } from "framer-motion";
import type { VideoInfo } from "../types";
import { fetchFormats } from "../lib/api";

interface Props {
  onResult: (info: VideoInfo) => void;
}

export function UrlInput({ onResult }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const info = await fetchFormats(url.trim());
      onResult(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch formats");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste video or audio URL..."
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600"
          disabled={loading}
        />
        <motion.button
          type="submit"
          disabled={!url.trim() || loading}
          className="rounded-lg bg-zinc-100 px-6 py-3 font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          whileTap={{ scale: 0.97 }}
        >
          {loading ? (
            <motion.span
              className="inline-block"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            >
              ⟳
            </motion.span>
          ) : (
            "Fetch Formats"
          )}
        </motion.button>
      </div>

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

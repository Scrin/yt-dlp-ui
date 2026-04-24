// Helpers for parsing the download filename contract:
//   <title>_[<id>]_<tag>.<ext>
// The title is yt-dlp-sanitized via --restrict-filenames, so brackets inside
// it are rare, but not guaranteed impossible — so we scan from the end to
// anchor on the id/tag boundary unambiguously.

// extractVideoId returns the `<id>` portion or null if the filename does not
// conform (e.g., `.tmp.` in-progress files lack the `_<tag>` section but
// still have `[<id>]`, which is fine — this still extracts correctly).
export function extractVideoId(filename: string): string | null {
  const endBracket = filename.lastIndexOf("]");
  if (endBracket < 0) return null;
  const startBracket = filename.lastIndexOf("[", endBracket);
  if (startBracket < 0) return null;
  const id = filename.slice(startBracket + 1, endBracket);
  return id.length > 0 ? id : null;
}

// extractQualityTag returns the `<tag>` portion (e.g., "1080p_vp9_opus"), or
// null if absent (e.g., `.tmp.*` files before the post-download rename).
export function extractQualityTag(filename: string): string | null {
  const anchor = filename.lastIndexOf("]_");
  if (anchor < 0) return null;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= anchor) return null;
  return filename.slice(anchor + 2, lastDot);
}

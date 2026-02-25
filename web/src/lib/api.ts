import type { VideoInfo, Job, FileInfo, Format } from "../types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function fetchFormats(url: string): Promise<VideoInfo> {
  return request<VideoInfo>("/api/formats", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function startDownload(
  url: string,
  format: Format,
  title: string
): Promise<Job> {
  return request<Job>("/api/downloads", {
    method: "POST",
    body: JSON.stringify({
      url,
      format_id: format.format_id,
      title,
      height: format.height,
      vcodec: format.vcodec,
      acodec: format.acodec,
      abr: format.abr,
    }),
  });
}

export async function listDownloads(): Promise<Job[]> {
  return request<Job[]>("/api/downloads");
}

export async function cancelDownload(id: string): Promise<void> {
  await request<unknown>(`/api/downloads/${id}`, { method: "DELETE" });
}

export async function listFiles(): Promise<FileInfo[]> {
  return request<FileInfo[]>("/api/files");
}

export async function deleteFile(name: string): Promise<void> {
  await request<unknown>(`/api/files/${encodeURIComponent(name)}`, { method: "DELETE" });
}

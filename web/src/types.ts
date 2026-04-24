export interface VideoInfo {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  webpage_url: string;
  formats: Format[];
}

export interface PlaylistEntry {
  id: string;
  url: string;
  title: string;
  duration: number;
}

export interface PlaylistInfo {
  id: string;
  title: string;
  uploader: string;
  entries: PlaylistEntry[];
}

export type ResolveResult =
  | { type: "video"; video: VideoInfo }
  | { type: "playlist"; playlist: PlaylistInfo };

export interface Format {
  format_id: string;
  ext: string;
  resolution: string;
  width: number;
  height: number;
  fps: number;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  filesize_approx_str?: string;
  tbr: number;
  abr: number;
  vbr: number;
  format_note: string;
  protocol: string;
}

export type JobStatus =
  | "queued"
  | "downloading"
  | "processing"
  | "complete"
  | "error"
  | "cancelled";

export interface JobProgress {
  percent: number;
  speed: number;
  eta: number;
  elapsed: number;
  file_size: number;
}

export interface Job {
  id: string;
  url: string;
  title: string;
  format_id: string;
  status: JobStatus;
  progress: JobProgress;
  filename: string;
  error?: string;
  created_at: string;
  playlist_title?: string;
}

export interface FileInfo {
  name: string;
  size: number;
  mod_time: string;
}

export interface SSEEvent {
  type:
    | "job:init"
    | "job:created"
    | "job:progress"
    | "job:complete"
    | "job:error"
    | "job:cancelled"
    | "job:removed";
  job: Job;
}

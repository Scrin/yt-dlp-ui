import { useState } from "react";
import type { VideoInfo } from "./types";
import { useSSE } from "./hooks/useSSE";
import { UrlInput } from "./components/UrlInput";
import { FormatPicker } from "./components/FormatPicker";
import { DownloadList } from "./components/DownloadList";
import { FileList } from "./components/FileList";

function App() {
  const { jobs, connected } = useSSE();
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);

  const jobList = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const hasActiveJobs = jobList.some(
    (j) => j.status === "downloading" || j.status === "processing"
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">yt-dlp-ui</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Download video and audio files
            <span
              className={`ml-2 inline-block h-2 w-2 rounded-full ${
                connected ? "bg-emerald-500" : "bg-red-500"
              }`}
              title={connected ? "Connected" : "Disconnected"}
            />
          </p>
        </header>

        <main className="space-y-6">
          <UrlInput onResult={setVideoInfo} />

          {videoInfo && (
            <FormatPicker
              key={videoInfo.webpage_url}
              videoInfo={videoInfo}
              onClose={() => setVideoInfo(null)}
            />
          )}

          {jobList.length > 0 && <DownloadList jobs={jobList} />}

          <FileList refreshTrigger={hasActiveJobs} />
        </main>
      </div>
    </div>
  );
}

export default App;

import { AnimatePresence } from "framer-motion";
import type { Job } from "../types";
import { DownloadItem } from "./DownloadItem";

interface Props {
  jobs: Job[];
}

export function DownloadList({ jobs }: Props) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
        Downloads
      </h2>
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {jobs.map((job) => (
            <DownloadItem key={job.id} job={job} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

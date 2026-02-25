import { motion } from "framer-motion";

interface Props {
  percent: number;
}

export function ProgressBar({ percent }: Props) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <motion.div
        className="h-full rounded-full bg-emerald-500"
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      />
    </div>
  );
}

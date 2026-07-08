/** Sidebar timestamps: "just now", "8m ago", "3h ago", "2d ago". */
export const relativeTime = (iso: string, now: Date = new Date()): string => {
  const ms = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

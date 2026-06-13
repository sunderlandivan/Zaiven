import { getMoodColor } from "@/lib/alerts";
import type { ResidentDashboardRow } from "@/types";

interface ResidentCardProps {
  row: ResidentDashboardRow;
}

const moodBadgeStyles = {
  green: "bg-green-100 text-green-800 border-green-300",
  yellow: "bg-yellow-100 text-yellow-800 border-yellow-300",
  red: "bg-red-100 text-red-800 border-red-300",
  gray: "bg-gray-100 text-gray-600 border-gray-300",
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "No activity";
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ResidentCard({ row }: ResidentCardProps) {
  const { resident, lastSessionTime, todayMoodScore, weeklyEngagementMinutes, hasActiveAlert } =
    row;
  const moodColor = getMoodColor(todayMoodScore);

  return (
    <div
      className={`bg-white rounded-xl border-2 p-5 shadow-sm ${
        hasActiveAlert ? "border-red-400 ring-2 ring-red-200" : "border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">{resident.name}</h3>
          <p className="text-gray-500 mt-1">Room {resident.room_number}</p>
          {resident.cognitive_flag && (
            <span className="inline-block mt-2 px-2 py-1 text-xs font-semibold bg-purple-100 text-purple-700 rounded">
              Extra monitoring
            </span>
          )}
        </div>

        <div className="text-right shrink-0">
          <span
            className={`inline-block px-3 py-1 rounded-full text-sm font-bold border ${moodBadgeStyles[moodColor]}`}
          >
            {todayMoodScore !== null ? `Mood: ${todayMoodScore}/10` : "No mood today"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">Last Active</p>
          <p className="text-sm font-medium text-gray-800 mt-1">
            {formatRelativeTime(lastSessionTime)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">This Week</p>
          <p className="text-sm font-medium text-gray-800 mt-1">
            {weeklyEngagementMinutes} min engaged
          </p>
        </div>
      </div>

      {hasActiveAlert && (
        <p className="mt-3 text-sm font-semibold text-red-600">⚠ Active alert — needs attention</p>
      )}
    </div>
  );
}

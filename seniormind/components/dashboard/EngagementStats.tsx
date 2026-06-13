import type { ResidentDashboardRow } from "@/types";

interface EngagementStatsProps {
  rows: ResidentDashboardRow[];
}

export default function EngagementStats({ rows }: EngagementStatsProps) {
  const totalMinutes = rows.reduce((sum, r) => sum + r.weeklyEngagementMinutes, 0);
  const activeToday = rows.filter((r) => {
    if (!r.lastSessionTime) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(r.lastSessionTime) >= today;
  }).length;
  const avgMood =
    rows.filter((r) => r.todayMoodScore !== null).length > 0
      ? (
          rows.reduce((sum, r) => sum + (r.todayMoodScore ?? 0), 0) /
          rows.filter((r) => r.todayMoodScore !== null).length
        ).toFixed(1)
      : "—";

  const stats = [
    { label: "Residents", value: rows.length.toString() },
    { label: "Active Today", value: activeToday.toString() },
    { label: "Weekly Engagement", value: `${totalMinutes} min` },
    { label: "Avg Mood Today", value: avgMood },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map(({ label, value }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
          <p className="text-3xl font-bold text-seniormind-navy mt-2">{value}</p>
        </div>
      ))}
    </div>
  );
}

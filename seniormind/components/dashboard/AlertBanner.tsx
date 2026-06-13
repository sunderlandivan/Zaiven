import type { StaffAlert } from "@/types";
import type { Resident } from "@/types";

interface AlertBannerProps {
  alerts: StaffAlert[];
  residents: Resident[];
}

const alertLabels: Record<StaffAlert["alert_type"], string> = {
  mood_decline: "Mood Decline",
  nurse_call: "Nurse Call",
  no_activity: "No Activity (48h+)",
};

const alertColors: Record<StaffAlert["alert_type"], string> = {
  mood_decline: "bg-red-50 border-red-300 text-red-800",
  nurse_call: "bg-orange-50 border-orange-300 text-orange-800",
  no_activity: "bg-yellow-50 border-yellow-300 text-yellow-800",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AlertBanner({ alerts, residents }: AlertBannerProps) {
  const unresolved = alerts.filter((a) => !a.resolved_at);

  if (unresolved.length === 0) {
    return (
      <div className="bg-green-50 border-2 border-green-200 rounded-xl p-5">
        <p className="text-green-800 font-semibold">✓ No active alerts — all residents OK</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-red-700">
        Active Alerts ({unresolved.length})
      </h2>
      {unresolved.map((alert) => {
        const resident = residents.find((r) => r.id === alert.resident_id);
        return (
          <div
            key={alert.id}
            className={`border-2 rounded-xl p-4 ${alertColors[alert.alert_type]}`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-bold text-lg">
                  {alertLabels[alert.alert_type]}
                  {resident && ` — ${resident.name} (Room ${resident.room_number})`}
                </p>
                <p className="text-sm mt-1 opacity-80">{formatTime(alert.created_at)}</p>
              </div>
              <span className="text-2xl">
                {alert.alert_type === "nurse_call" ? "🛎️" : alert.alert_type === "mood_decline" ? "📉" : "⏰"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertType, MoodLog, Session } from "@/types";

const LOW_MOOD_THRESHOLD = 4;
const CONSECUTIVE_LOW_SESSIONS = 2;
const INACTIVITY_HOURS = 48;

export async function checkMoodDeclineAlert(
  supabase: SupabaseClient,
  residentId: string,
  facilityId: string
): Promise<boolean> {
  const { data: recentMoods } = await supabase
    .from("mood_logs")
    .select("mood_score, timestamp")
    .eq("resident_id", residentId)
    .eq("source", "ai_detected")
    .order("timestamp", { ascending: false })
    .limit(CONSECUTIVE_LOW_SESSIONS);

  if (!recentMoods || recentMoods.length < CONSECUTIVE_LOW_SESSIONS) {
    return false;
  }

  const allLow = recentMoods.every((m: Pick<MoodLog, "mood_score">) => m.mood_score < LOW_MOOD_THRESHOLD);
  if (!allLow) return false;

  const { data: existing } = await supabase
    .from("staff_alerts")
    .select("id")
    .eq("resident_id", residentId)
    .eq("alert_type", "mood_decline")
    .is("resolved_at", null)
    .limit(1);

  if (existing && existing.length > 0) return false;

  await supabase.from("staff_alerts").insert({
    resident_id: residentId,
    facility_id: facilityId,
    alert_type: "mood_decline" satisfies AlertType,
  });

  return true;
}

export async function checkNoActivityAlert(
  supabase: SupabaseClient,
  residentId: string,
  facilityId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - INACTIVITY_HOURS * 60 * 60 * 1000).toISOString();

  const { data: recentSessions } = await supabase
    .from("sessions")
    .select("start_time")
    .eq("resident_id", residentId)
    .gte("start_time", cutoff)
    .limit(1);

  if (recentSessions && recentSessions.length > 0) return false;

  const { data: existing } = await supabase
    .from("staff_alerts")
    .select("id")
    .eq("resident_id", residentId)
    .eq("alert_type", "no_activity")
    .is("resolved_at", null)
    .limit(1);

  if (existing && existing.length > 0) return false;

  await supabase.from("staff_alerts").insert({
    resident_id: residentId,
    facility_id: facilityId,
    alert_type: "no_activity" satisfies AlertType,
  });

  return true;
}

export async function createNurseCallAlert(
  supabase: SupabaseClient,
  residentId: string,
  facilityId: string
): Promise<void> {
  await supabase.from("staff_alerts").insert({
    resident_id: residentId,
    facility_id: facilityId,
    alert_type: "nurse_call" satisfies AlertType,
  });
}

export function getMoodColor(score: number | null): "green" | "yellow" | "red" | "gray" {
  if (score === null) return "gray";
  if (score >= 7) return "green";
  if (score >= 4) return "yellow";
  return "red";
}

export function sessionDurationMinutes(session: Session): number {
  if (!session.end_time) return 0;
  const start = new Date(session.start_time).getTime();
  const end = new Date(session.end_time).getTime();
  return Math.round((end - start) / 60000);
}

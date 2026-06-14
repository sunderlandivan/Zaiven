import { NextRequest, NextResponse } from "next/server";
import { getSupabaseOrNull } from "@/lib/supabase";
import { PILOT_FACILITY_ID } from "@/lib/constants";
import type { MoodLog, Resident, ResidentDashboardRow, Session } from "@/types";

async function buildDashboardFromDb(facilityId: string) {
  const supabase = getSupabaseOrNull();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { data: facility } = await supabase
    .from("facilities")
    .select("name")
    .eq("id", facilityId)
    .single();

  const { data: residents, error: residentsError } = await supabase
    .from("residents")
    .select("*")
    .eq("facility_id", facilityId)
    .order("room_number");

  if (residentsError) throw residentsError;

  const { data: alerts } = await supabase
    .from("staff_alerts")
    .select("*")
    .eq("facility_id", facilityId)
    .is("resolved_at", null);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600000);

  const rows: ResidentDashboardRow[] = await Promise.all(
    (residents ?? []).map(async (resident: Resident) => {
      const { data: sessions } = await supabase
        .from("sessions")
        .select("*")
        .eq("resident_id", resident.id)
        .order("start_time", { ascending: false });

      const { data: moods } = await supabase
        .from("mood_logs")
        .select("*")
        .eq("resident_id", resident.id)
        .order("timestamp", { ascending: false });

      const sessionList = (sessions ?? []) as Session[];
      const moodList = (moods ?? []) as MoodLog[];

      const lastSession = sessionList[0] ?? null;
      const todayMood = moodList.find((m) => new Date(m.timestamp) >= todayStart) ?? null;

      const weeklyMinutes = sessionList
        .filter((s) => new Date(s.start_time) >= weekAgo && s.end_time)
        .reduce((sum, s) => {
          const start = new Date(s.start_time).getTime();
          const end = new Date(s.end_time!).getTime();
          return sum + Math.round((end - start) / 60000);
        }, 0);

      const hasActiveAlert = (alerts ?? []).some((a) => a.resident_id === resident.id);

      return {
        resident,
        lastSessionTime: lastSession?.start_time ?? null,
        todayMoodScore: todayMood?.mood_score ?? null,
        weeklyEngagementMinutes: weeklyMinutes,
        hasActiveAlert,
      };
    })
  );

  return NextResponse.json({
    facilityName: facility?.name ?? "Facility",
    residents: residents ?? [],
    rows,
    alerts: alerts ?? [],
  });
}

export async function GET(request: NextRequest) {
  const facilityId = request.nextUrl.searchParams.get("facilityId") ?? PILOT_FACILITY_ID;

  try {
    return await buildDashboardFromDb(facilityId);
  } catch (error) {
    console.error("Residents API error:", error);
    return NextResponse.json({ error: "Failed to load residents" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { facilityId, name, roomNumber, dateOfBirth, cognitiveFlag } = body;

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("residents")
      .insert({
        facility_id: facilityId ?? PILOT_FACILITY_ID,
        name,
        room_number: roomNumber,
        date_of_birth: dateOfBirth ?? null,
        cognitive_flag: cognitiveFlag ?? false,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, resident: data });
  } catch (error) {
    console.error("Create resident error:", error);
    return NextResponse.json({ error: "Failed to create resident" }, { status: 500 });
  }
}

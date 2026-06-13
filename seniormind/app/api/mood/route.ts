import { NextRequest, NextResponse } from "next/server";
import { checkMoodDeclineAlert } from "@/lib/alerts";
import { getSupabaseOrNull } from "@/lib/supabase";
import { DEMO_FACILITY_ID } from "@/lib/mock-data";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { residentId, moodScore, source = "self_reported", notes } = body;

    if (!residentId || !moodScore) {
      return NextResponse.json({ error: "residentId and moodScore required" }, { status: 400 });
    }

    const score = Math.min(10, Math.max(1, Number(moodScore)));

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      return NextResponse.json({ success: true, demo: true });
    }

    const { data, error } = await supabase
      .from("mood_logs")
      .insert({
        resident_id: residentId,
        mood_score: score,
        source,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    if (source === "self_reported" && score < 4) {
      await checkMoodDeclineAlert(supabase, residentId, DEMO_FACILITY_ID);
    }

    return NextResponse.json({ success: true, moodLog: data });
  } catch (error) {
    console.error("Mood API error:", error);
    return NextResponse.json({ error: "Failed to save mood" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const residentId = request.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId required" }, { status: 400 });
  }

  const supabase = getSupabaseOrNull();
  if (!supabase) {
    return NextResponse.json({ demo: true, moodLogs: [] });
  }

  const { data, error } = await supabase
    .from("mood_logs")
    .select("*")
    .eq("resident_id", residentId)
    .order("timestamp", { ascending: false })
    .limit(20);

  if (error) throw error;
  return NextResponse.json({ moodLogs: data });
}

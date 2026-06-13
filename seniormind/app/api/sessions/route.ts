import { NextRequest, NextResponse } from "next/server";
import { getSupabaseOrNull } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const { residentId, sessionType = "chat" } = await request.json();

    if (!residentId) {
      return NextResponse.json({ error: "residentId required" }, { status: 400 });
    }

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      return NextResponse.json({
        sessionId: `demo-${Date.now()}`,
        demo: true,
      });
    }

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        resident_id: residentId,
        session_type: sessionType,
        message_count: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ sessionId: data.id });
  } catch (error) {
    console.error("Session create error:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      return NextResponse.json({ success: true, demo: true });
    }

    const { error } = await supabase
      .from("sessions")
      .update({ end_time: new Date().toISOString() })
      .eq("id", sessionId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Session end error:", error);
    return NextResponse.json({ error: "Failed to end session" }, { status: 500 });
  }
}

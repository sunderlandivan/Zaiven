import { NextRequest, NextResponse } from "next/server";
import { getCompanionReply } from "@/lib/claude";
import { checkMoodDeclineAlert } from "@/lib/alerts";
import { getSupabaseOrNull } from "@/lib/supabase";
import { DEMO_FACILITY_ID } from "@/lib/mock-data";
import type { ChatMessage } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, residentId, residentName, sessionId } = body as {
      messages: ChatMessage[];
      residentId?: string;
      residentName?: string;
      sessionId?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    const reply = await getCompanionReply(messages, residentName);

    const supabase = getSupabaseOrNull();
    if (supabase && residentId) {
      await supabase.from("mood_logs").insert({
        resident_id: residentId,
        session_id: sessionId ?? null,
        mood_score: reply.mood_score,
        source: "ai_detected",
        notes: reply.mood_signal,
      });

      if (sessionId) {
        const { data: sessionRow } = await supabase
          .from("sessions")
          .select("message_count")
          .eq("id", sessionId)
          .single();

        if (sessionRow) {
          await supabase
            .from("sessions")
            .update({ message_count: (sessionRow.message_count ?? 0) + 1 })
            .eq("id", sessionId);
        }
      }

      await checkMoodDeclineAlert(supabase, residentId, DEMO_FACILITY_ID);
    }

    return NextResponse.json({
      message: reply.message,
      mood_score: reply.mood_score,
      mood_signal: reply.mood_signal,
    });
  } catch (error) {
    console.error("Companion API error:", error);
    return NextResponse.json({ error: "Failed to get companion response" }, { status: 500 });
  }
}

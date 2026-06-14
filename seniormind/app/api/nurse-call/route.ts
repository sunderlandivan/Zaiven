import { NextRequest, NextResponse } from "next/server";
import { createNurseCallAlert } from "@/lib/alerts";
import { getSupabaseOrNull } from "@/lib/supabase";
import { PILOT_FACILITY_ID } from "@/lib/constants";

export async function POST(request: NextRequest) {
  try {
    const { residentId } = await request.json();

    if (!residentId) {
      return NextResponse.json({ error: "residentId required" }, { status: 400 });
    }

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    await createNurseCallAlert(supabase, residentId, PILOT_FACILITY_ID);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Nurse call error:", error);
    return NextResponse.json({ error: "Failed to send nurse call" }, { status: 500 });
  }
}

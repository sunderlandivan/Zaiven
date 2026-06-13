import { NextRequest, NextResponse } from "next/server";
import { checkNoActivityAlert } from "@/lib/alerts";
import { getSupabaseOrNull } from "@/lib/supabase";
import { DEMO_FACILITY_ID } from "@/lib/mock-data";

export async function GET(request: NextRequest) {
  const facilityId = request.nextUrl.searchParams.get("facilityId") ?? DEMO_FACILITY_ID;

  const supabase = getSupabaseOrNull();
  if (!supabase) {
    return NextResponse.json({ demo: true, alerts: [] });
  }

  const { data, error } = await supabase
    .from("staff_alerts")
    .select("*")
    .eq("facility_id", facilityId)
    .is("resolved_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ alerts: data });
}

export async function PATCH(request: NextRequest) {
  try {
    const { alertId, resolvedBy } = await request.json();

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      return NextResponse.json({ success: true, demo: true });
    }

    const { error } = await supabase
      .from("staff_alerts")
      .update({ resolved_at: new Date().toISOString(), resolved_by: resolvedBy ?? null })
      .eq("id", alertId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Alert resolve error:", error);
    return NextResponse.json({ error: "Failed to resolve alert" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { facilityId = DEMO_FACILITY_ID } = await request.json().catch(() => ({}));

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      return NextResponse.json({ success: true, demo: true, checked: 0 });
    }

    const { data: residents } = await supabase
      .from("residents")
      .select("id")
      .eq("facility_id", facilityId);

    let checked = 0;
    for (const resident of residents ?? []) {
      await checkNoActivityAlert(supabase, resident.id, facilityId);
      checked++;
    }

    return NextResponse.json({ success: true, checked });
  } catch (error) {
    console.error("Alert check error:", error);
    return NextResponse.json({ error: "Failed to run alert checks" }, { status: 500 });
  }
}

import TabletHome from "@/components/tablet/TabletHome";
import { PILOT_FACILITY_ID } from "@/lib/constants";
import { getSupabaseOrNull } from "@/lib/supabase";

interface TabletPageProps {
  searchParams: { resident?: string };
}

export default async function TabletPage({ searchParams }: TabletPageProps) {
  const supabase = getSupabaseOrNull();

  if (!supabase) {
    return (
      <div className="flex items-center justify-center h-full bg-seniormind-navy text-white p-8">
        <p className="text-3xl text-center">This tablet is not connected yet. Please contact staff.</p>
      </div>
    );
  }

  if (searchParams.resident) {
    const { data: resident } = await supabase
      .from("residents")
      .select("id, name")
      .eq("id", searchParams.resident)
      .single();

    if (resident) {
      return <TabletHome residentId={resident.id} residentName={resident.name} />;
    }
  }

  const { data: defaultResident } = await supabase
    .from("residents")
    .select("id, name")
    .eq("facility_id", PILOT_FACILITY_ID)
    .order("room_number")
    .limit(1)
    .single();

  if (!defaultResident) {
    return (
      <div className="flex items-center justify-center h-full bg-seniormind-navy text-white p-8">
        <p className="text-3xl text-center">No residents set up yet. Please contact staff.</p>
      </div>
    );
  }

  return (
    <TabletHome residentId={defaultResident.id} residentName={defaultResident.name} />
  );
}

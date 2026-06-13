import TabletHome from "@/components/tablet/TabletHome";
import { mockResidents } from "@/lib/mock-data";

interface TabletPageProps {
  searchParams: { resident?: string };
}

export default function TabletPage({ searchParams }: TabletPageProps) {
  const residentId =
    searchParams.resident ?? mockResidents[0].id;
  const resident =
    mockResidents.find((r) => r.id === residentId) ?? mockResidents[0];

  return (
    <TabletHome residentId={resident.id} residentName={resident.name} />
  );
}

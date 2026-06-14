"use client";

import { useEffect, useState } from "react";
import AlertBanner from "./AlertBanner";
import EngagementStats from "./EngagementStats";
import ResidentCard from "./ResidentCard";
import { PILOT_FACILITY_ID } from "@/lib/constants";
import type { Resident, ResidentDashboardRow, StaffAlert } from "@/types";

export default function DashboardView() {
  const [rows, setRows] = useState<ResidentDashboardRow[]>([]);
  const [alerts, setAlerts] = useState<StaffAlert[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [facilityName, setFacilityName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/residents?facilityId=${PILOT_FACILITY_ID}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? "Could not load dashboard data.");
          return;
        }

        setRows(data.rows ?? []);
        setAlerts(data.alerts ?? []);
        setResidents(data.residents ?? []);
        setFacilityName(data.facilityName ?? "Facility Dashboard");
        setError(null);
      } catch {
        setError("Could not connect to the server. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-gray-500 text-lg">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
        <p className="text-red-800 text-lg font-semibold">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <EngagementStats rows={rows} />

      <section>
        <AlertBanner alerts={alerts} residents={residents} />
      </section>

      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Residents — {facilityName}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((row) => (
            <ResidentCard key={row.resident.id} row={row} />
          ))}
        </div>
      </section>
    </div>
  );
}

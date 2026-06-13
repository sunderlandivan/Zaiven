"use client";

import { useEffect, useState } from "react";
import AlertBanner from "./AlertBanner";
import EngagementStats from "./EngagementStats";
import ResidentCard from "./ResidentCard";
import type { Resident, ResidentDashboardRow, StaffAlert } from "@/types";
import { buildMockDashboardRows, mockAlerts, mockFacility, mockResidents } from "@/lib/mock-data";

export default function DashboardView() {
  const [rows, setRows] = useState<ResidentDashboardRow[]>([]);
  const [alerts, setAlerts] = useState<StaffAlert[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [facilityName, setFacilityName] = useState(mockFacility.name);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/residents?facilityId=00000000-0000-4000-8000-000000000001");
        const data = await res.json();

        if (data.demo) {
          setDemoMode(true);
          setRows(buildMockDashboardRows());
          setAlerts(mockAlerts);
          setResidents(mockResidents);
          setFacilityName(mockFacility.name);
        } else {
          setRows(data.rows ?? []);
          setAlerts(data.alerts ?? []);
          setResidents(data.residents ?? []);
          setFacilityName(data.facilityName ?? "Facility Dashboard");
        }
      } catch {
        setDemoMode(true);
        setRows(buildMockDashboardRows());
        setAlerts(mockAlerts);
        setResidents(mockResidents);
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

  return (
    <div className="space-y-8">
      {demoMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-blue-800 text-sm">
          Demo mode — connect Supabase in <code className="font-mono">.env.local</code> for live data.
        </div>
      )}

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

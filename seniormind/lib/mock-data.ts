import type {
  Facility,
  MoodLog,
  Resident,
  ResidentDashboardRow,
  Session,
  StaffAlert,
} from "@/types";

export const DEMO_FACILITY_ID = "00000000-0000-4000-8000-000000000001";

export const mockFacility: Facility = {
  id: DEMO_FACILITY_ID,
  name: "Missy's Place (Pilot)",
  contact_email: "admin@missysplace.demo",
  subscription_status: "trial",
  trial_start_date: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

export const mockResidents: Resident[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    facility_id: DEMO_FACILITY_ID,
    name: "Margaret Chen",
    room_number: "101A",
    date_of_birth: "1942-03-15",
    cognitive_flag: false,
    created_at: new Date().toISOString(),
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    facility_id: DEMO_FACILITY_ID,
    name: "Robert Williams",
    room_number: "102B",
    date_of_birth: "1938-07-22",
    cognitive_flag: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    facility_id: DEMO_FACILITY_ID,
    name: "Dorothy Hayes",
    room_number: "103A",
    date_of_birth: "1945-11-08",
    cognitive_flag: false,
    created_at: new Date().toISOString(),
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    facility_id: DEMO_FACILITY_ID,
    name: "James O'Brien",
    room_number: "104C",
    date_of_birth: "1940-01-30",
    cognitive_flag: true,
    created_at: new Date().toISOString(),
  },
];

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600000).toISOString();

export const mockSessions: Session[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    resident_id: mockResidents[0].id,
    start_time: hoursAgo(2),
    end_time: hoursAgo(1.5),
    session_type: "chat",
    message_count: 12,
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    resident_id: mockResidents[1].id,
    start_time: hoursAgo(5),
    end_time: hoursAgo(4.5),
    session_type: "chat",
    message_count: 8,
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    resident_id: mockResidents[2].id,
    start_time: hoursAgo(1),
    end_time: hoursAgo(0.5),
    session_type: "game",
    message_count: 6,
  },
  {
    id: "20000000-0000-4000-8000-000000000004",
    resident_id: mockResidents[3].id,
    start_time: hoursAgo(26),
    end_time: hoursAgo(25.5),
    session_type: "chat",
    message_count: 4,
  },
];

export const mockMoodLogs: MoodLog[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    resident_id: mockResidents[0].id,
    session_id: mockSessions[0].id,
    timestamp: hoursAgo(1.5),
    mood_score: 8,
    source: "ai_detected",
    notes: "Engaged and cheerful",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    resident_id: mockResidents[1].id,
    session_id: mockSessions[1].id,
    timestamp: hoursAgo(4.5),
    mood_score: 3,
    source: "ai_detected",
    notes: "Mentioned feeling lonely",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    resident_id: mockResidents[1].id,
    session_id: null,
    timestamp: hoursAgo(30),
    mood_score: 2,
    source: "ai_detected",
    notes: "Low energy, withdrawn",
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    resident_id: mockResidents[2].id,
    session_id: mockSessions[2].id,
    timestamp: hoursAgo(0.5),
    mood_score: 6,
    source: "ai_detected",
    notes: "Neutral, enjoyed trivia game",
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    resident_id: mockResidents[3].id,
    session_id: mockSessions[3].id,
    timestamp: hoursAgo(25.5),
    mood_score: 5,
    source: "ai_detected",
    notes: "Quiet but responsive",
  },
];

export const mockAlerts: StaffAlert[] = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    resident_id: mockResidents[1].id,
    facility_id: DEMO_FACILITY_ID,
    alert_type: "mood_decline",
    created_at: hoursAgo(4),
    resolved_at: null,
    resolved_by: null,
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    resident_id: mockResidents[3].id,
    facility_id: DEMO_FACILITY_ID,
    alert_type: "no_activity",
    created_at: hoursAgo(20),
    resolved_at: null,
    resolved_by: null,
  },
];

export function buildMockDashboardRows(): ResidentDashboardRow[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  return mockResidents.map((resident) => {
    const sessions = mockSessions.filter((s) => s.resident_id === resident.id);
    const lastSession = sessions.sort(
      (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    )[0];

    const todayMood = mockMoodLogs
      .filter(
        (m) =>
          m.resident_id === resident.id &&
          new Date(m.timestamp) >= todayStart
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    const weekAgo = new Date(now - 7 * 24 * 3600000);
    const weeklyMinutes = sessions
      .filter((s) => new Date(s.start_time) >= weekAgo && s.end_time)
      .reduce((sum, s) => {
        const start = new Date(s.start_time).getTime();
        const end = new Date(s.end_time!).getTime();
        return sum + Math.round((end - start) / 60000);
      }, 0);

    const hasActiveAlert = mockAlerts.some(
      (a) => a.resident_id === resident.id && !a.resolved_at
    );

    return {
      resident,
      lastSessionTime: lastSession?.start_time ?? null,
      todayMoodScore: todayMood?.mood_score ?? null,
      weeklyEngagementMinutes: weeklyMinutes,
      hasActiveAlert,
    };
  });
}

export type SubscriptionStatus = "trial" | "active" | "inactive";
export type SessionType = "chat" | "game" | "media";
export type MoodSource = "ai_detected" | "self_reported";
export type AlertType = "mood_decline" | "nurse_call" | "no_activity";
export type StaffRole = "nurse" | "admin";

export interface Facility {
  id: string;
  name: string;
  contact_email: string | null;
  subscription_status: SubscriptionStatus;
  trial_start_date: string | null;
  created_at: string;
}

export interface Resident {
  id: string;
  facility_id: string;
  name: string;
  room_number: string;
  date_of_birth: string | null;
  cognitive_flag: boolean;
  created_at: string;
}

export interface Session {
  id: string;
  resident_id: string;
  start_time: string;
  end_time: string | null;
  session_type: SessionType;
  message_count: number;
}

export interface MoodLog {
  id: string;
  resident_id: string;
  session_id: string | null;
  timestamp: string;
  mood_score: number;
  source: MoodSource;
  notes: string | null;
}

export interface StaffAlert {
  id: string;
  resident_id: string;
  facility_id: string;
  alert_type: AlertType;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface Staff {
  id: string;
  facility_id: string;
  name: string;
  email: string;
  role: StaffRole;
}

export interface CompanionResponse {
  message: string;
  mood_score: number;
  mood_signal: string;
}

export interface ResidentDashboardRow {
  resident: Resident;
  lastSessionTime: string | null;
  todayMoodScore: number | null;
  weeklyEngagementMinutes: number;
  hasActiveAlert: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

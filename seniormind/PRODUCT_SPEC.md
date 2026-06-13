# PRODUCT_SPEC.md
# SeniorMind — AI Companion Tablet & Staff Dashboard

> **Cursor Context:** Always reference this file at the start of every session. This is the source of truth for all product decisions, architecture, and scope.

---

## 1. Product Overview

**SeniorMind** is an AI-powered companion platform for elderly residents in Skilled Nursing Facilities (SNFs) and nursing homes. It consists of two surfaces:

1. **Tablet App** — A resident-facing interface running on a tablet at bedside. It provides AI conversation, cognitive games, and a nurse call button.
2. **Staff Dashboard** — A web portal for nursing staff to monitor resident engagement, mood trends, and receive alerts for cognitive or emotional decline.

**Core Problem:** Only ~5% of SNFs currently have AI-assisted engagement tools. Nursing staff are stretched thin, particularly for long-term care and cognitively isolated patients. Loneliness, cognitive decline, and undetected mood shifts are persistent challenges.

**Core Solution:** Deploy a low-cost tablet per bed running a warm AI companion powered by Claude. Capture engagement data and mood signals passively. Surface that data to nurses in a clean dashboard so they can focus their physical care attention where it's needed most.

---

## 2. Target Users

### Residents
- Elderly (65+), many with early-to-mid cognitive decline
- May have limited tech literacy
- Isolated or have limited family visits
- Long-term care or post-acute recovery patients

### Nursing Staff
- CNAs, LPNs, RNs at SNFs
- Time-constrained; need fast-glance dashboards
- Need mood/engagement alerts without having to query residents directly

### Facility Administrators
- Decision-makers for subscription purchase
- Want ROI data: staff time saved, resident satisfaction, bed utilization

---

## 3. Core Features

### 3.1 Tablet App (Resident-Facing)

| Feature | Description |
|---|---|
| AI Companion Chat | Conversational AI (Claude) that talks, listens, tells stories, and asks check-in questions |
| Cognitive Games | Simple memory, trivia, and word games sized for large touch targets |
| Mood Check-In | Optional daily emoji/face-based mood self-report |
| Nurse Call | Large button that sends an alert to staff dashboard |
| Media | Weather, music player (ambient), family photo display |

**UI Requirements (Non-Negotiable):**
- Minimum font size: 48px body, 64px headings
- Minimum button size: 120px height x full-width or 200px square
- High contrast: white on dark blue or black on white only
- No small icons without text labels
- No scrolling on main screens — everything above the fold
- Color-blind safe palette
- Auto-wake on motion or scheduled times

### 3.2 Staff Dashboard (Nurse-Facing)

| Feature | Description |
|---|---|
| Resident List | All residents with room number, last active time, today's mood score |
| Mood Alerts | Red flag panel for residents with 2+ consecutive low mood scores (<4/10) |
| Engagement Stats | Daily/weekly session time per resident |
| Nurse Call Log | Timestamped log of resident-initiated nurse calls |
| Monthly Report | Exportable PDF summary of facility-wide engagement and mood trends |
| Facility Admin View | Subscription status, total devices, aggregate stats |

---

## 4. Technical Architecture

### 4.1 Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend (Tablet) | Next.js 14 (PWA) | Runs in tablet browser, no app store needed |
| Frontend (Dashboard) | Next.js 14 | Same codebase, separate routes |
| Styling | Tailwind CSS | Fast iteration, utility-first |
| AI Layer | Anthropic Claude API (claude-sonnet-4-6) | Conversation + mood analysis |
| Backend/API | Next.js API routes | Keep stack minimal at MVP |
| Database | Supabase (PostgreSQL) | Auth, Realtime, free tier for pilot |
| Hosting | Vercel | Auto-deploy from GitHub, free tier |
| Hardware (Pilot) | Amazon Fire HD 10 (~$100) | Cheap, available, browser-based PWA works |

### 4.2 Folder Structure

```
/seniormind
  /app
    /tablet          → Resident-facing tablet UI
    /dashboard       → Staff portal
    /api             → Backend API routes
      /companion     → Claude AI conversation endpoint
      /mood          → Mood logging endpoint
      /alerts        → Alert generation endpoint
      /residents     → CRUD for residents
  /components
    /tablet          → Large-UI components (BigButton, CompanionChat, etc.)
    /dashboard       → Staff UI components (ResidentCard, AlertBanner, etc.)
    /shared          → Common components
  /lib
    /claude.ts       → Anthropic API wrapper + mood scoring
    /supabase.ts     → Supabase client
    /alerts.ts       → Alert logic
  /types
    /index.ts        → All TypeScript interfaces
  PRODUCT_SPEC.md    → THIS FILE
```

### 4.3 Database Schema

```sql
-- Facilities (SNFs / nursing homes)
facilities (
  id uuid PRIMARY KEY,
  name text,
  contact_email text,
  subscription_status text,  -- 'trial' | 'active' | 'inactive'
  trial_start_date timestamp,
  created_at timestamp
)

-- Residents
residents (
  id uuid PRIMARY KEY,
  facility_id uuid REFERENCES facilities,
  name text,
  room_number text,
  date_of_birth date,
  cognitive_flag boolean,  -- true = extra monitoring
  created_at timestamp
)

-- Companion Sessions
sessions (
  id uuid PRIMARY KEY,
  resident_id uuid REFERENCES residents,
  start_time timestamp,
  end_time timestamp,
  session_type text,  -- 'chat' | 'game' | 'media'
  message_count int
)

-- Mood Logs (auto-detected + self-reported)
mood_logs (
  id uuid PRIMARY KEY,
  resident_id uuid REFERENCES residents,
  session_id uuid REFERENCES sessions,
  timestamp timestamp,
  mood_score int,         -- 1 (very low) to 10 (very positive)
  source text,            -- 'ai_detected' | 'self_reported'
  notes text
)

-- Staff Alerts
staff_alerts (
  id uuid PRIMARY KEY,
  resident_id uuid REFERENCES residents,
  facility_id uuid REFERENCES facilities,
  alert_type text,        -- 'mood_decline' | 'nurse_call' | 'no_activity'
  created_at timestamp,
  resolved_at timestamp,
  resolved_by uuid        -- staff user id
)

-- Staff Users
staff (
  id uuid PRIMARY KEY,
  facility_id uuid REFERENCES facilities,
  name text,
  email text,
  role text               -- 'nurse' | 'admin'
)
```

---

## 5. AI Companion Design

### 5.1 System Prompt (Claude)

```
You are a warm, patient, and friendly companion for elderly residents in a nursing facility.
Your name is "Sunny." You speak clearly and slowly, using simple language.
You never rush the conversation. You ask one question at a time.
You tell gentle stories, share trivia about history or nature, and play simple word games on request.

After every resident message, you must respond in this JSON format:
{
  "message": "Your conversational response here",
  "mood_score": 7,
  "mood_signal": "resident mentioned feeling tired today"
}

mood_score is your estimate of the resident's emotional state: 1 (very distressed) to 10 (very positive).
Base it on their word choice, energy, and topics mentioned.
If uncertain, return 6 (neutral).
Never mention the mood score to the resident.
```

### 5.2 Mood Alert Logic

```
IF last 2 sessions for a resident both have mood_score < 4:
  → Insert row into staff_alerts (alert_type = 'mood_decline')
  → Surface on dashboard alert panel

IF resident has had 0 sessions in the last 48 hours:
  → Insert row into staff_alerts (alert_type = 'no_activity')
```

---

## 6. Go-To-Market Strategy

### 6.1 Pilot Plan
- Target: 1 facility (Missy's) as a free 30-day pilot
- Deploy on 10 beds/tablets
- Collect engagement data and mood logs
- Generate a monthly report PDF to present as proof of value
- Use data to close first paid contract

### 6.2 Pricing Model (Post-Pilot)
- **Per-bed subscription:** ~$30–50/bed/month
- **Facility tiers:** 10-bed starter, 25-bed mid, 50+ enterprise
- **Free trial:** 30 days, 10 beds — requires facility POC contact

### 6.3 Sales Motion
- Derrick's SNF contacts = warm outreach for pilots
- Lead with staff time savings data from pilot report
- Secondary angle: resident satisfaction scores and family retention

---

## 7. Development Phases

### Phase 1 — Foundation (Weeks 1–2)
- [ ] Initialize Next.js + Tailwind + Supabase project
- [ ] Set up DB schema in Supabase
- [ ] Build static tablet UI (no AI yet)
- [ ] Build static staff dashboard (hardcoded data)

### Phase 2 — Core AI (Weeks 3–4)
- [ ] Connect Claude API companion endpoint
- [ ] Parse mood scores from Claude responses
- [ ] Save sessions + mood_logs to Supabase
- [ ] Wire tablet UI to live AI

### Phase 3 — Dashboard Live Data (Weeks 5–6)
- [ ] Connect dashboard to Supabase (real resident data)
- [ ] Build alert logic and staff_alerts table
- [ ] Supabase Auth for staff login
- [ ] Nurse call button → alert flow

### Phase 4 — Pilot Ready (Week 7–8)
- [ ] PWA setup (installable on tablet)
- [ ] Monthly report export (PDF)
- [ ] Resident onboarding flow (staff adds resident)
- [ ] QA on Amazon Fire HD tablet
- [ ] Deploy to Vercel

### Phase 5 — Post-Pilot
- [ ] Billing integration (Stripe)
- [ ] Multi-facility support
- [ ] Cognitive game library expansion
- [ ] Family portal (optional view for family members)

---

## 8. Key Constraints & Decisions

- **No native app at MVP** — PWA only. Avoids app store approval delays and reduces cost.
- **Claude for AI** — Ivan has existing expertise with Claude + OpenAI; use Claude (claude-sonnet-4-6) as primary model.
- **Supabase for everything backend** — Auth, DB, and Realtime alerts in one free-tier service.
- **Tablet = browser only** — Amazon Fire HD or any Android tablet. Pin PWA to home screen.
- **HIPAA considerations** — Do NOT store full conversation transcripts at MVP. Store only mood scores and session metadata. Add HIPAA compliance layer before scaling paid contracts.
- **Startup capital target:** Under $50k to MVP (developer time is internal).

---

## 9. Open Questions (Resolve Before Phase 3)

1. Will facilities want a HIPAA Business Associate Agreement (BAA) before signing? → Research required.
2. What is the exact pricing elasticity for SNFs? ($30 vs $50/bed)
3. Does Missy's facility have Wi-Fi on resident floors? → Required for PWA.
4. Will staff need mobile app alerts or is browser dashboard sufficient?
5. Family portal — is this a selling point for families paying private-pay beds?

---

*Last updated: June 2026 | Owners: Ivan (Technical), Derrick (Business/Partnerships)*

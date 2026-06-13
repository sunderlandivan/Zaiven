import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-seniormind-navy to-seniormind-navy-dark text-white flex flex-col items-center justify-center p-8">
      <div className="text-center max-w-2xl">
        <p className="text-blue-200 text-xl mb-2">AI Companion Platform</p>
        <h1 className="text-6xl font-bold mb-6">SeniorMind</h1>
        <p className="text-2xl text-blue-100 leading-relaxed mb-12">
          Warm AI companionship for nursing home residents. Engagement insights for staff.
        </p>

        <div className="flex flex-col sm:flex-row gap-6 justify-center">
          <Link
            href="/tablet"
            className="min-h-[100px] px-12 flex items-center justify-center text-2xl font-bold bg-seniormind-accent rounded-2xl hover:opacity-90 transition-opacity shadow-lg"
          >
            Tablet App
          </Link>
          <Link
            href="/dashboard"
            className="min-h-[100px] px-12 flex items-center justify-center text-2xl font-bold bg-white text-seniormind-navy rounded-2xl hover:bg-blue-50 transition-colors shadow-lg"
          >
            Staff Dashboard
          </Link>
        </div>

        <p className="mt-12 text-blue-300 text-lg">
          Pilot: Missy&apos;s Place · 10 beds · 30-day trial
        </p>
      </div>
    </div>
  );
}

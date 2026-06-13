"use client";

import { useState } from "react";
import BigButton from "./BigButton";
import CompanionChat from "./CompanionChat";
import GamePanel from "./GamePanel";
import MoodCheckIn from "./MoodCheckIn";

type TabletView = "home" | "chat" | "game" | "mood";

interface TabletHomeProps {
  residentId: string;
  residentName: string;
}

export default function TabletHome({ residentId, residentName }: TabletHomeProps) {
  const [view, setView] = useState<TabletView>("home");
  const [nurseCalled, setNurseCalled] = useState(false);

  async function callNurse() {
    setNurseCalled(true);
    try {
      await fetch("/api/nurse-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId }),
      });
    } catch {
      /* demo mode */
    }
  }

  if (view === "chat") {
    return (
      <CompanionChat
        residentId={residentId}
        residentName={residentName}
        onBack={() => setView("home")}
      />
    );
  }

  if (view === "game") {
    return <GamePanel onBack={() => setView("home")} />;
  }

  if (view === "mood") {
    return <MoodCheckIn residentId={residentId} onComplete={() => setView("home")} />;
  }

  return (
    <div className="flex flex-col h-full bg-seniormind-navy text-white p-8 gap-6">
      <header className="text-center shrink-0">
        <p className="text-2xl text-blue-200">SeniorMind</p>
        <h1 className="text-5xl font-bold mt-2">Hello, {residentName.split(" ")[0]}!</h1>
        <p className="text-3xl text-blue-100 mt-2">What would you like to do today?</p>
      </header>

      {nurseCalled && (
        <div className="bg-seniormind-success text-white text-3xl font-bold text-center py-6 rounded-2xl shrink-0">
          A nurse has been notified. Help is on the way.
        </div>
      )}

      <main className="flex flex-col gap-5 flex-1 justify-center max-w-3xl mx-auto w-full">
        <BigButton
          label="Talk to Companion"
          icon="💬"
          onClick={() => setView("chat")}
        />
        <BigButton
          label="Play a Game"
          icon="🎮"
          onClick={() => setView("game")}
          variant="secondary"
        />
        <BigButton
          label="How Are You Feeling?"
          icon="😊"
          onClick={() => setView("mood")}
          variant="secondary"
        />
        <BigButton
          label="Call a Nurse"
          icon="🛎️"
          onClick={callNurse}
          variant="danger"
          disabled={nurseCalled}
        />
      </main>

      <footer className="text-center text-2xl text-blue-300 shrink-0">
        Tap any button above to get started
      </footer>
    </div>
  );
}

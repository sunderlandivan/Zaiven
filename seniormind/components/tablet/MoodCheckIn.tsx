"use client";

import { useState } from "react";
import BigButton from "./BigButton";

const MOOD_OPTIONS = [
  { score: 10, emoji: "😊", label: "Great" },
  { score: 7, emoji: "🙂", label: "Good" },
  { score: 5, emoji: "😐", label: "Okay" },
  { score: 3, emoji: "😔", label: "Low" },
  { score: 1, emoji: "😢", label: "Sad" },
];

interface MoodCheckInProps {
  residentId: string;
  onComplete: () => void;
}

export default function MoodCheckIn({ residentId, onComplete }: MoodCheckInProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  async function saveMood(score: number) {
    setSelected(score);
    try {
      await fetch("/api/mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId,
          moodScore: score,
          source: "self_reported",
        }),
      });
    } catch {
      /* demo mode */
    }
    setSaved(true);
    setTimeout(onComplete, 1500);
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-seniormind-navy text-white p-8">
        <p className="text-5xl font-bold">Thank you!</p>
        <p className="text-3xl mt-4 text-blue-200">Your check-in has been saved.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-seniormind-navy text-white p-8">
      <h2 className="text-5xl font-bold text-center mb-4">How are you feeling?</h2>
      <p className="text-3xl text-center text-blue-200 mb-8">Tap the face that matches your mood</p>

      <div className="grid grid-cols-1 gap-4 flex-1">
        {MOOD_OPTIONS.map(({ score, emoji, label }) => (
          <button
            key={score}
            type="button"
            onClick={() => saveMood(score)}
            className={`flex items-center gap-6 w-full min-h-[120px] px-8 rounded-2xl border-4 text-left transition-all ${
              selected === score
                ? "border-white bg-seniormind-accent"
                : "border-transparent bg-white/10 hover:bg-white/20"
            }`}
          >
            <span className="text-6xl">{emoji}</span>
            <span className="text-4xl font-bold">{label}</span>
          </button>
        ))}
      </div>

      <BigButton label="Skip for now" onClick={onComplete} variant="secondary" />
    </div>
  );
}

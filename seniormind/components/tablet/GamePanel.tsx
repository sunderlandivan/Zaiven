"use client";

import { useState } from "react";

interface GamePanelProps {
  onBack: () => void;
}

const TRIVIA = [
  {
    question: "What color is the sky on a clear day?",
    options: ["Green", "Blue", "Red", "Yellow"],
    answer: 1,
  },
  {
    question: "How many days are in a week?",
    options: ["5", "6", "7", "8"],
    answer: 2,
  },
  {
    question: "Which season comes after winter?",
    options: ["Fall", "Summer", "Spring", "Winter again"],
    answer: 2,
  },
];

export default function GamePanel({ onBack }: GamePanelProps) {
  const [gameIndex, setGameIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  const game = TRIVIA[gameIndex];

  function handleAnswer(optionIndex: number) {
    if (feedback) return;

    if (optionIndex === game.answer) {
      setScore((s) => s + 1);
      setFeedback("That's right! Well done!");
    } else {
      setFeedback(`Good try! The answer was: ${game.options[game.answer]}`);
    }

    setTimeout(() => {
      if (gameIndex < TRIVIA.length - 1) {
        setGameIndex((i) => i + 1);
        setFeedback(null);
      } else {
        setFeedback(`Game over! You got ${score + (optionIndex === game.answer ? 1 : 0)} out of ${TRIVIA.length} correct.`);
      }
    }, 2000);
  }

  return (
    <div className="flex flex-col h-full bg-seniormind-navy text-white">
      <header className="flex items-center gap-4 p-6 bg-seniormind-navy-dark shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="min-w-[120px] min-h-[80px] px-6 bg-white text-seniormind-navy text-2xl font-bold rounded-xl"
        >
          ← Back
        </button>
        <h1 className="text-4xl font-bold">Trivia Game</h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
        {gameIndex < TRIVIA.length && !feedback?.startsWith("Game over") ? (
          <>
            <p className="text-2xl text-blue-200">
              Question {gameIndex + 1} of {TRIVIA.length}
            </p>
            <h2 className="text-4xl font-bold text-center leading-snug">{game.question}</h2>
            <div className="grid grid-cols-1 gap-4 w-full max-w-2xl">
              {game.options.map((option, i) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleAnswer(i)}
                  disabled={!!feedback}
                  className="min-h-[100px] px-8 text-3xl font-bold bg-seniormind-accent rounded-2xl hover:opacity-90 disabled:opacity-70"
                >
                  {option}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {feedback && (
          <p className="text-4xl font-bold text-center text-yellow-300">{feedback}</p>
        )}

        {feedback?.startsWith("Game over") && (
          <button
            type="button"
            onClick={onBack}
            className="min-h-[100px] px-12 text-3xl font-bold bg-white text-seniormind-navy rounded-2xl"
          >
            Back to Home
          </button>
        )}
      </div>
    </div>
  );
}

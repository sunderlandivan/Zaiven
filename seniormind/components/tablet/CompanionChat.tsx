"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "@/types";

interface CompanionChatProps {
  residentId: string;
  residentName: string;
  onBack: () => void;
}

export default function CompanionChat({ residentId, residentName, onBack }: CompanionChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    async function startSession() {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ residentId, sessionType: "chat" }),
        });
        const data = await res.json();
        if (data.sessionId) setSessionId(data.sessionId);
      } catch {
        /* demo mode — session optional */
      }
    }
    startSession();
  }, [residentId]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMessage: ChatMessage = { role: "user", content: text.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/companion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          residentId,
          residentName,
          sessionId,
        }),
      });

      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.message }]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I'm having a little trouble right now. Please try again in a moment.",
        },
      ]);
    } finally {
      setLoading(false);
    }
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
        <div>
          <h1 className="text-4xl font-bold">Talk to Sunny</h1>
          <p className="text-2xl text-blue-200 mt-1">Your friendly companion</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && !loading && (
          <div className="text-center py-12">
            <p className="text-3xl text-blue-100">
              Tap a suggestion below or type a message to start chatting with Sunny.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-6 py-4 rounded-2xl text-2xl leading-relaxed ${
                msg.role === "user"
                  ? "bg-seniormind-accent text-white"
                  : "bg-white text-seniormind-navy"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white text-seniormind-navy px-6 py-4 rounded-2xl text-2xl">
              Sunny is thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length === 0 && (
        <div className="px-6 pb-4 grid gap-3 shrink-0">
          {[
            "Hello Sunny, how are you?",
            "Tell me a story",
            "I feel a little lonely today",
          ].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => sendMessage(suggestion)}
              className="w-full min-h-[80px] px-6 text-2xl font-semibold bg-seniormind-accent/30 border-2 border-seniormind-accent rounded-xl text-white"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <footer className="p-6 bg-seniormind-navy-dark shrink-0">
        <div className="flex gap-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
            placeholder="Type your message..."
            className="flex-1 min-h-[80px] px-6 text-2xl rounded-xl text-seniormind-navy bg-white placeholder:text-gray-400"
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="min-w-[160px] min-h-[80px] px-8 text-2xl font-bold bg-seniormind-accent text-white rounded-xl disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}

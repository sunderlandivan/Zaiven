import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, CompanionResponse } from "@/types";

const SYSTEM_PROMPT = `You are a warm, patient, and friendly companion for elderly residents in a nursing facility.
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
Respond with ONLY valid JSON — no markdown, no code fences.`;

const DEMO_RESPONSES: CompanionResponse[] = [
  {
    message:
      "Hello there! I'm Sunny, your friendly companion. It's wonderful to see you today. How are you feeling this morning?",
    mood_score: 7,
    mood_signal: "greeting — neutral-positive tone",
  },
  {
    message:
      "That sounds lovely. Did you know that robins are one of the first birds to sing in the morning? They have such a cheerful song. What kind of music do you enjoy?",
    mood_score: 7,
    mood_signal: "engaged in conversation",
  },
  {
    message:
      "I hear you. Some days feel slower than others, and that's perfectly okay. Would you like to hear a short story about a garden?",
    mood_score: 5,
    mood_signal: "resident may be feeling low energy",
  },
];

function parseCompanionJson(raw: string): CompanionResponse {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      message: trimmed,
      mood_score: 6,
      mood_signal: "could not parse mood — default neutral",
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as Partial<CompanionResponse>;
  return {
    message: parsed.message ?? "I'm here with you. Tell me more when you're ready.",
    mood_score: Math.min(10, Math.max(1, Number(parsed.mood_score) || 6)),
    mood_signal: parsed.mood_signal ?? "neutral",
  };
}

export async function getCompanionReply(
  messages: ChatMessage[],
  residentName?: string
): Promise<CompanionResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fallbackIndex = Math.min(messages.length, DEMO_RESPONSES.length - 1);
  const fallback = () => DEMO_RESPONSES[fallbackIndex];

  if (!apiKey) {
    return fallback();
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const nameNote = residentName
      ? `The resident's name is ${residentName}. Use their name warmly when appropriate.`
      : "";

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 512,
      system: `${SYSTEM_PROMPT}\n\n${nameNote}`,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude");
    }

    return parseCompanionJson(textBlock.text);
  } catch (error) {
    console.warn("Claude API unavailable, using demo fallback:", error);
    return fallback();
  }
}

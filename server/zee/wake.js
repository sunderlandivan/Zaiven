import { spawn } from "child_process";

/** @type {import("child_process").ChildProcessWithoutNullStreams | null} */
let wakeProc = null;
/** @type {Set<(payload: { type: string, text?: string }) => void>} */
const listeners = new Set();
let started = false;

function emit(payload) {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors
    }
  }
}

function buildWakePsCommand() {
  // Two grammars: wake phrases (for activating Zee) and end-session phrases
  // (for shutting Zee off without OpenAI API help). System.Speech matches the
  // longest constrained phrase, so "that will be all zee" wins over "zee".
  // Note: ASR commonly hears "Zee" as the letter "Z" — we treat them as
  // synonyms and accept both spellings in the end-session grammar.
  return `
Add-Type -AssemblyName System.Speech;
$culture = New-Object System.Globalization.CultureInfo("en-US");
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture);

$wakeChoices = New-Object System.Speech.Recognition.Choices;
$wakeChoices.Add([string[]]@(
  "z are you there"
));
$wakeGb = New-Object System.Speech.Recognition.GrammarBuilder;
$wakeGb.Culture = $culture;
$wakeGb.Append($wakeChoices);
$wakeGrammar = New-Object System.Speech.Recognition.Grammar($wakeGb);
$wakeGrammar.Name = "wake";
$engine.LoadGrammar($wakeGrammar);

$endChoices = New-Object System.Speech.Recognition.Choices;
$endChoices.Add([string[]]@(
  "that will be all zee",
  "that will be all z",
  "that will be all",
  "that was all zee",
  "that was all z",
  "that was all",
  "that is all zee",
  "that is all z",
  "that is all",
  "we are done zee",
  "we are done",
  "stand down zee",
  "stand down",
  "stop listening zee",
  "stop listening",
  "end session",
  "end the session",
  "end voice session",
  "good night zee",
  "good night z",
  "good night",
  "goodbye zee",
  "goodbye z",
  "goodbye",
  "go to sleep zee",
  "go to sleep",
  "shut down zee",
  "shut down voice",
  "power off zee",
  "zee shut down",
  "zee go to sleep",
  "zee that will be all"
));
$endGb = New-Object System.Speech.Recognition.GrammarBuilder;
$endGb.Culture = $culture;
$endGb.Append($endChoices);
$endGrammar = New-Object System.Speech.Recognition.Grammar($endGb);
$endGrammar.Name = "end";
$engine.LoadGrammar($endGrammar);

$engine.SetInputToDefaultAudioDevice();
Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -Action {
  $result = $Event.SourceEventArgs.Result;
  $txt = [string]$result.Text;
  $confidence = [double]$result.Confidence;
  $grammarName = [string]$result.Grammar.Name;
  $norm = ($txt.ToLower().Trim() -replace '[^a-z]', '');
  # Wake phrase requires higher confidence to avoid false positives from ambient noise.
  $minConf = 0.90;
  # End-session phrases: be more permissive. They're 3+ words long, in a
  # constrained grammar, and the worst case is a benign session shutdown.
  # Speakers playing Zee's TTS often degrade input confidence.
  if ($grammarName -eq "end") { $minConf = 0.55; }
  if ($confidence -lt $minConf) {
    [Console]::Error.WriteLine("[wake-reject] grammar=" + $grammarName + " conf=" + $confidence + " text=" + $txt);
    return;
  }
  if ($grammarName -eq "end") {
    [Console]::Out.WriteLine("END:" + $txt);
    [Console]::Out.Flush();
    return;
  }
  if ($grammarName -eq "wake") {
    [Console]::Out.WriteLine("WAKE:" + $txt);
    [Console]::Out.Flush();
  }
} | Out-Null;
[Console]::Out.WriteLine("WAKE:READY");
[Console]::Out.Flush();
$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple);
while ($true) { Start-Sleep -Milliseconds 500 }
`.trim();
}

function startWakeProcess() {
  if (wakeProc || process.platform !== "win32") return;
  const ps = buildWakePsCommand();
  wakeProc = spawn("powershell", ["-NoProfile", "-Command", ps], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  wakeProc.stdout.setEncoding("utf8");
  wakeProc.stdout.on("data", (chunk) => {
    const lines = String(chunk || "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("END:")) {
        const text = line.slice(4).trim();
        emit({ type: "end_session", text });
        continue;
      }
      if (!line.startsWith("WAKE:")) continue;
      const text = line.slice(5).trim();
      if (text === "READY") emit({ type: "ready" });
      else emit({ type: "wake", text });
    }
  });
  wakeProc.stderr.setEncoding("utf8");
  wakeProc.stderr.on("data", (chunk) => {
    const msg = String(chunk || "").trim();
    if (!msg) return;
    emit({ type: "error", text: msg.slice(0, 220) });
  });
  wakeProc.on("exit", () => {
    wakeProc = null;
    emit({ type: "error", text: "wake process exited; retrying..." });
    setTimeout(() => {
      startWakeProcess();
    }, 1200);
  });
}

export function ensureWakeService() {
  if (started) return;
  started = true;
  if (process.platform === "win32") {
    startWakeProcess();
  }
}

export function addWakeListener(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

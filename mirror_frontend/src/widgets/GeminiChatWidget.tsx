import { useState, useRef, useEffect, useCallback } from "react";
import { registerWidget } from "./registry";

interface ChatMessage {
  role: "user" | "model";
  text: string;
  image?: string;
}

type Phase = "waiting" | "listening" | "processing" | "speaking";

const WAKE_PHRASE = "hey jarvis";
const CAMERA_PHRASES = ["take a picture"];
const CLEAR_PHRASES = ["clear chat", "new conversation", "start over", "reset chat"];

const SpeechRecognition =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

function speak(
  text: string,
  onEnd?: () => void,
  onBoundary?: () => void,
) {
  const synth = window.speechSynthesis;
  if (!synth) { onEnd?.(); return; }

  // Cancel anything currently queued/playing
  synth.cancel();

  // Wait 100ms for cancel() to fully process (Chrome async internals),
  // then speak. No voice-loading check — browser uses default voice if none set.
  setTimeout(() => {
    synth.resume(); // un-stick Chrome's silent-pause bug

    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.0;
    u.volume = 1.0;
    if (onBoundary) u.onboundary = onBoundary;

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearInterval(hb);
      onEnd?.();
    };
    u.onend = done;
    u.onerror = (e) => { console.warn("[jarvis] TTS error:", e.error); done(); };

    synth.speak(u);

    // Prevent Chrome from silently pausing long utterances after ~15s
    const hb = setInterval(() => {
      if (!synth.speaking) { done(); return; }
      synth.pause();
      synth.resume();
    }, 5000);
  }, 100);
}

async function captureSnapshot(): Promise<string | null> {
  try {
    const res = await fetch("/api/snapshot");
    const data = await res.json();
    return data.image ?? null;
  } catch {
    return null;
  }
}

function trimImagesForPayload(messages: ChatMessage[]): ChatMessage[] {
  let lastImageIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].image) { lastImageIdx = i; break; }
  }
  return messages.map((m, i) => {
    if (m.image && i !== lastImageIdx) {
      return { ...m, image: undefined, text: m.text || "[sent an image]" };
    }
    return m;
  });
}

// ── Voice-only animated view ─────────────────────────────────────────────────

function VoiceOnlyView({
  phase,
  interimText,
  orbBeat,
}: {
  phase: Phase;
  interimText: string;
  orbBeat: boolean;
}) {
  const active      = phase !== "waiting";
  const isListening = phase === "listening";
  const isThinking  = phase === "processing";

  const GLOW = "59,130,246"; // always blue
  const glowRgb = `rgba(${GLOW},0.55)`;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* Ambient bloom */}
      <div
        className="absolute rounded-full blur-3xl transition-all duration-700"
        style={{
          width: "65%",
          height: "65%",
          background: active ? glowRgb : "transparent",
          opacity: active ? 0.35 : 0,
        }}
      />

      {/* Expanding rings — listening */}
      {isListening &&
        [0, 1, 2].map(i => (
          <div
            key={i}
            className="absolute animate-ping rounded-full border-2 border-blue-400"
            style={{
              width:  `${28 + i * 10}cqmin`,
              height: `${28 + i * 10}cqmin`,
              opacity: 0.45 - i * 0.12,
              animationDelay: `${i * 0.45}s`,
              animationDuration: "1.6s",
            }}
          />
        ))}

      {/* Spinning arc — thinking */}
      {isThinking && (
        <div
          className="absolute animate-spin rounded-full border-2 border-transparent border-t-blue-400 border-r-blue-400/50"
          style={{ width: "26cqmin", height: "26cqmin", animationDuration: "1.1s" }}
        />
      )}

      {/* Central orb — pulses slowly when idle/listening; beats on every spoken word */}
      <div
        className={`relative z-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 transition-all duration-500 ${
          active ? "opacity-100" : "opacity-0 scale-0"
        } ${isListening ? "animate-pulse" : ""}`}
        style={{
          width: "18cqmin",
          height: "18cqmin",
          transform: orbBeat ? "scale(1.38)" : "scale(1)",
          transition: orbBeat
            ? "transform 0.04s ease-out, box-shadow 0.04s ease-out, opacity 0.5s"
            : "transform 0.2s ease-in,  box-shadow 0.2s ease-in,  opacity 0.5s",
          boxShadow: orbBeat
            ? `0 0 30px rgba(${GLOW},0.95), 0 0 60px rgba(${GLOW},0.55)`
            : active
              ? `0 0 18px rgba(${GLOW},0.55), 0 0 40px rgba(${GLOW},0.3)`
              : "none",
          animationDuration: "2s",
        }}
      />

      {/* Status text */}
      <div
        className="absolute bottom-4 left-0 right-0 px-4 text-center transition-opacity duration-300"
        style={{ opacity: active ? 1 : 0 }}
      >
        {isListening && !interimText && (
          <span className="text-white/55" style={{ fontSize: "7cqmin" }}>Listening…</span>
        )}
        {isListening && interimText && (
          <span className="italic text-white/75" style={{ fontSize: "7cqmin" }}>{interimText}</span>
        )}
        {isThinking && (
          <span className="text-white/55" style={{ fontSize: "7cqmin" }}>Thinking…</span>
        )}
      </div>

      {/* Idle hint */}
      {!active && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white/15" style={{ fontSize: "7cqmin" }}>Say "Hey Jarvis"</span>
        </div>
      )}
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

function GeminiChat({ config }: { config?: Record<string, string> }) {
  const mode = config?.mode ?? "chat";
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [interimText, setInterimText] = useState("");
  const [, setSpokenText] = useState("");
  const [orbBeat, setOrbBeat] = useState(false);
  const orbBeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const phaseRef = useRef<Phase>(phase);
  const recogRef = useRef<any>(null);
  const speakIdRef = useRef(0);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase, interimText]);

  const sendToGemini = useCallback(async (text: string, image?: string | null) => {
    const userMsg: ChatMessage = { role: "user", text, image: image ?? undefined };
    const next = [...messagesRef.current, userMsg];
    setMessages(next);
    messagesRef.current = next;
    setPhase("processing");

    try {
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: trimImagesForPayload(next) }),
      });
      const data = await res.json();
      const reply = data.error ? `Error: ${data.error}` : (data.response || "No response.");
      setMessages(m => [...m, { role: "model", text: reply }]);

      if (modeRef.current === "voice") {
        setSpokenText(reply);
        setPhase("speaking");
        const sid = ++speakIdRef.current;
        speak(
          reply,
          () => {
            if (speakIdRef.current !== sid) return; // interrupted — don't reset
            setSpokenText(""); setOrbBeat(false); setPhase("waiting");
          },
          () => {
            if (speakIdRef.current !== sid) return;
            setOrbBeat(true);
            if (orbBeatTimer.current) clearTimeout(orbBeatTimer.current);
            orbBeatTimer.current = setTimeout(() => setOrbBeat(false), 130);
          },
        );
        return; // phase managed by speak callback
      }
    } catch {
      const errMsg = "Sorry, I couldn't reach Gemini.";
      setMessages(m => [...m, { role: "model", text: errMsg }]);
      if (modeRef.current === "voice") {
        setSpokenText(errMsg);
        setPhase("speaking");
        const sid = ++speakIdRef.current;
        speak(errMsg, () => { if (speakIdRef.current === sid) { setSpokenText(""); setOrbBeat(false); setPhase("waiting"); } });
        return;
      }
    } finally {
      // In voice mode, phase transitions are handled by the speak() callback above
      if (modeRef.current !== "voice") {
        setPhase("waiting");
      }
    }
  }, []);

  const handleUtterance = useCallback(async (raw: string) => {
    const lower = raw.toLowerCase().trim();

    if (CLEAR_PHRASES.some(p => lower.includes(p))) {
      setMessages([]);
      messagesRef.current = [];
      setPhase("waiting");
      return;
    }

    let image: string | null = null;
    const text = raw;
    if (CAMERA_PHRASES.some(p => lower.includes(p))) {
      image = await captureSnapshot();
      if (!image) { setPhase("waiting"); return; }
    }

    await sendToGemini(text, image);
  }, [sendToGemini]);

  // Always-on speech recognition loop
  useEffect(() => {
    if (!SpeechRecognition) return;
    let stopped = false;

    function startRecognizer() {
      if (stopped) return;
      const r = new SpeechRecognition();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";

      r.onresult = (e: any) => {
        if (phaseRef.current === "processing") return;

        let interim = "";
        let final_ = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final_ += t;
          else interim += t;
        }

        // While speaking, only watch for the wake phrase to interrupt
        if (phaseRef.current === "speaking") {
          const combined = (interim + final_).toLowerCase();
          if (combined.includes(WAKE_PHRASE)) {
            speakIdRef.current++; // invalidate the active speak's onEnd before cancelling
            window.speechSynthesis.cancel();
            if (orbBeatTimer.current) clearTimeout(orbBeatTimer.current);
            setOrbBeat(false);
            setPhase("listening");
            setInterimText("");
          }
          return;
        }

        // Only show interim text once wake word has been said
        if (interim && phaseRef.current === "listening") setInterimText(interim);

        if (final_) {
          setInterimText("");
          const lower = final_.toLowerCase().trim();

          if (phaseRef.current === "waiting") {
            if (lower.includes(WAKE_PHRASE)) {
              const afterWake = final_.substring(lower.indexOf(WAKE_PHRASE) + WAKE_PHRASE.length).trim();
              // Require at least 3 chars to avoid sending trailing sounds ("s", "ss")
              if (afterWake.length >= 3) {
                setPhase("processing");
                handleUtterance(afterWake);
              } else {
                setPhase("listening");
              }
            }
          } else if (phaseRef.current === "listening") {
            const utterance = final_.trim();
            // Ignore stray sounds left over from the wake word
            if (utterance.length >= 3) {
              setPhase("processing");
              handleUtterance(utterance);
            }
          }
        }
      };

      r.onend = () => {
        if (stopped) return;
        if (phaseRef.current === "listening") setPhase("waiting");
        setTimeout(startRecognizer, 300);
      };

      r.onerror = (e: any) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          stopped = true;
        }
      };

      recogRef.current = r;
      try { r.start(); } catch { /* */ }
    }

    startRecognizer();
    return () => { stopped = true; recogRef.current?.stop(); };
  }, [handleUtterance]);

  if (!SpeechRecognition) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/30">
        Voice not supported in this browser
      </div>
    );
  }

  // ── Voice-only mode ──
  if (mode === "voice") {
    return (
      <VoiceOnlyView phase={phase} interimText={interimText} orbBeat={orbBeat} />
    );
  }

  // ── Chat mode ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && phase === "waiting" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/20">
            <MicIcon className="h-8 w-8" />
            <span className="text-sm">Say &ldquo;Hey Jarvis&rdquo; to start</span>
            <span className="text-xs text-white/15">
              &ldquo;take a picture&rdquo; for camera &middot; &ldquo;clear chat&rdquo; to reset
            </span>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                m.role === "user" ? "bg-blue-600/40 text-white/90" : "bg-white/10 text-white/80"
              }`}
            >
              {m.image && <img src={m.image} alt="captured" className="mb-1.5 max-h-24 rounded" />}
              {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
            </div>
          </div>
        ))}
        {phase === "processing" && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white/50">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">.</span>
                <span className="animate-bounce" style={{ animationDelay: "0.15s" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "0.3s" }}>.</span>
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-white/10 px-3 py-2">
        <StatusIndicator phase={phase} />
        {phase === "waiting" && !interimText && (
          <span className="text-xs text-white/25">Listening for &ldquo;Hey Jarvis&rdquo;</span>
        )}
        {phase === "listening" && !interimText && (
          <span className="text-xs text-white/50">Listening&hellip;</span>
        )}
        {phase === "processing" && (
          <span className="text-xs text-white/40">Thinking&hellip;</span>
        )}
        {interimText && (
          <span className="truncate text-xs italic text-white/40">{interimText}</span>
        )}
      </div>
    </div>
  );
}

function StatusIndicator({ phase }: { phase: Phase }) {
  const color =
    phase === "waiting"
      ? "bg-white/20"
      : phase === "listening"
        ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"
        : phase === "speaking"
          ? "bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.5)]"
          : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color} ${
        phase === "listening" || phase === "speaking" ? "animate-pulse" : ""
      }`}
    />
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
      <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
    </svg>
  );
}

registerWidget({
  id: "gemini-chat",
  name: "Gemini Chat",
  description: "AI chat with image support powered by Google Gemini",
  defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
  component: GeminiChat,
  configFields: [
    {
      key: "mode",
      label: "Display Mode",
      type: "select",
      options: [
        { value: "chat", label: "Chat (text history)" },
        { value: "voice", label: "Voice only (animated orb)" },
      ],
    },
  ],
});

export default GeminiChat;

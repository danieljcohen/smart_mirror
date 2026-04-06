import { useState, useRef, useEffect, useCallback } from "react";
import { registerWidget } from "./registry";

interface ChatMessage {
  role: "user" | "model";
  text: string;
  image?: string;
}

const WAKE_PHRASE = "hey jarvis";
const CAMERA_PHRASES = ["take a picture"];
const CLEAR_PHRASES = ["clear chat", "new conversation", "start over", "reset chat"];

const SpeechRecognition =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

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

function GeminiChat(_: { config?: Record<string, string> }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<"waiting" | "listening" | "processing">("waiting");
  const [interimText, setInterimText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const phaseRef = useRef(phase);
  const recogRef = useRef<any>(null);

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
      setMessages((m) => [...m, { role: "model", text: reply }]);
    } catch {
      const errMsg = "Sorry, I couldn't reach Gemini.";
      setMessages((m) => [...m, { role: "model", text: errMsg }]);
    } finally {
      setPhase("waiting");
    }
  }, []);

  const handleUtterance = useCallback(async (raw: string) => {
    const lower = raw.toLowerCase().trim();

    if (CLEAR_PHRASES.some((p) => lower.includes(p))) {
      setMessages([]);
      messagesRef.current = [];
      setPhase("waiting");
      return;
    }

    let image: string | null = null;
    let text = raw;
    if (CAMERA_PHRASES.some((p) => lower.includes(p))) {
      image = await captureSnapshot();
      if (!image) {
        setPhase("waiting");
        return;
      }
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
          if (e.results[i].isFinal) {
            final_ += t;
          } else {
            interim += t;
          }
        }

        if (interim && phaseRef.current === "listening") setInterimText(interim);

        if (final_) {
          setInterimText("");
          const lower = final_.toLowerCase().trim();

          if (phaseRef.current === "waiting") {
            if (lower.includes(WAKE_PHRASE)) {
              const afterWake = final_.substring(lower.indexOf(WAKE_PHRASE) + WAKE_PHRASE.length).trim();
              if (afterWake) {
                setPhase("processing");
                handleUtterance(afterWake);
              } else {
                setPhase("listening");
              }
            }
          } else if (phaseRef.current === "listening") {
            setPhase("processing");
            handleUtterance(final_.trim());
          }
        }
      };

      r.onend = () => {
        if (stopped) return;
        if (phaseRef.current === "listening") {
          setPhase("waiting");
        }
        setTimeout(startRecognizer, 300);
      };

      r.onerror = (e: any) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          stopped = true;
          return;
        }
      };

      recogRef.current = r;
      try { r.start(); } catch { /* */ }
    }

    startRecognizer();

    return () => {
      stopped = true;
      recogRef.current?.stop();
    };
  }, [handleUtterance]);

  if (!SpeechRecognition) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/30">
        Voice not supported in this browser
      </div>
    );
  }

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
                m.role === "user"
                  ? "bg-blue-600/40 text-white/90"
                  : "bg-white/10 text-white/80"
              }`}
            >
              {m.image && (
                <img src={m.image} alt="captured" className="mb-1.5 max-h-24 rounded" />
              )}
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
          <span className="truncate text-xs text-white/40 italic">{interimText}</span>
        )}
      </div>
    </div>
  );
}

function StatusIndicator({ phase }: { phase: "waiting" | "listening" | "processing" }) {
  const color =
    phase === "waiting"
      ? "bg-white/20"
      : phase === "listening"
        ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"
        : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]";
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${color} ${phase === "listening" ? "animate-pulse" : ""}`} />
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
});

export default GeminiChat;

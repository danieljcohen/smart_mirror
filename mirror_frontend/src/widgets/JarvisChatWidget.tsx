import { useState, useRef, useEffect, useCallback } from "react";
import { registerWidget } from "./registry";
import { useRecognitionContext } from "../hooks/useRecognition";

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

type Phase = "waiting" | "listening" | "processing" | "speaking";

const WAKE_PHRASE = "hey jarvis";
const CLEAR_PHRASES = ["clear chat", "new conversation", "start over", "reset chat"];

const BrowserSpeechRecognition =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

let _ttsAudio: HTMLAudioElement | null = null;

function stopSpeaking() {
  if (_ttsAudio) {
    _ttsAudio.pause();
    _ttsAudio = null;
  }
}

function speak(
  text: string,
  onEnd?: () => void,
  onBoundary?: () => void,
) {
  stopSpeaking();

  fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
    .then((res) => {
      if (!res.ok) throw new Error("TTS request failed");
      return res.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      _ttsAudio = audio;

      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (iv) clearInterval(iv);
        URL.revokeObjectURL(url);
        _ttsAudio = null;
        onEnd?.();
      };

      audio.onended = done;
      audio.onerror = () => { console.warn("[jarvis] TTS playback error"); done(); };

      let iv: ReturnType<typeof setInterval> | null = null;
      if (onBoundary) {
        iv = setInterval(() => {
          if (!_ttsAudio || audio.paused || audio.ended) { if (iv) clearInterval(iv); return; }
          onBoundary();
        }, 200);
      }

      audio.play().catch(() => done());
    })
    .catch(() => onEnd?.());
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

  const GLOW = "59,130,246";
  const glowRgb = `rgba(${GLOW},0.55)`;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div
        className="absolute rounded-full blur-3xl transition-all duration-700"
        style={{
          width: "65%",
          height: "65%",
          background: active ? glowRgb : "transparent",
          opacity: active ? 0.35 : 0,
        }}
      />

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

      {isThinking && (
        <div
          className="absolute animate-spin rounded-full border-2 border-transparent border-t-blue-400 border-r-blue-400/50"
          style={{ width: "26cqmin", height: "26cqmin", animationDuration: "1.1s" }}
        />
      )}

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

      <div
        className="absolute bottom-4 left-0 right-0 px-4 text-center transition-opacity duration-300"
        style={{ opacity: active ? 1 : 0 }}
      >
        {isListening && !interimText && (
          <span className="font-semibold text-white/90" style={{ fontSize: "8.5cqmin" }}>Listening…</span>
        )}
        {isListening && interimText && (
          <span className="font-medium italic text-white/95" style={{ fontSize: "8.5cqmin" }}>{interimText}</span>
        )}
        {isThinking && (
          <span className="font-semibold text-white/90" style={{ fontSize: "8.5cqmin" }}>Thinking…</span>
        )}
      </div>

      {!active && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-semibold text-white/65" style={{ fontSize: "8.5cqmin" }}>Say "Hey Jarvis"</span>
        </div>
      )}
    </div>
  );
}

// ── Backend speech hook (openWakeWord + Deepgram via SSE) ────────────────────

function useBackendSpeech(
  onWake: () => void,
  onPartial: (text: string) => void,
  onCommand: (text: string) => void,
  onTimeout: () => void,
) {
  const onWakeRef = useRef(onWake);
  const onPartialRef = useRef(onPartial);
  const onCommandRef = useRef(onCommand);
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => { onWakeRef.current = onWake; }, [onWake]);
  useEffect(() => { onPartialRef.current = onPartial; }, [onPartial]);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource("/api/speech/stream");
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "wake") onWakeRef.current();
          else if (data.type === "partial") onPartialRef.current(data.text);
          else if (data.type === "command") onCommandRef.current(data.text);
          else if (data.type === "timeout") onTimeoutRef.current();
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es?.close();
        retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => { es?.close(); clearTimeout(retryTimer); };
  }, []);
}

// ── Browser speech hook (Web Speech API fallback for non-Pi) ─────────────────

function useBrowserSpeech(
  onFinal: (text: string) => void,
  onPartial: (text: string) => void,
  phaseRef: React.MutableRefObject<Phase>,
) {
  const onFinalRef = useRef(onFinal);
  const onPartialRef = useRef(onPartial);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  useEffect(() => { onPartialRef.current = onPartial; }, [onPartial]);

  useEffect(() => {
    if (!BrowserSpeechRecognition) return;
    let stopped = false;

    function startRecognizer() {
      if (stopped) return;
      const r = new BrowserSpeechRecognition();
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
        if (interim) onPartialRef.current(interim);
        if (final_) onFinalRef.current(final_);
      };

      r.onend = () => {
        if (!stopped) setTimeout(startRecognizer, 300);
      };

      r.onerror = (e: any) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          stopped = true;
        }
      };

      try { r.start(); } catch { /* */ }
    }

    startRecognizer();
    return () => { stopped = true; };
  }, [phaseRef]);
}

// ── Main widget ───────────────────────────────────────────────────────────────

function JarvisChat({ config }: { config?: Record<string, string> }) {
  const mode = config?.mode ?? "chat";
  const names = useRecognitionContext();
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [interimText, setInterimText] = useState("");
  const [, setSpokenText] = useState("");
  const [orbBeat, setOrbBeat] = useState(false);
  const [useBackend, setUseBackend] = useState<boolean | null>(null);
  const orbBeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const phaseRef = useRef<Phase>(phase);
  const speakIdRef = useRef(0);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase, interimText]);

  // Probe backend to decide which speech source to use
  useEffect(() => {
    fetch("/api/speech/available")
      .then(r => r.json())
      .then(data => setUseBackend(data.available === true))
      .catch(() => setUseBackend(false));
  }, []);

  const sendToJarvis = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { role: "user", text };
    const next = [...messagesRef.current, userMsg];
    setMessages(next);
    messagesRef.current = next;
    setPhase("processing");

    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          person_name: names[0] ?? "",
        }),
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
            if (speakIdRef.current !== sid) return;
            setSpokenText(""); setOrbBeat(false); setPhase("waiting");
          },
          () => {
            if (speakIdRef.current !== sid) return;
            setOrbBeat(true);
            if (orbBeatTimer.current) clearTimeout(orbBeatTimer.current);
            orbBeatTimer.current = setTimeout(() => setOrbBeat(false), 130);
          },
        );
        return;
      }
    } catch {
      const errMsg = "Sorry, I couldn't reach Jarvis.";
      setMessages(m => [...m, { role: "model", text: errMsg }]);
      if (modeRef.current === "voice") {
        setSpokenText(errMsg);
        setPhase("speaking");
        const sid = ++speakIdRef.current;
        speak(errMsg, () => { if (speakIdRef.current === sid) { setSpokenText(""); setOrbBeat(false); setPhase("waiting"); } });
        return;
      }
    } finally {
      if (modeRef.current !== "voice") {
        setPhase("waiting");
      }
    }
  }, [names]);

  const handleUtterance = useCallback(async (raw: string) => {
    const lower = raw.toLowerCase().trim();

    if (CLEAR_PHRASES.some(p => lower.includes(p))) {
      setMessages([]);
      messagesRef.current = [];
      setPhase("waiting");
      return;
    }

    await sendToJarvis(raw);
  }, [sendToJarvis]);

  // ── Backend speech handlers (openWakeWord + Deepgram) ───────────────────────

  const handleWake = useCallback(() => {
    if (phaseRef.current === "processing") return;
    if (phaseRef.current === "speaking") {
      speakIdRef.current++;
      stopSpeaking();
      if (orbBeatTimer.current) clearTimeout(orbBeatTimer.current);
      setOrbBeat(false);
    }
    setPhase("listening");
    setInterimText("");
  }, []);

  const handleBackendPartial = useCallback((text: string) => {
    if (phaseRef.current === "listening") {
      setInterimText(text);
    }
  }, []);

  const handleCommand = useCallback((text: string) => {
    if (!text.trim()) {
      setPhase("waiting");
      setInterimText("");
      return;
    }
    setPhase("processing");
    setInterimText("");
    handleUtterance(text);
  }, [handleUtterance]);

  const handleTimeout = useCallback(() => {
    setPhase("waiting");
    setInterimText("");
  }, []);

  // ── Browser speech handlers (Web Speech API fallback) ──────────────────────

  const handleBrowserFinal = useCallback((text: string) => {
    const lower = text.toLowerCase().trim();
    if (!lower) return;

    if (phaseRef.current === "processing") return;

    if (phaseRef.current === "speaking") {
      if (lower.includes(WAKE_PHRASE)) {
        speakIdRef.current++;
        stopSpeaking();
        if (orbBeatTimer.current) clearTimeout(orbBeatTimer.current);
        setOrbBeat(false);
        setPhase("listening");
        setInterimText("");
      }
      return;
    }

    if (phaseRef.current === "waiting") {
      if (lower.includes(WAKE_PHRASE)) {
        const afterWake = text.substring(lower.indexOf(WAKE_PHRASE) + WAKE_PHRASE.length).trim();
        if (afterWake.length >= 3) {
          setPhase("processing");
          setInterimText("");
          handleUtterance(afterWake);
        } else {
          setPhase("listening");
        }
      }
    } else if (phaseRef.current === "listening") {
      const utterance = text.trim();
      if (utterance.length >= 3) {
        setPhase("processing");
        setInterimText("");
        handleUtterance(utterance);
      }
    }
  }, [handleUtterance]);

  const handleBrowserPartial = useCallback((text: string) => {
    if (phaseRef.current === "processing") return;

    if (phaseRef.current === "speaking") {
      if (text.toLowerCase().includes(WAKE_PHRASE)) {
        speakIdRef.current++;
        stopSpeaking();
        if (orbBeatTimer.current) clearTimeout(orbBeatTimer.current);
        setOrbBeat(false);
        setPhase("listening");
        setInterimText("");
      }
      return;
    }

    if (phaseRef.current === "listening") {
      setInterimText(text);
    }
  }, []);

  // ── Connect to the appropriate speech source ───────────────────────────────

  useBackendSpeech(
    useBackend === true ? handleWake : () => {},
    useBackend === true ? handleBackendPartial : () => {},
    useBackend === true ? handleCommand : () => {},
    useBackend === true ? handleTimeout : () => {},
  );

  useBrowserSpeech(
    useBackend === false ? handleBrowserFinal : () => {},
    useBackend === false ? handleBrowserPartial : () => {},
    phaseRef,
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (useBackend === null) {
    return (
      <div className="flex h-full items-center justify-center text-base font-semibold text-white/75">
        Connecting…
      </div>
    );
  }

  if (!useBackend && !BrowserSpeechRecognition) {
    return (
      <div className="flex h-full items-center justify-center text-center text-base font-semibold text-white/75">
        Voice not supported in this browser
      </div>
    );
  }

  if (mode === "voice") {
    return (
      <VoiceOnlyView phase={phase} interimText={interimText} orbBeat={orbBeat} />
    );
  }

  // ── Chat mode ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && phase === "waiting" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/80">
            <MicIcon className="h-9 w-9 opacity-90" />
            <span className="text-base font-semibold">Say &ldquo;Hey Jarvis&rdquo; to start</span>
            <span className="text-sm font-medium text-white/70">
              Say &ldquo;clear chat&rdquo; to reset
            </span>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-base font-medium leading-relaxed ${
                m.role === "user" ? "bg-blue-600/50 text-white" : "bg-white/15 text-white/95"
              }`}
            >
              {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
            </div>
          </div>
        ))}
        {phase === "processing" && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-white/15 px-3 py-2 text-base font-semibold text-white/85">
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
          <span className="text-sm font-semibold text-white/80">Listening for &ldquo;Hey Jarvis&rdquo;</span>
        )}
        {phase === "listening" && !interimText && (
          <span className="text-sm font-semibold text-white/90">Listening&hellip;</span>
        )}
        {phase === "processing" && (
          <span className="text-sm font-semibold text-white/85">Thinking&hellip;</span>
        )}
        {interimText && (
          <span className="truncate text-sm font-medium italic text-white/85">{interimText}</span>
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
  name: "Jarvis Chat",
  description: "AI chat with image support powered by Jarvis",
  defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
  component: JarvisChat,
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

export default JarvisChat;

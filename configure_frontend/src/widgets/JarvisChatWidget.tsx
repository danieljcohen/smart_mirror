import { registerWidget } from "./registry";

function JarvisChatPreview({ config }: { config?: Record<string, string> }) {
  const mode = config?.mode ?? "chat";

  if (mode === "voice") {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
        {/* Ambient glow */}
        <div
          className="absolute rounded-full blur-3xl opacity-25"
          style={{ width: "65%", height: "65%", background: "rgba(59,130,246,0.55)" }}
        />
        {/* Rings */}
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="absolute animate-ping rounded-full border-2 border-blue-400"
            style={{
              width: `${28 + i * 10}cqmin`,
              height: `${28 + i * 10}cqmin`,
              opacity: 0.45 - i * 0.12,
              animationDelay: `${i * 0.45}s`,
              animationDuration: "1.6s",
            }}
          />
        ))}
        {/* Orb */}
        <div
          className="relative z-10 animate-pulse rounded-full bg-gradient-to-br from-blue-400 to-blue-600"
          style={{
            width: "18cqmin",
            height: "18cqmin",
            boxShadow: "0 0 18px rgba(59,130,246,0.55), 0 0 40px rgba(59,130,246,0.3)",
            animationDuration: "2s",
          }}
        />
        <div className="absolute bottom-4 left-0 right-0 text-center">
          <span className="text-white/40" style={{ fontSize: "7cqmin" }}>
            Listening…
          </span>
        </div>
      </div>
    );
  }

  // Chat mode preview
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5">
      <div className="flex-1 space-y-2 p-3">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-lg bg-blue-600/40 px-3 py-1.5 text-white/90" style={{ fontSize: "7cqmin" }}>
            What's the weather like?
          </div>
        </div>
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-lg bg-white/10 px-3 py-1.5 text-white/80" style={{ fontSize: "7cqmin" }}>
            It looks sunny today!
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-1 border-t border-white/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-white/20" />
          <span className="text-white/25" style={{ fontSize: "6cqmin" }}>
            Say &ldquo;Hey Jarvis&rdquo;
          </span>
        </div>
        <div className="flex items-center gap-1 text-amber-400/60" style={{ fontSize: "5cqmin" }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style={{ width: "5cqmin", height: "5cqmin" }}>
            <path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" />
            <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
          </svg>
          <span>Requires microphone &amp; camera access</span>
        </div>
      </div>
    </div>
  );
}

registerWidget({
  id: "gemini-chat",
  name: "Jarvis Chat",
  description: "AI chat with image support powered by Jarvis",
  defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
  component: JarvisChatPreview,
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

export default JarvisChatPreview;

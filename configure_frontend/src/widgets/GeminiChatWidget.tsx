import { registerWidget } from "./registry";

function GeminiChatPreview(_: { config?: Record<string, string> }) {
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
  name: "Gemini Chat",
  description: "AI chat with image support powered by Google Gemini",
  defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
  component: GeminiChatPreview,
});

export default GeminiChatPreview;

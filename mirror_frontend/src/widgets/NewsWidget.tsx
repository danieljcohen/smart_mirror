import { useEffect, useRef, useState } from "react";
import { registerWidget } from "./registry";

interface Headline {
  title: string;
  source: string;
}

const DISPLAY_MS = 6000;   // how long each headline is shown
const FADE_MS    = 600;    // cross-fade duration

function useHeadlines(source: string) {
  const [headlines, setHeadlines] = useState<Headline[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/news/headlines?source=${encodeURIComponent(source)}`);
        const data = await res.json();
        if (!cancelled && data.status === "OK") setHeadlines(data.headlines ?? []);
      } catch { /* network error — keep previous */ }
    };
    load();
    const interval = setInterval(load, 30 * 60 * 1000); // re-fetch every 30 min
    return () => { cancelled = true; clearInterval(interval); };
  }, [source]);

  return headlines;
}

function NewsWidget({ config }: { config?: Record<string, string> }) {
  const source    = config?.source ?? "bbc";
  const headlines = useHeadlines(source);

  const [idx, setIdx]         = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Advance to next headline with a fade-out/in
  const advance = () => {
    setVisible(false);
    timerRef.current = setTimeout(() => {
      setIdx(i => (i + 1) % Math.max(headlines.length, 1));
      setVisible(true);
    }, FADE_MS);
  };

  // Auto-cycle
  useEffect(() => {
    if (!headlines.length) return;
    const t = setInterval(advance, DISPLAY_MS);
    return () => clearInterval(t);
  }, [headlines.length]);

  // Reset index when source changes or headlines first load
  useEffect(() => { setIdx(0); setVisible(true); }, [source, headlines.length]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const headline = headlines[idx];

  if (!headlines.length) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="font-semibold text-white/75" style={{ fontSize: "7cqmin" }}>Loading news…</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col justify-center overflow-hidden px-3 py-2">
      {/* Source label + dot */}
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="rounded-sm bg-white/25 px-1.5 py-0.5 font-bold uppercase tracking-widest text-white/95"
          style={{ fontSize: "5cqmin" }}
        >
          {headline?.source ?? ""}
        </span>
        {/* Progress dots */}
        <div className="ml-auto flex gap-1">
          {headlines.slice(0, Math.min(headlines.length, 10)).map((_, i) => (
            <span
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                width:      i === idx % 10 ? "6px" : "4px",
                height:     "4px",
                background: i === idx % 10 ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.2)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Headline text — fades between items */}
      <p
        className="font-medium leading-snug text-white/95 transition-opacity"
        style={{
          fontSize:   "7.5cqmin",
          opacity:    visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease-in-out`,
          display:    "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow:   "hidden",
        }}
      >
        {headline?.title ?? ""}
      </p>
    </div>
  );
}

registerWidget({
  id:            "news",
  name:          "News Headlines",
  description:   "Top news headlines scrolling on your mirror",
  defaultLayout: { w: 4, h: 2, minW: 3, minH: 1 },
  component:     NewsWidget,
  configFields: [
    {
      key:     "source",
      label:   "News Source",
      type:    "select",
      options: [
        { value: "bbc",     label: "BBC World News" },
        { value: "bbc_biz", label: "BBC Business" },
        { value: "reuters", label: "Reuters" },
        { value: "ap",      label: "AP News" },
        { value: "ft",      label: "Financial Times" },
        { value: "wsj",     label: "Wall Street Journal" },
      ],
    },
  ],
});

export default NewsWidget;

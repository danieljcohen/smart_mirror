import { useEffect, useRef, useState } from "react";
import { RecognitionContext, useRecognition } from "../hooks/useRecognition";
import { WidgetRenderer } from "../components/WidgetRenderer";
import "../widgets";

interface LayoutItem {
  widgetId: string;
  x: number;  // 0–100 percent of screen width
  y: number;  // 0–100 percent of screen height
  w: number;  // percent of screen width
  h: number;  // percent of screen height
}

// Migrate old grid-coord layout (w≤12, h≤8) to percent
function normalizeLayout(items: LayoutItem[]): LayoutItem[] {
  if (!items.length) return items;
  if (items.every(i => i.w <= 12 && i.h <= 8)) {
    return items.map(i => ({
      ...i,
      x: +((i.x / 12) * 100).toFixed(2),
      y: +((i.y / 8) * 100).toFixed(2),
      w: +((i.w / 12) * 100).toFixed(2),
      h: +((i.h / 8) * 100).toFixed(2),
    }));
  }
  return items;
}

const DEFAULT_LAYOUT: LayoutItem[] = [
  { widgetId: "clock",    x: 0,     y: 0,  w: 33.33, h: 25 },
  { widgetId: "weather",  x: 66.67, y: 0,  w: 33.33, h: 25 },
  { widgetId: "greeting", x: 25,    y: 50, w: 50,    h: 25 },
];

export default function MirrorPage() {
  const names = useRecognition();
  const [layout, setLayout] = useState<LayoutItem[]>(DEFAULT_LAYOUT);
  const lastFetched = useRef<string>("");

  useEffect(() => {
    const primaryName = names[0];
    if (!primaryName || primaryName === lastFetched.current) return;
    lastFetched.current = primaryName;
    fetch(`/api/layout/${encodeURIComponent(primaryName)}`)
      .then(r => r.json())
      .then(data => {
        if (data.layout?.length) setLayout(normalizeLayout(data.layout));
      })
      .catch(() => {});
  }, [names]);

  return (
    <RecognitionContext.Provider value={names}>
      <div className="relative h-screen w-screen overflow-hidden bg-black font-sans">
        {layout.map(item => (
          <div
            key={item.widgetId}
            className="absolute"
            style={{
              left: `${item.x}%`,
              top: `${item.y}%`,
              width: `${item.w}%`,
              height: `${item.h}%`,
              containerType: "size",
            }}
          >
            <WidgetRenderer widgetId={item.widgetId} />
          </div>
        ))}
      </div>
    </RecognitionContext.Provider>
  );
}

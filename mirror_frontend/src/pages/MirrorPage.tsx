import { useEffect, useRef, useState } from "react";
import { GridLayout, useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import { RecognitionContext, useRecognition } from "../hooks/useRecognition";
import { WidgetRenderer } from "../components/WidgetRenderer";
import "../widgets";

interface LayoutItem {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_LAYOUT: LayoutItem[] = [
  { widgetId: "clock", x: 0, y: 0, w: 4, h: 2 },
  { widgetId: "weather", x: 8, y: 0, w: 4, h: 2 },
  { widgetId: "greeting", x: 3, y: 4, w: 6, h: 2 },
];

function toGridLayout(items: LayoutItem[]): Layout {
  return items.map((item) => ({
    i: item.widgetId,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    static: true,
  }));
}

export default function MirrorPage() {
  const names = useRecognition();
  const [layout, setLayout] = useState<LayoutItem[]>(DEFAULT_LAYOUT);
  const lastFetched = useRef<string>("");
  const { ref, width } = useContainerWidth();

  useEffect(() => {
    const primaryName = names[0];
    if (!primaryName || primaryName === lastFetched.current) return;

    lastFetched.current = primaryName;
    fetch(`/api/layout/${encodeURIComponent(primaryName)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.layout?.length) setLayout(data.layout);
      })
      .catch(() => {});
  }, [names]);

  return (
    <RecognitionContext.Provider value={names}>
      <div ref={ref} className="h-screen w-screen bg-black p-6 font-sans">
        {width > 0 && (
          <GridLayout
            width={width}
            layout={toGridLayout(layout)}
            gridConfig={{
              cols: 12,
              rowHeight: 80,
              margin: [16, 16] as const,
              containerPadding: [0, 0] as const,
              maxRows: Infinity,
            }}
            dragConfig={{ enabled: false, bounded: false, threshold: 3 }}
            resizeConfig={{ enabled: false, handles: [] }}
            autoSize
          >
            {layout.map((item) => (
              <div key={item.widgetId}>
                <WidgetRenderer widgetId={item.widgetId} />
              </div>
            ))}
          </GridLayout>
        )}
      </div>
    </RecognitionContext.Provider>
  );
}

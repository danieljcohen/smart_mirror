import { useCallback, useEffect, useRef, useState } from "react";
import { getAllWidgets, getWidget } from "../widgets";
import { WidgetRenderer } from "./WidgetRenderer";

const ASPECT = 16 / 9;
const MIN_W = 8;  // minimum % width
const MIN_H = 8;  // minimum % height

interface LayoutItem {
  widgetId: string;
  x: number;  // 0–100 percent of container width
  y: number;  // 0–100 percent of container height
  w: number;  // percent of container width
  h: number;  // percent of container height
}

interface LayoutEditorProps {
  token: string;
  userName: string;
  onLogout: () => void;
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

type DragState = {
  widgetId: string;
  mode: "drag" | "resize";
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
};

export function LayoutEditor({ token, userName, onLogout }: LayoutEditorProps) {
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    fetch("/api/layout", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        setLayout(normalizeLayout(data.layout || []));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [token]);

  // Global pointer move/up — stable, mounted once
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = ((e.clientX - d.startX) / rect.width) * 100;
      const dy = ((e.clientY - d.startY) / rect.height) * 100;

      setLayout(prev =>
        prev.map(item => {
          if (item.widgetId !== d.widgetId) return item;
          if (d.mode === "drag") {
            return {
              ...item,
              x: Math.max(0, Math.min(100 - item.w, d.origX + dx)),
              y: Math.max(0, Math.min(100 - item.h, d.origY + dy)),
            };
          } else {
            return {
              ...item,
              w: Math.max(MIN_W, Math.min(100 - d.origX, d.origW + dx)),
              h: Math.max(MIN_H, Math.min(100 - d.origY, d.origH + dy)),
            };
          }
        })
      );
    };

    const onUp = () => { dragRef.current = null; };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const startInteraction = useCallback(
    (e: React.PointerEvent, widgetId: string, mode: "drag" | "resize") => {
      e.preventDefault();
      e.stopPropagation();
      const item = layout.find(i => i.widgetId === widgetId);
      if (!item) return;
      dragRef.current = {
        widgetId, mode,
        startX: e.clientX, startY: e.clientY,
        origX: item.x, origY: item.y,
        origW: item.w, origH: item.h,
      };
    },
    [layout]
  );

  const addWidget = useCallback((widgetId: string) => {
    setLayout(prev => {
      if (prev.some(i => i.widgetId === widgetId)) return prev;
      const def = getWidget(widgetId);
      const dl = def?.defaultLayout ?? { w: 4, h: 2 };
      return [...prev, {
        widgetId,
        x: 5,
        y: 5,
        w: +((dl.w / 12) * 100).toFixed(2),
        h: +((dl.h / 8) * 100).toFixed(2),
      }];
    });
  }, []);

  const removeWidget = useCallback((widgetId: string) => {
    setLayout(prev => prev.filter(i => i.widgetId !== widgetId));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ layout }),
      });
      if (!res.ok) throw new Error();
      setSaveMsg("Saved!");
    } catch {
      setSaveMsg("Failed to save");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 2000);
    }
  }, [token, layout]);

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading...
      </div>
    );
  }

  const allWidgets = getAllWidgets();
  const activeIds = new Set(layout.map(i => i.widgetId));

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-light text-white">Layout Editor</h1>
            <p className="text-sm text-zinc-500">Signed in as {userName}</p>
          </div>
          <div className="flex items-center gap-3">
            {saveMsg && (
              <span className={`text-sm ${saveMsg === "Saved!" ? "text-green-400" : "text-red-400"}`}>
                {saveMsg}
              </span>
            )}
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Layout"}
            </button>
            <button
              onClick={onLogout}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* 16:9 preview — widgets placed freely by percent coordinates */}
        <div
          ref={containerRef}
          className="relative w-full select-none overflow-hidden rounded-2xl border border-zinc-800 bg-black"
          style={{ aspectRatio: `${ASPECT}` }}
        >
          {layout.length === 0 && (
            <div className="flex h-full items-center justify-center text-zinc-500">
              Add widgets below to get started
            </div>
          )}
          {layout.map(item => (
            <div
              key={item.widgetId}
              className="group absolute cursor-grab rounded-xl border border-zinc-700 bg-zinc-900/60 hover:border-zinc-500 active:cursor-grabbing active:border-blue-500/60"
              style={{
                left: `${item.x}%`,
                top: `${item.y}%`,
                width: `${item.w}%`,
                height: `${item.h}%`,
                containerType: "size",
              }}
              onPointerDown={e => startInteraction(e, item.widgetId, "drag")}
            >
              {/* Remove button */}
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => removeWidget(item.widgetId)}
                className="absolute right-1.5 top-1.5 z-20 hidden rounded bg-red-500/80 px-1.5 py-0.5 text-xs text-white group-hover:block"
              >
                ✕
              </button>

              {/* Widget content */}
              <div className="h-full w-full overflow-hidden rounded-xl p-2">
                <WidgetRenderer widgetId={item.widgetId} />
              </div>

              {/* Resize handle — bottom-right corner */}
              <div
                className="absolute bottom-0 right-0 z-20 h-7 w-7 cursor-se-resize"
                onPointerDown={e => startInteraction(e, item.widgetId, "resize")}
              >
                <svg viewBox="0 0 16 16" className="h-full w-full p-1 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-90">
                  <path d="M13 13H7M13 13V7M13 13L7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                </svg>
              </div>
            </div>
          ))}
        </div>

        {/* Widget picker */}
        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">Widgets</h2>
          <div className="flex flex-wrap gap-3">
            {allWidgets.map(w => {
              const active = activeIds.has(w.id);
              return (
                <button
                  key={w.id}
                  onClick={() => active ? removeWidget(w.id) : addWidget(w.id)}
                  className={`rounded-xl border px-5 py-3 text-left transition ${
                    active
                      ? "border-blue-500/50 bg-blue-500/10 text-white"
                      : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  <div className="font-medium">{w.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{w.description}</div>
                  <div className="mt-1 text-xs text-zinc-600">{active ? "Click to remove" : "Click to add"}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

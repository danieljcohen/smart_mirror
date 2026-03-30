import { useCallback, useEffect, useState } from "react";
import { GridLayout, useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import { getAllWidgets, getWidget } from "../widgets";
import { WidgetRenderer } from "./WidgetRenderer";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

interface LayoutItem {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayoutEditorProps {
  token: string;
  userName: string;
  onLogout: () => void;
}

function toGridLayout(items: LayoutItem[]): Layout {
  return items.map((item) => {
    const def = getWidget(item.widgetId);
    return {
      i: item.widgetId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: def?.defaultLayout.minW ?? 2,
      minH: def?.defaultLayout.minH ?? 2,
    };
  });
}

export function LayoutEditor({ token, userName, onLogout }: LayoutEditorProps) {
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [loaded, setLoaded] = useState(false);
  const { ref, width } = useContainerWidth();

  useEffect(() => {
    fetch("/api/layout", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setLayout(data.layout || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [token]);

  const handleLayoutChange = useCallback((gridLayout: Layout) => {
    setLayout((prev) =>
      prev.map((item) => {
        const gl = gridLayout.find((g) => g.i === item.widgetId);
        if (!gl) return item;
        return { ...item, x: gl.x, y: gl.y, w: gl.w, h: gl.h };
      }),
    );
  }, []);

  const addWidget = useCallback((widgetId: string) => {
    setLayout((prev) => {
      if (prev.some((i) => i.widgetId === widgetId)) return prev;
      const def = getWidget(widgetId);
      const dl = def?.defaultLayout ?? { w: 4, h: 2 };
      return [...prev, { widgetId, x: 0, y: Infinity, w: dl.w, h: dl.h }];
    });
  }, []);

  const removeWidget = useCallback((widgetId: string) => {
    setLayout((prev) => prev.filter((i) => i.widgetId !== widgetId));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/layout", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
  const activeIds = new Set(layout.map((i) => i.widgetId));

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

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="flex gap-6">
          <aside className="w-64 shrink-0">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
              Widgets
            </h2>
            <div className="space-y-2">
              {allWidgets.map((w) => {
                const active = activeIds.has(w.id);
                return (
                  <button
                    key={w.id}
                    onClick={() => (active ? removeWidget(w.id) : addWidget(w.id))}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-blue-500/50 bg-blue-500/10 text-white"
                        : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
                    }`}
                  >
                    <div className="font-medium">{w.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">{w.description}</div>
                    <div className="mt-1 text-xs text-zinc-600">
                      {active ? "Click to remove" : "Click to add"}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div ref={ref} className="flex-1 rounded-2xl border border-zinc-800 bg-black p-4">
            {layout.length === 0 ? (
              <div className="flex h-96 items-center justify-center text-zinc-500">
                Add widgets from the sidebar to get started
              </div>
            ) : width > 0 ? (
              <GridLayout
                width={width}
                layout={toGridLayout(layout)}
                gridConfig={{
                  cols: 12,
                  rowHeight: 80,
                  margin: [12, 12] as const,
                  containerPadding: [0, 0] as const,
                  maxRows: Infinity,
                }}
                dragConfig={{ enabled: true, bounded: false, threshold: 3 }}
                resizeConfig={{ enabled: true, handles: ["se"] }}
                onLayoutChange={handleLayoutChange}
                autoSize
              >
                {layout.map((item) => (
                  <div
                    key={item.widgetId}
                    className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50"
                  >
                    <button
                      onClick={() => removeWidget(item.widgetId)}
                      className="absolute right-2 top-2 z-10 hidden rounded-md bg-red-500/80 px-2 py-0.5 text-xs text-white group-hover:block"
                    >
                      Remove
                    </button>
                    <div className="h-full p-3">
                      <WidgetRenderer widgetId={item.widgetId} />
                    </div>
                  </div>
                ))}
              </GridLayout>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

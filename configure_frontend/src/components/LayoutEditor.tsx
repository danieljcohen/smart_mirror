import { useCallback, useEffect, useRef, useState } from "react";
import { getAllWidgets, getWidget } from "../widgets";
import { WidgetRenderer } from "./WidgetRenderer";
import { type LayoutItem, getUser, loadLayout, saveLayout, loadDefaultLayout, saveDefaultLayout } from "../db/layout";
import { getMirrorLocation, setMirrorLocation } from "../db/settings";
import { saveWhoopCredentials, getWhoopCredentials } from "../db/whoop";
import { AddressInput } from "./AddressInput";

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_SCOPES   = "read:recovery read:sleep read:cycles read:profile offline";

type LayoutMode = "user" | "default";

const ASPECT = 16 / 9;
const MIN_W = 8;
const MIN_H = 8;

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

interface LayoutEditorProps {
  userName: string;
  onLogout: () => void;
  onRegister: () => void;
}

export function LayoutEditor({ userName, onLogout, onRegister }: LayoutEditorProps) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("user");
  const [userId, setUserId] = useState<number | null>(null);
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [defaultLayout, setDefaultLayout] = useState<LayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [mirrorLocation, setMirrorLocationState] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationMsg, setLocationMsg] = useState("");

  const [configPanelId, setConfigPanelId] = useState<string | null>(null);
  const [mirrorSettingsOpen, setMirrorSettingsOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragModeRef = useRef<LayoutMode>("user");
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        const [uid, loc, defLayout] = await Promise.all([
          getUser(userName),
          getMirrorLocation(),
          loadDefaultLayout(),
        ]);
        if (uid === null) { onLogout(); return; }
        const [remote, whoopCreds] = await Promise.all([
          loadLayout(uid, userName),
          getWhoopCredentials(uid),
        ]);
        if (!cancelled) {
          setUserId(uid);
          // Pre-populate Whoop client_id/client_secret from whoop_credentials
          // so the user never has to re-enter them.
          const hydratedLayout = whoopCreds
            ? remote.map(item => {
                if (item.widgetId !== "whoop") return item;
                const cfg = item.config ?? {};
                if (cfg.client_id && cfg.client_secret) return item;
                return {
                  ...item,
                  config: {
                    ...cfg,
                    client_id:     cfg.client_id     || whoopCreds.client_id,
                    client_secret: cfg.client_secret || whoopCreds.client_secret,
                  },
                };
              })
            : remote;
          setLayout(hydratedLayout);
          setDefaultLayout(defLayout);
          setMirrorLocationState(loc);
        }
      } catch (err) {
        console.error("[LayoutEditor] init error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [userName]);

  // Global pointer handlers for drag & resize
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = ((e.clientX - d.startX) / rect.width) * 100;
      const dy = ((e.clientY - d.startY) / rect.height) * 100;

      const updater = (prev: LayoutItem[]) =>
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
        });

      if (d.mode === "drag" || d.mode === "resize") {
        if (dragModeRef.current === "default") {
          setDefaultLayout(updater);
        } else {
          setLayout(updater);
        }
      }
      dirtyRef.current = true;
    };

    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const activeLayout    = layoutMode === "user" ? layout    : defaultLayout;
  const setActiveLayout = layoutMode === "user" ? setLayout : setDefaultLayout;

  const startInteraction = useCallback(
    (e: React.PointerEvent, widgetId: string, mode: "drag" | "resize") => {
      e.preventDefault();
      e.stopPropagation();
      const item = activeLayout.find(i => i.widgetId === widgetId);
      if (!item) return;
      dragModeRef.current = layoutMode;
      dragRef.current = {
        widgetId, mode,
        startX: e.clientX, startY: e.clientY,
        origX: item.x, origY: item.y,
        origW: item.w, origH: item.h,
      };
    },
    [activeLayout, layoutMode]
  );

  const applyReelsmaxx = useCallback(() => {
    const cols = 8;
    const rows = 3;
    const w = 100 / cols;
    const h = 100 / rows;
    const items: LayoutItem[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        items.push({
          widgetId: `reels#${r * cols + c}`,
          x: +(c * w).toFixed(2),
          y: +(r * h).toFixed(2),
          w: +w.toFixed(2),
          h: +h.toFixed(2),
          config: { source_type: "trending", quality: "small" },
        });
      }
    }
    setActiveLayout(items);
    setConfigPanelId(null);
    dirtyRef.current = true;
  }, [setActiveLayout]);

  const clearLayout = useCallback(() => {
    setActiveLayout([]);
    setConfigPanelId(null);
    dirtyRef.current = true;
  }, [setActiveLayout]);

  const addWidget = useCallback((widgetId: string) => {
    setActiveLayout(prev => {
      if (prev.some(i => i.widgetId === widgetId)) return prev;
      const def = getWidget(widgetId);
      const dl = def?.defaultLayout ?? { w: 4, h: 2 };
      return [...prev, {
        widgetId,
        x: 5, y: 5,
        w: +((dl.w / 12) * 100).toFixed(2),
        h: +((dl.h / 8) * 100).toFixed(2),
      }];
    });
    dirtyRef.current = true;
  }, [setActiveLayout]);

  const removeWidget = useCallback((widgetId: string) => {
    setActiveLayout(prev => prev.filter(i => i.widgetId !== widgetId));
    if (configPanelId === widgetId) setConfigPanelId(null);
    dirtyRef.current = true;
  }, [configPanelId, setActiveLayout]);

  const updateWidgetConfig = useCallback((widgetId: string, key: string, value: string) => {
    setActiveLayout(prev =>
      prev.map(item =>
        item.widgetId === widgetId
          ? { ...item, config: { ...(item.config ?? {}), [key]: value } }
          : item
      )
    );
    dirtyRef.current = true;
  }, [setActiveLayout]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      if (layoutMode === "default") {
        await saveDefaultLayout(defaultLayout);
      } else {
        const freshId = await getUser(userName);
        if (!freshId) { onLogout(); return; }
        setUserId(freshId);
        await saveLayout(freshId, userName, layout);
      }
      setSaveMsg("Saved!");
      dirtyRef.current = false;
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const handleSaveMirrorLocation = async () => {
    setLocationSaving(true);
    setLocationMsg("");
    try {
      await setMirrorLocation(mirrorLocation.trim());
      setLocationMsg("Saved!");
    } catch (err) {
      setLocationMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLocationSaving(false);
      setTimeout(() => setLocationMsg(""), 3000);
    }
  };

  const allWidgets = getAllWidgets();
  const activeIds = new Set(activeLayout.map(i => i.widgetId));

  const configPanelWidget = configPanelId ? getWidget(configPanelId) : null;
  const configPanelItem = configPanelId ? activeLayout.find(i => i.widgetId === configPanelId) : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="text-zinc-400">Loading layout…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-light text-white">Layout Editor</h1>
              <p className="text-sm text-zinc-500">{userName}</p>
            </div>
            {/* Mode tabs */}
            <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-sm">
              <button
                onClick={() => { setLayoutMode("user"); setConfigPanelId(null); }}
                className={`px-4 py-1.5 transition ${layoutMode === "user" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                My Layout
              </button>
              <button
                onClick={() => { setLayoutMode("default"); setConfigPanelId(null); }}
                className={`px-4 py-1.5 transition border-l border-zinc-700 ${layoutMode === "default" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                Default Layout
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saveMsg && (
              <span className={`text-sm ${saveMsg === "Saved!" ? "text-green-400" : "text-red-400"}`}>
                {saveMsg}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !userId}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={clearLayout}
              disabled={activeLayout.length === 0}
              title="Remove every widget from this layout"
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:bg-transparent disabled:hover:text-zinc-300"
            >
              Clear Layout
            </button>
            <button
              onClick={applyReelsmaxx}
              title="Fill layout with Reels instances"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 transition hover:border-amber-400/70 hover:bg-amber-500/20 hover:text-amber-100"
            >
              ReelsMax
            </button>
            <button
              onClick={() => setMirrorSettingsOpen(true)}
              title="Mirror Settings"
              className="rounded-lg bg-zinc-800 p-2 text-zinc-400 transition hover:bg-zinc-700 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .205 1.251l-1.18 2.044a1 1 0 0 1-1.186.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.113a7.048 7.048 0 0 1 0-2.228L1.821 7.773a1 1 0 0 1-.205-1.251l1.18-2.044a1 1 0 0 1 1.186-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={onRegister}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
            >
              Register Face
            </button>
            <button
              onClick={onLogout}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
            >
              Switch user
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* 16:9 mirror preview */}
        <div
          ref={containerRef}
          className="relative w-full select-none overflow-hidden rounded-2xl border border-zinc-800 bg-black"
          style={{ aspectRatio: `${ASPECT}` }}
        >
          {activeLayout.length === 0 && (
            <div className="flex h-full items-center justify-center text-zinc-500">
              {layoutMode === "default"
                ? "Add widgets to build the default mirror layout"
                : "Add widgets below to get started"}
            </div>
          )}
          {activeLayout.map(item => (
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
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => removeWidget(item.widgetId)}
                className="absolute right-1.5 top-1.5 z-20 hidden rounded bg-red-500/80 px-1.5 py-0.5 text-xs text-white group-hover:block"
              >
                ✕
              </button>
              <div className="h-full w-full overflow-hidden rounded-xl p-2">
                <WidgetRenderer widgetId={item.widgetId} config={item.config} />
              </div>
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
              const hasConfig = active && (w.configFields?.length ?? 0) > 0;
              const isConfigOpen = configPanelId === w.id;
              return (
                <div key={w.id} className="flex flex-col gap-0">
                  <div className="flex items-stretch gap-px">
                    <button
                      onClick={() => active ? removeWidget(w.id) : addWidget(w.id)}
                      className={`rounded-xl border px-5 py-3 text-left transition ${
                        hasConfig ? "rounded-r-none border-r-0" : ""
                      } ${
                        active
                          ? "border-blue-500/50 bg-blue-500/10 text-white"
                          : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
                      }`}
                    >
                      <div className="font-medium">{w.name}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">{w.description}</div>
                      <div className="mt-1 text-xs text-zinc-600">{active ? "Click to remove" : "Click to add"}</div>
                    </button>
                    {hasConfig && (
                      <button
                        onClick={() => setConfigPanelId(isConfigOpen ? null : w.id)}
                        className={`rounded-r-xl border px-3 text-zinc-400 transition hover:text-white ${
                          isConfigOpen
                            ? "border-blue-500/50 bg-blue-500/20 text-blue-300"
                            : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                        }`}
                        title="Configure widget"
                      >
                        ⚙
                      </button>
                    )}
                  </div>

                  {/* Inline config panel */}
                  {isConfigOpen && configPanelWidget?.configFields && configPanelItem && (
                    <div className="mt-1 rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                        {configPanelWidget.name} Settings
                      </p>
                      {configPanelWidget.configFields.map(field => (
                        <div key={field.key} className="space-y-1">
                          <label className="block text-xs text-zinc-400">{field.label}</label>
                          {field.type === "select" ? (
                            <select
                              value={configPanelItem.config?.[field.key] ?? ""}
                              onChange={e => updateWidgetConfig(w.id, field.key, e.target.value)}
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                            >
                              <option value="">— select —</option>
                              {field.options?.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          ) : field.type === "address" ? (
                            <AddressInput
                              value={configPanelItem.config?.[field.key] ?? ""}
                              onChange={val => updateWidgetConfig(w.id, field.key, val)}
                              placeholder={field.placeholder}
                            />
                          ) : field.type === "connect" ? (
                            <button
                              onClick={async () => {
                                const cfg        = configPanelItem.config ?? {};
                                const clientId     = (cfg.client_id     ?? "").trim();
                                const clientSecret = (cfg.client_secret ?? "").trim();
                                if (!clientId || !clientSecret) {
                                  alert("Enter your Whoop Client ID and Client Secret first.");
                                  return;
                                }
                                const uid = await getUser(userName);
                                if (!uid) { alert("User not found — register your face first."); return; }
                                await saveWhoopCredentials(uid, clientId, clientSecret);
                                // Persist so credentials are pre-populated on return without Save.
                                await saveLayout(uid, userName, layout);
                                const redirectUri = window.location.origin + "/";
                                const state = `${userName}::${Math.random().toString(36).slice(2).padEnd(8, "0")}`;
                                const params = new URLSearchParams({
                                  client_id:     clientId,
                                  redirect_uri:  redirectUri,
                                  response_type: "code",
                                  scope:         WHOOP_SCOPES,
                                  state,
                                });
                                window.location.href = `${WHOOP_AUTH_URL}?${params}`;
                              }}
                              className="w-full rounded-lg border border-zinc-600 bg-zinc-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-600 active:bg-zinc-500"
                            >
                              {field.label}
                            </button>
                          ) : (
                            <input
                              type={field.password ? "password" : "text"}
                              value={configPanelItem.config?.[field.key] ?? ""}
                              onChange={e => updateWidgetConfig(w.id, field.key, e.target.value)}
                              placeholder={field.placeholder}
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-blue-500"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Mirror Settings modal */}
      {mirrorSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setMirrorSettingsOpen(false); }}
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl space-y-5 mx-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-light text-white">Mirror Settings</h2>
              <button
                onClick={() => setMirrorSettingsOpen(false)}
                className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Mirror Location */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-300">Mirror Location</label>
              <p className="text-xs text-zinc-500">
                The address where this mirror is installed. Used as the origin for the Transit widget and for weather.
              </p>
              <AddressInput
                value={mirrorLocation}
                onChange={setMirrorLocationState}
                placeholder="e.g. 350 5th Ave, New York, NY 10118"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              {locationMsg && (
                <span className={`text-sm ${locationMsg === "Saved!" ? "text-green-400" : "text-red-400"}`}>
                  {locationMsg}
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setMirrorSettingsOpen(false)}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    await handleSaveMirrorLocation();
                    setTimeout(() => setMirrorSettingsOpen(false), 800);
                  }}
                  disabled={locationSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {locationSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

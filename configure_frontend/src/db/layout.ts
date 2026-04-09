import { supabase } from "../lib/supabase";

export interface LayoutItem {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, string>;
}

// ── User ────────────────────────────────────────────────────────────

/**
 * Look up a registered user by name. Returns their id or null if not found.
 * Does NOT create the user — registration happens via the Pi backend.
 */
export async function getUser(name: string): Promise<number | null> {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("name", name)
    .limit(1);

  return data && data.length > 0 ? (data[0].id as number) : null;
}

// ── Layout ──────────────────────────────────────────────────────────

const CACHE_KEY = (name: string) => `mirror:layout:${name.toLowerCase()}`;

/** Load layout from Supabase, falling back to localStorage cache. */
export async function loadLayout(userId: number, userName: string): Promise<LayoutItem[]> {  
  try {
    const { data } = await supabase
      .from("layouts")
      .select("layout_json")
      .eq("user_id", userId)
      .limit(1);

    if (data && data.length > 0) {
      const layout = data[0].layout_json as LayoutItem[];
      // Update local cache
      localStorage.setItem(CACHE_KEY(userName), JSON.stringify(layout));
      return layout;
    }
  } catch (err) {
    console.warn("[layout] Supabase load failed, using cache:", err);
  }

  // Fallback to localStorage
  const cached = localStorage.getItem(CACHE_KEY(userName));
  return cached ? (JSON.parse(cached) as LayoutItem[]) : [];
}

/** Save layout to Supabase and update localStorage cache. */
export async function saveLayout(userId: number, userName: string, layout: LayoutItem[]): Promise<void> {
  localStorage.setItem(CACHE_KEY(userName), JSON.stringify(layout));

  const { error } = await supabase.from("layouts").upsert(
    { user_id: userId, layout_json: layout, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );

  if (error) throw new Error(`Failed to save layout: ${error.message}`);
}

// ── Default layout ───────────────────────────────────────────────────

const DEFAULT_CACHE_KEY = "mirror:layout:__default__";

/** Load the mirror-wide default layout (shown when no user is recognised). */
export async function loadDefaultLayout(): Promise<LayoutItem[]> {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "default_layout")
      .limit(1);

    if (data && data.length > 0) {
      const layout = JSON.parse(data[0].value) as LayoutItem[];
      localStorage.setItem(DEFAULT_CACHE_KEY, JSON.stringify(layout));
      return layout;
    }
  } catch (err) {
    console.warn("[layout] default load failed, using cache:", err);
  }

  const cached = localStorage.getItem(DEFAULT_CACHE_KEY);
  return cached ? (JSON.parse(cached) as LayoutItem[]) : [];
}

/** Save the mirror-wide default layout to Supabase. */
export async function saveDefaultLayout(layout: LayoutItem[]): Promise<void> {
  localStorage.setItem(DEFAULT_CACHE_KEY, JSON.stringify(layout));

  const { error } = await supabase
    .from("settings")
    .upsert({ key: "default_layout", value: JSON.stringify(layout) }, { onConflict: "key" });

  if (error) throw new Error(`Failed to save default layout: ${error.message}`);
}

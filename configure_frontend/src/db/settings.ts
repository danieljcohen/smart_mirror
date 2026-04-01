import { supabase } from "../lib/supabase";

export async function getMirrorLocation(): Promise<string> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "mirror_location")
    .limit(1);
  return data && data.length > 0 ? (data[0].value as string) : "";
}

export async function setMirrorLocation(address: string): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key: "mirror_location", value: address }, { onConflict: "key" });
  if (error) throw new Error(`Failed to save mirror location: ${error.message}`);
}

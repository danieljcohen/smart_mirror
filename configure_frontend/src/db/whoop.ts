import { supabase } from "../lib/supabase";

export async function saveWhoopCredentials(userId: number, clientId: string, clientSecret: string) {
  const { error } = await supabase
    .from("whoop_credentials")
    .upsert(
      { user_id: userId, client_id: clientId, client_secret: clientSecret },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
}

export async function getWhoopCredentials(userId: number): Promise<{ client_id: string; client_secret: string } | null> {
  const { data } = await supabase
    .from("whoop_credentials")
    .select("client_id, client_secret")
    .eq("user_id", userId)
    .limit(1);
  return data?.[0] ?? null;
}

export async function saveWhoopTokens(
  userId: number,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
) {
  const { error } = await supabase
    .from("whoop_credentials")
    .update({ access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

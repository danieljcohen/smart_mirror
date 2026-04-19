export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { code, redirect_uri, client_id, client_secret } = req.body;
  if (!code || !redirect_uri || !client_id || !client_secret) {
    return res.status(400).json({ error: "missing required fields" });
  }

  const resp = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri,
      client_id,
      client_secret,
    }),
  });

  const data = await resp.json();
  return res.status(resp.status).json(data);
}

import { useEffect, useState } from "react";
import { useUser } from "./hooks/useUser";
import { NameEntry } from "./components/NameEntry";
import { LayoutEditor } from "./components/LayoutEditor";
import { RegisterFace } from "./components/RegisterFace";
import { getUser } from "./db/layout";
import { getWhoopCredentials, saveWhoopTokens } from "./db/whoop";
import "./widgets";

type View = "login" | "editor" | "register";

export default function App() {
  const { name, login, logout } = useUser();
  const [view, setView] = useState<View>(name ? "editor" : "login");
  const [whoopMsg, setWhoopMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Handle Whoop OAuth callback: Whoop redirects back here with ?code=...&state=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code  = params.get("code");
    const state = params.get("state"); // format: "userName::randomSuffix"

    if (!code || !state) return;

    // Parse userName from state (format: "userName::randomSuffix")
    const userName = state.split("::")[0];
    if (!userName) return;

    // Clean the URL immediately so refreshing doesn't re-trigger
    window.history.replaceState({}, "", window.location.pathname);

    (async () => {
      try {
        const uid = await getUser(userName);
        if (!uid) throw new Error("user not found");

        const creds = await getWhoopCredentials(uid);
        if (!creds) throw new Error("credentials not found — enter Client ID and Secret first");

        const redirectUri = window.location.origin + "/";
        const resp = await fetch("/api/whoop-exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            redirect_uri:  redirectUri,
            client_id:     creds.client_id,
            client_secret: creds.client_secret,
          }),
        });
        if (!resp.ok) {
          const err = await resp.text();
          throw new Error(err);
        }
        const td = await resp.json();
        const expiresAt = Date.now() / 1000 + (td.expires_in ?? 3600);
        await saveWhoopTokens(uid, td.access_token, td.refresh_token ?? "", expiresAt);

        setWhoopMsg({ ok: true, text: "Whoop connected successfully!" });
      } catch (e) {
        setWhoopMsg({ ok: false, text: `Whoop connection failed: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      setTimeout(() => setWhoopMsg(null), 5000);
    })();
  }, []);

  const handleLogin = (userName: string) => {
    login(userName);
    setView("editor");
  };

  const handleLogout = () => {
    logout();
    setView("login");
  };

  const handleRegisterSuccess = (registeredName: string) => {
    login(registeredName);
    setView("editor");
  };

  if (view === "register") {
    return (
      <RegisterFace
        defaultName={name ?? ""}
        onBack={() => setView(name ? "editor" : "login")}
        onSuccess={handleRegisterSuccess}
      />
    );
  }

  if (!name || view === "login") {
    return (
      <NameEntry
        onLogin={handleLogin}
        onRegister={() => setView("register")}
      />
    );
  }

  return (
    <>
      {whoopMsg && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg transition-all ${
            whoopMsg.ok ? "bg-green-600" : "bg-red-600"
          }`}
        >
          {whoopMsg.text}
        </div>
      )}
      <LayoutEditor
        userName={name}
        onLogout={handleLogout}
        onRegister={() => setView("register")}
      />
    </>
  );
}

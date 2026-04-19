import { useEffect, useState } from "react";
import { registerWidget } from "./registry";
import { useRecognitionContext } from "../hooks/useRecognition";

interface WhoopMetrics {
  recovery_score:    number | null;
  hrv:               number | null;
  resting_hr:        number | null;
  spo2:              number | null;
  sleep_performance: number | null;
  strain:            number | null;
  calories:          number | null;
}

const REFRESH_MS = 30 * 60 * 1000;

function useWhoopMetrics(userName: string) {
  const [data, setData]     = useState<WhoopMetrics | null>(null);
  const [status, setStatus] = useState<string>("loading");

  useEffect(() => {
    if (!userName) { setStatus("no_user"); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const res  = await fetch(`/api/whoop/metrics?user=${encodeURIComponent(userName)}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.status === "OK") {
          setData(json);
          setStatus("ok");
        } else {
          setStatus(json.status ?? "error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [userName]);

  return { data, status };
}

function recoveryColor(score: number | null): string {
  if (score === null) return "#ffffff";
  if (score >= 67) return "#4ade80";
  if (score >= 34) return "#fde047";
  return "#f87171";
}

function RecoveryRing({ score }: { score: number | null }) {
  const r     = 38;
  const circ  = 2 * Math.PI * r;
  const fill  = score !== null ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const dash  = circ * fill;
  const color = recoveryColor(score);
  const label = score !== null ? `${score}%` : "–";

  return (
    <div className="relative flex items-center justify-center" style={{ width: "5.5rem", height: "5.5rem", flexShrink: 0 }}>
      <svg width="88" height="88" viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease", filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span style={{ fontSize: "5.5cqmin", fontWeight: 800, color, textShadow: `0 0 12px ${color}` }}>{label}</span>
        <span style={{ fontSize: "3cqmin", color: "#ffffff", marginTop: 1, fontWeight: 600, letterSpacing: "0.08em" }}>REC</span>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  const display = value !== null ? `${value}${unit ?? ""}` : "–";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span style={{ fontSize: "5.5cqmin", fontWeight: 700, color: "#ffffff", textShadow: "0 0 8px rgba(255,255,255,0.6)" }}>{display}</span>
      <span style={{ fontSize: "3cqmin", color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function WhoopWidget(_: { config?: Record<string, string> }) {
  const names    = useRecognitionContext();
  const userName = names[0] ?? "";
  const { data, status } = useWhoopMetrics(userName);

  if (!userName) {
    return (
      <div className="flex h-full items-center justify-center">
        <span style={{ fontSize: "6cqmin", color: "rgba(255,255,255,0.6)" }}>Waiting for recognition…</span>
      </div>
    );
  }

  if (status === "NOT_CONNECTED" || status === "TOKEN_EXPIRED") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <span style={{ fontSize: "9cqmin" }}>⌚</span>
        <span style={{ fontSize: "5.5cqmin", fontWeight: 700, color: "#ffffff" }}>
          Whoop not connected
        </span>
        <span style={{ fontSize: "4cqmin", color: "rgba(255,255,255,0.6)" }}>
          Open the configure app to link your account
        </span>
      </div>
    );
  }

  if (status === "loading" || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <span style={{ fontSize: "5.5cqmin", color: "rgba(255,255,255,0.6)" }}>Loading Whoop…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full items-center justify-center">
        <span style={{ fontSize: "5.5cqmin", color: "rgba(255,255,255,0.6)" }}>Could not load Whoop data</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-3 py-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span style={{ fontSize: "4.5cqmin", fontWeight: 800, color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.12em", textShadow: "0 0 10px rgba(255,255,255,0.5)" }}>
          Whoop
        </span>
      </div>

      {/* Recovery ring + primary stats */}
      <div className="flex items-center gap-4">
        <RecoveryRing score={data.recovery_score} />
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 flex-1">
          <Stat label="HRV"        value={data.hrv}               unit=" ms"  />
          <Stat label="Resting HR" value={data.resting_hr}        unit=" bpm" />
          <Stat label="Sleep"      value={data.sleep_performance}  unit="%"   />
          <Stat label="Strain"     value={data.strain}                        />
        </div>
      </div>

    </div>
  );
}

registerWidget({
  id:            "whoop",
  name:          "Whoop",
  description:   "Personal health stats from your Whoop band (recovery, HRV, sleep, strain)",
  defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 },
  component:     WhoopWidget,
  configFields: [
    {
      key:         "client_id",
      label:       "Whoop Client ID",
      type:        "text",
      placeholder: "From developer.whoop.com",
    },
    {
      key:         "client_secret",
      label:       "Whoop Client Secret",
      type:        "text",
      password:    true,
      placeholder: "From developer.whoop.com",
    },
    {
      key:                  "whoop_connect",
      label:                "Connect Whoop Account",
      type:                 "connect",
      credentialsEndpoint:  "/api/whoop/credentials",
      authorizeEndpoint:    "/api/whoop/authorize",
    },
  ],
});

export default WhoopWidget;

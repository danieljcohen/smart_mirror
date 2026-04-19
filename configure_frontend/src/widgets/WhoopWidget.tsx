import { registerWidget } from "./registry";

const MOCK = {
  recovery_score:    78,
  hrv:               62,
  resting_hr:        52,
  sleep_performance: 85,
  strain:            8.4,
  spo2:              97,
  calories:          2340,
};

function recoveryColor(score: number): string {
  if (score >= 67) return "#22c55e";
  if (score >= 34) return "#eab308";
  return "#ef4444";
}

function RecoveryRing({ score }: { score: number }) {
  const r     = 38;
  const circ  = 2 * Math.PI * r;
  const dash  = circ * (score / 100);
  const color = recoveryColor(score);
  return (
    <div className="relative flex items-center justify-center" style={{ width: "5.5rem", height: "5.5rem", flexShrink: 0 }}>
      <svg width="88" height="88" viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="7"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span style={{ fontSize: "5.5cqmin", fontWeight: 700, color }}>{score}%</span>
        <span style={{ fontSize: "3cqmin", color: "rgba(255,255,255,0.5)", marginTop: 1 }}>REC</span>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span style={{ fontSize: "5.5cqmin", fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>{value}{unit}</span>
      <span style={{ fontSize: "3cqmin", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
    </div>
  );
}

function WhoopWidgetPreview(_: { config?: Record<string, string> }) {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-3 py-2">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: "4.5cqmin", fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Whoop
        </span>
        <span style={{ fontSize: "4cqmin", color: "rgba(255,255,255,0.35)" }}>Preview</span>
      </div>
      <div className="flex items-center gap-4">
        <RecoveryRing score={MOCK.recovery_score} />
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 flex-1">
          <Stat label="HRV"        value={MOCK.hrv}               unit=" ms" />
          <Stat label="Resting HR" value={MOCK.resting_hr}        unit=" bpm" />
          <Stat label="Sleep"      value={MOCK.sleep_performance}  unit="%" />
          <Stat label="Strain"     value={MOCK.strain} />
        </div>
      </div>
      <div className="flex justify-around border-t border-white/5 pt-1.5">
        <Stat label="SpO₂" value={MOCK.spo2}     unit="%" />
        <Stat label="Cals"  value={MOCK.calories} unit=" kcal" />
      </div>
    </div>
  );
}

registerWidget({
  id:            "whoop",
  name:          "Whoop",
  description:   "Personal health stats from your Whoop band (recovery, HRV, sleep, strain)",
  defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 },
  component:     WhoopWidgetPreview,
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
      key:                 "whoop_connect",
      label:               "Connect Whoop Account",
      type:                "connect",
      credentialsEndpoint: "/api/whoop/credentials",
      authorizeEndpoint:   "/api/whoop/authorize",
    },
  ],
});

export default WhoopWidgetPreview;

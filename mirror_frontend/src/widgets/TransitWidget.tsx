import { useEffect, useRef, useState } from "react";
import { registerWidget } from "./registry";

const REFRESH_MS = 5 * 60 * 1_000; // 5 minutes

interface TransitLine {
  shortName: string;
  color: string;
  textColor: string;
  departureTimes?: string[];
}

interface CommuteResult {
  durationText: string;
  distanceText: string;
  lines: TransitLine[];
}

// NYC subway line colors from MTA palette
const NYC_LINE_COLORS: Record<string, { bg: string; text: string }> = {
  "1": { bg: "#EE352E", text: "#fff" },
  "2": { bg: "#EE352E", text: "#fff" },
  "3": { bg: "#EE352E", text: "#fff" },
  "4": { bg: "#00933C", text: "#fff" },
  "5": { bg: "#00933C", text: "#fff" },
  "6": { bg: "#00933C", text: "#fff" },
  "7": { bg: "#B933AD", text: "#fff" },
  A: { bg: "#2850AD", text: "#fff" },
  C: { bg: "#2850AD", text: "#fff" },
  E: { bg: "#2850AD", text: "#fff" },
  B: { bg: "#FF6319", text: "#fff" },
  D: { bg: "#FF6319", text: "#fff" },
  F: { bg: "#FF6319", text: "#fff" },
  M: { bg: "#FF6319", text: "#fff" },
  G: { bg: "#6CBE45", text: "#fff" },
  J: { bg: "#996633", text: "#fff" },
  Z: { bg: "#996633", text: "#fff" },
  L: { bg: "#A7A9AC", text: "#fff" },
  N: { bg: "#FCCC0A", text: "#000" },
  Q: { bg: "#FCCC0A", text: "#000" },
  R: { bg: "#FCCC0A", text: "#000" },
  W: { bg: "#FCCC0A", text: "#000" },
  S: { bg: "#808183", text: "#fff" },
};

function travelModeIcon(mode: string): string {
  if (mode === "walking") return "🚶";
  if (mode === "driving") return "🚗";
  return "🚇";
}

async function fetchCommute(
  origin: string,
  destination: string,
  mode: string
): Promise<CommuteResult | null> {
  const params = new URLSearchParams({ origin, destination, mode });
  const res = await fetch(`/api/directions?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "OK") return null;

  // Backend returns simplified { duration, distance, transitLines }
  const lines: TransitLine[] = (data.transitLines ?? []).map((l: {
    shortName: string; color: string; textColor: string; departureTimes?: string[];
  }) => {
    const palette = NYC_LINE_COLORS[l.shortName?.toUpperCase()];
    return {
      shortName: l.shortName,
      color: palette?.bg ?? l.color ?? "#555",
      textColor: palette?.text ?? l.textColor ?? "#fff",
      departureTimes: l.departureTimes ?? [],
    };
  });

  return {
    durationText: data.duration ?? "",
    distanceText: data.distance ?? "",
    lines,
  };
}

function Transit({ config }: { config?: Record<string, string> }) {
  const workAddress = config?.work_address ?? "";
  const travelMode = config?.travel_mode ?? "transit";

  const [mirrorLocation, setMirrorLocation] = useState("");
  const [result, setResult] = useState<CommuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch mirror location once on mount
  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then(d => setMirrorLocation(d.mirror_location ?? ""))
      .catch(() => setError("Could not load mirror location"));
  }, []);

  // Fetch commute when we have both addresses; refresh every 5 min
  useEffect(() => {
    if (!mirrorLocation || !workAddress) return;

    const load = () => {
      fetchCommute(mirrorLocation, workAddress, travelMode)
        .then(r => {
          if (r) { setResult(r); setError(null); }
          else setError("No route found");
        })
        .catch(() => setError("Directions unavailable"));
    };

    load();
    intervalRef.current = setInterval(load, REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [mirrorLocation, workAddress, travelMode]);

  const icon = travelModeIcon(travelMode);

  if (!workAddress) {
    return (
      <div className="flex h-full items-center justify-center text-white/30 text-center px-2" style={{ fontSize: "9cqmin" }}>
        Set work address in configure app
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-white/30 text-center px-2" style={{ fontSize: "9cqmin" }}>
        {error}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-white/30" style={{ fontSize: "9cqmin" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-center px-3 py-2 gap-2">
      {/* Duration + icon */}
      <div className="flex items-center gap-2">
        <span style={{ fontSize: "14cqmin" }}>{icon}</span>
        <div>
          <div className="font-light text-white/90" style={{ fontSize: "13cqmin" }}>
            {result.durationText}
          </div>
          <div className="text-white/40" style={{ fontSize: "8cqmin" }}>
            {result.distanceText} to work
          </div>
        </div>
      </div>

      {/* Subway line badges + departure times */}
      {result.lines.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {result.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              {/* Line badge */}
              <span
                className="inline-flex shrink-0 items-center justify-center rounded font-bold leading-none"
                style={{
                  fontSize: "9cqmin",
                  width: "14cqmin",
                  height: "14cqmin",
                  background: l.color,
                  color: l.textColor,
                }}
              >
                {l.shortName}
              </span>
              {/* Departure times */}
              {l.departureTimes && l.departureTimes.length > 0 && (
                <span className="text-white/60 tracking-tight" style={{ fontSize: "8cqmin" }}>
                  {l.departureTimes.join(" · ")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

registerWidget({
  id: "transit",
  name: "Transit",
  description: "Commute time and transit directions to work",
  defaultLayout: { w: 4, h: 2, minW: 3, minH: 2 },
  component: Transit,
  configFields: [
    {
      key: "work_address",
      label: "Work Address",
      type: "text",
      placeholder: "e.g. 1 Infinite Loop, Cupertino, CA",
    },
    {
      key: "travel_mode",
      label: "Travel Mode",
      type: "select",
      options: [
        { value: "transit", label: "Transit" },
        { value: "walking", label: "Walking" },
        { value: "driving", label: "Driving" },
      ],
    },
  ],
});

export default Transit;

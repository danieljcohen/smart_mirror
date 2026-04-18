import { useEffect, useState } from "react";
import { registerWidget } from "./registry";

interface Game {
  homeTeam:  string;
  awayTeam:  string;
  homeScore: string;
  awayScore: string;
  status:    string;
  state:     "pre" | "in" | "post" | string;
}

const GAMES_PER_PAGE = 3;
const PAGE_MS        = 7000;
const FADE_MS        = 500;
const REFRESH_MS     = 5 * 60 * 1000;

function useScores(league: string) {
  const [games, setGames]   = useState<Game[]>([]);
  const [label, setLabel]   = useState("");
  const [error, setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res  = await fetch(`/api/sports/scores?league=${encodeURIComponent(league)}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "OK") {
          setGames(data.games ?? []);
          setLabel(data.league ?? "");
          setError(false);
        } else {
          setError(true);
        }
      } catch { if (!cancelled) setError(true); }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [league]);

  return { games, label, error };
}

function ScoreRow({ game }: { game: Game }) {
  const live    = game.state === "in";
  const pre     = game.state === "pre";
  const hasScore = game.homeScore !== "" && game.awayScore !== "";

  return (
    <div className="flex items-center gap-2 py-0.5">
      {/* Away */}
      <span className="w-10 text-right font-bold text-white" style={{ fontSize: "7cqmin" }}>
        {game.awayTeam}
      </span>
      {/* Scores / vs */}
      {pre || !hasScore ? (
        <span className="flex-1 text-center font-semibold text-white/80" style={{ fontSize: "7cqmin" }}>vs</span>
      ) : (
        <span className="flex-1 text-center tabular-nums text-white" style={{ fontSize: "7cqmin" }}>
          {game.awayScore}
          <span className="mx-1 text-white/65">–</span>
          {game.homeScore}
        </span>
      )}
      {/* Home */}
      <span className="w-10 font-bold text-white" style={{ fontSize: "7cqmin" }}>
        {game.homeTeam}
      </span>
      {/* Status */}
      <span
        className={`w-16 truncate text-right font-semibold ${live ? "text-green-400" : "text-white/85"}`}
        style={{ fontSize: "6cqmin" }}
      >
        {live && <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-green-400" />}
        {game.status}
      </span>
    </div>
  );
}

function SportsWidget({ config }: { config?: Record<string, string> }) {
  const league = config?.league ?? "nfl";
  const { games, label, error } = useScores(league);

  const pages   = Math.max(1, Math.ceil(games.length / GAMES_PER_PAGE));
  const [page, setPage]       = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (games.length <= GAMES_PER_PAGE) return;
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPage(p => (p + 1) % pages);
        setVisible(true);
      }, FADE_MS);
    }, PAGE_MS);
    return () => clearInterval(t);
  }, [games.length, pages]);

  useEffect(() => { setPage(0); setVisible(true); }, [league]);

  const slice = games.slice(page * GAMES_PER_PAGE, page * GAMES_PER_PAGE + GAMES_PER_PAGE);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="font-semibold text-white/75" style={{ fontSize: "7cqmin" }}>Could not load scores</span>
      </div>
    );
  }

  if (!games.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1">
        <span className="font-bold uppercase tracking-widest text-white/80" style={{ fontSize: "6cqmin" }}>
          {label || league.toUpperCase()}
        </span>
        <span className="font-semibold text-white/70" style={{ fontSize: "6.5cqmin" }}>No games today</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col justify-center px-3 py-2">
      {/* League header */}
      <div className="mb-1 flex items-center justify-between">
        <span
          className="font-bold uppercase tracking-widest text-white/85"
          style={{ fontSize: "5.5cqmin" }}
        >
          {label}
        </span>
        {pages > 1 && (
          <div className="flex gap-1">
            {Array.from({ length: pages }).map((_, i) => (
              <span
                key={i}
                className="rounded-full transition-all"
                style={{
                  width:      i === page ? "6px" : "4px",
                  height:     "4px",
                  background: i === page ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Rows */}
      <div
        className="flex flex-col divide-y divide-white/5 transition-opacity"
        style={{ opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}
      >
        {slice.map((g, i) => <ScoreRow key={i} game={g} />)}
      </div>
    </div>
  );
}

registerWidget({
  id:            "sports",
  name:          "Sports Scores",
  description:   "Live & recent game scores for NFL, NBA, and more",
  defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 },
  component:     SportsWidget,
  configFields: [
    {
      key:     "league",
      label:   "League",
      type:    "select",
      options: [
        { value: "nfl", label: "NFL (Football)" },
        { value: "nba", label: "NBA (Basketball)" },
        { value: "nhl", label: "NHL (Hockey)" },
        { value: "mlb", label: "MLB (Baseball)" },
        { value: "epl", label: "Premier League (Soccer)" },
        { value: "mls", label: "MLS (Soccer)" },
      ],
    },
  ],
});

export default SportsWidget;

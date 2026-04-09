import { registerWidget } from "./registry";

const PREVIEW: Record<string, { label: string; games: { away: string; home: string; awayScore: string; homeScore: string; status: string; live: boolean }[] }> = {
  nfl: {
    label: "NFL",
    games: [
      { away: "KC",  home: "BUF", awayScore: "24", homeScore: "17", status: "Final",   live: false },
      { away: "SF",  home: "DAL", awayScore: "21", homeScore: "21", status: "Q4 2:14", live: true  },
      { away: "PHI", home: "NYG", awayScore: "",   homeScore: "",   status: "Sun 4:25", live: false },
    ],
  },
  nba: {
    label: "NBA",
    games: [
      { away: "BOS", home: "MIA", awayScore: "108", homeScore: "102", status: "Final",    live: false },
      { away: "LAL", home: "GSW", awayScore: "89",  homeScore: "91",  status: "Q3 4:33",  live: true  },
      { away: "NYK", home: "CHI", awayScore: "",    homeScore: "",    status: "Tonight 7:30", live: false },
    ],
  },
  nhl: {
    label: "NHL",
    games: [
      { away: "TOR", home: "MTL", awayScore: "3", homeScore: "2", status: "Final",  live: false },
      { away: "BOS", home: "NYR", awayScore: "1", homeScore: "2", status: "P3 8:12", live: true  },
    ],
  },
  mlb: {
    label: "MLB",
    games: [
      { away: "NYY", home: "BOS", awayScore: "5", homeScore: "3", status: "Final",  live: false },
      { away: "LAD", home: "SFG", awayScore: "2", homeScore: "4", status: "Bot 7",  live: true  },
    ],
  },
  epl: {
    label: "Premier League",
    games: [
      { away: "ARS", home: "MCI", awayScore: "2", homeScore: "1", status: "FT",    live: false },
      { away: "LIV", home: "CHE", awayScore: "1", homeScore: "1", status: "85'",   live: true  },
    ],
  },
  mls: {
    label: "MLS",
    games: [
      { away: "NYCFC", home: "ATL", awayScore: "1", homeScore: "2", status: "Final", live: false },
      { away: "SEA",   home: "POR", awayScore: "0", homeScore: "0", status: "73'",   live: true  },
    ],
  },
};

function SportsPreview({ config }: { config?: Record<string, string> }) {
  const league  = config?.league ?? "nfl";
  const preview = PREVIEW[league] ?? PREVIEW.nfl;

  return (
    <div className="flex h-full w-full flex-col justify-center px-3 py-2">
      <div className="mb-1">
        <span
          className="font-bold uppercase tracking-widest text-white/50"
          style={{ fontSize: "4.5cqmin" }}
        >
          {preview.label}
        </span>
      </div>
      <div className="flex flex-col divide-y divide-white/5">
        {preview.games.map((g, i) => {
          const pre = !g.awayScore && !g.homeScore;
          return (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span className="w-10 text-right font-bold text-white" style={{ fontSize: "7cqmin" }}>{g.away}</span>
              {pre ? (
                <span className="flex-1 text-center text-white/40" style={{ fontSize: "6cqmin" }}>vs</span>
              ) : (
                <span className="flex-1 text-center tabular-nums text-white" style={{ fontSize: "7cqmin" }}>
                  {g.awayScore}
                  <span className="mx-1 text-white/30">–</span>
                  {g.homeScore}
                </span>
              )}
              <span className="w-10 font-bold text-white" style={{ fontSize: "7cqmin" }}>{g.home}</span>
              <span
                className={`w-16 truncate text-right ${g.live ? "text-green-400" : "text-white/40"}`}
                style={{ fontSize: "5cqmin" }}
              >
                {g.live && <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-green-400" />}
                {g.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

registerWidget({
  id:            "sports",
  name:          "Sports Scores",
  description:   "Live & recent game scores for NFL, NBA, and more",
  defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 },
  component:     SportsPreview,
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

export default SportsPreview;

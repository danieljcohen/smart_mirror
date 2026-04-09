import { registerWidget } from "./registry";

const PREVIEW_HEADLINES = [
  "Markets rally as central banks signal rate pause amid easing inflation data",
  "Scientists discover new approach to treating antibiotic-resistant infections",
  "World leaders gather for emergency climate summit in Geneva",
  "Tech giants report record earnings despite global economic uncertainty",
];

function NewsPreview({ config }: { config?: Record<string, string> }) {
  const source = config?.source ?? "bbc";
  const sourceLabel =
    source === "bbc"     ? "BBC World News"     :
    source === "bbc_biz" ? "BBC Business"       :
    source === "reuters" ? "Reuters"            :
    source === "ap"      ? "AP News"            :
    source === "ft"      ? "Financial Times"    :
    source === "wsj"     ? "Wall Street Journal": "BBC World News";

  return (
    <div className="flex h-full w-full flex-col justify-center overflow-hidden px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="rounded-sm bg-white/15 px-1.5 py-0.5 font-semibold uppercase tracking-widest text-white/60"
          style={{ fontSize: "4cqmin" }}
        >
          {sourceLabel}
        </span>
        <div className="ml-auto flex gap-1">
          {PREVIEW_HEADLINES.map((_, i) => (
            <span
              key={i}
              className="rounded-full"
              style={{
                width:      i === 0 ? "6px" : "4px",
                height:     "4px",
                background: i === 0 ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.2)",
              }}
            />
          ))}
        </div>
      </div>
      <p
        className="leading-snug text-white"
        style={{
          fontSize:        "7cqmin",
          display:         "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow:        "hidden",
        }}
      >
        {PREVIEW_HEADLINES[0]}
      </p>
    </div>
  );
}

registerWidget({
  id:            "news",
  name:          "News Headlines",
  description:   "Top news headlines scrolling on your mirror",
  defaultLayout: { w: 4, h: 2, minW: 3, minH: 1 },
  component:     NewsPreview,
  configFields: [
    {
      key:     "source",
      label:   "News Source",
      type:    "select",
      options: [
        { value: "bbc",     label: "BBC World News" },
        { value: "bbc_biz", label: "BBC Business" },
        { value: "reuters", label: "Reuters" },
        { value: "ap",      label: "AP News" },
        { value: "ft",      label: "Financial Times" },
        { value: "wsj",     label: "Wall Street Journal" },
      ],
    },
  ],
});

export default NewsPreview;

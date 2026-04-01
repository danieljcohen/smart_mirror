import { registerWidget } from "./registry";

function ReelsPreview(_: { config?: Record<string, string> }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-black">
      {/* Play icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="text-white/70"
        style={{ width: "20cqmin", height: "20cqmin" }}
      >
        <path
          fillRule="evenodd"
          d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z"
          clipRule="evenodd"
        />
      </svg>
      <span className="font-medium text-white/50" style={{ fontSize: "9cqmin" }}>
        YouTube Shorts
      </span>
    </div>
  );
}

registerWidget({
  id: "reels",
  name: "Reels",
  description: "YouTube Shorts cycling on your mirror",
  defaultLayout: { w: 2, h: 4, minW: 2, minH: 3 },
  component: ReelsPreview,
  configFields: [
    {
      key: "source_type",
      label: "Source",
      type: "select",
      options: [
        { value: "trending", label: "Trending Shorts" },
        { value: "channel", label: "Channel" },
        { value: "search", label: "Search" },
      ],
    },
    {
      key: "channel_id",
      label: "Channel ID or URL",
      type: "text",
      placeholder: "e.g. UCxxxxxx or youtube.com/@handle",
    },
    {
      key: "search_query",
      label: "Search Query",
      type: "text",
      placeholder: "e.g. cooking, travel",
    },
  ],
});

export default ReelsPreview;

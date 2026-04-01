import { useEffect, useRef, useState } from "react";
import { registerWidget } from "./registry";

const REFRESH_MS = 30 * 60 * 1_000; // refresh video list every 30 minutes
let ytApiLoading = false;
let ytApiReady = false;
const ytApiCallbacks: (() => void)[] = [];

function loadYouTubeApi(): Promise<void> {
  return new Promise((resolve) => {
    if (ytApiReady) { resolve(); return; }
    ytApiCallbacks.push(resolve);
    if (ytApiLoading) return;
    ytApiLoading = true;

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true;
      if (prev) prev();
      ytApiCallbacks.forEach(cb => cb());
      ytApiCallbacks.length = 0;
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
}

function ReelsWidget({ config }: { config?: Record<string, string> }) {
  const sourceType = config?.source_type ?? "trending";
  const channelId = config?.channel_id ?? "";
  const searchQuery = config?.search_query ?? "";

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const videoIdsRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const playerDivId = useRef(`yt-player-${Math.random().toString(36).slice(2)}`);

  const [status, setStatus] = useState<"loading" | "playing" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  async function fetchVideoIds(): Promise<string[]> {
    const params = new URLSearchParams({ source_type: sourceType });
    if (sourceType === "channel" && channelId) params.set("channel_id", channelId);
    if (sourceType === "search" && searchQuery) params.set("search_query", searchQuery);

    const res = await fetch(`/api/youtube/shorts?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK") throw new Error(data.error ?? "API error");
    return data.videoIds as string[];
  }

  function advanceVideo() {
    const ids = videoIdsRef.current;
    if (!ids.length || !playerRef.current) return;
    indexRef.current = (indexRef.current + 1) % ids.length;
    playerRef.current.loadVideoById(ids[indexRef.current]);
  }

  function createPlayer(videoId: string) {
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    // Re-create the target div (destroyed on player.destroy())
    const container = containerRef.current;
    if (!container) return;
    let div = document.getElementById(playerDivId.current);
    if (!div) {
      div = document.createElement("div");
      div.id = playerDivId.current;
      container.appendChild(div);
    }

    playerRef.current = new window.YT.Player(playerDivId.current, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: {
        autoplay: 1,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        fs: 0,
      },
      events: {
        onStateChange: (event: YT.OnStateChangeEvent) => {
          if (event.data === window.YT.PlayerState.ENDED) {
            advanceVideo();
          }
        },
        onError: () => {
          // Skip errored video
          advanceVideo();
        },
        onReady: () => {
          setStatus("playing");
        },
      },
    });
  }

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;

    async function init() {
      try {
        const ids = await fetchVideoIds();
        if (cancelled) return;
        if (!ids.length) { setErrorMsg("No videos found"); setStatus("error"); return; }

        videoIdsRef.current = ids;
        indexRef.current = 0;

        await loadYouTubeApi();
        if (cancelled) return;

        createPlayer(ids[0]);

        // Refresh the video list periodically without interrupting playback
        intervalId = setInterval(async () => {
          try {
            const fresh = await fetchVideoIds();
            if (fresh.length) videoIdsRef.current = fresh;
          } catch { /* keep existing list */ }
        }, REFRESH_MS);
      } catch (e) {
        if (!cancelled) { setErrorMsg(String(e)); setStatus("error"); }
      }
    }

    init();

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceType, channelId, searchQuery]);

  if (status === "error") {
    return (
      <div
        className="flex h-full items-center justify-center text-center text-white/30 px-2"
        style={{ fontSize: "9cqmin" }}
      >
        {errorMsg || "Could not load videos"}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {status === "loading" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-white/30"
          style={{ fontSize: "9cqmin" }}
        >
          Loading…
        </div>
      )}
      {/* Player mounts here; the YT IFrame API will populate this div */}
      <div
        ref={containerRef}
        className="h-full w-full [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full"
      >
        <div id={playerDivId.current} />
      </div>
    </div>
  );
}

registerWidget({
  id: "reels",
  name: "Reels",
  description: "YouTube Shorts cycling on your mirror",
  defaultLayout: { w: 2, h: 4, minW: 2, minH: 3 },
  component: ReelsWidget,
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

export default ReelsWidget;

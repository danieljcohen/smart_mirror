import { useEffect, useRef, useState } from "react";
import { registerWidget } from "./registry";

const REFRESH_MS = 30 * 60 * 1_000;
const FALLBACK_MS = 65_000;
const GESTURE_POLL_MS = 500;
const GESTURE_HEARTBEAT_MS = 3_000;

for (const origin of [
  "https://www.youtube.com",
  "https://i.ytimg.com",
  "https://www.google.com",
]) {
  if (!document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    document.head.appendChild(link);
  }
}

function ReelsWidget({ config }: { config?: Record<string, string> }) {
  const sourceType = config?.source_type ?? "trending";
  const channelId = config?.channel_id ?? "";
  const searchQuery = config?.search_query ?? "";

  const [videoIds, setVideoIds] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState("");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoIdsRef = useRef<string[]>([]);

  useEffect(() => { videoIdsRef.current = videoIds; }, [videoIds]);

  const advance = () =>
    setIdx(i => (i + 1) % Math.max(videoIdsRef.current.length, 1));

  // Listen for YouTube postMessage events
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== "https://www.youtube.com") return;
      try {
        const d = JSON.parse(typeof e.data === "string" ? e.data : "{}");
        if (d.event === "onStateChange") {
          if (d.info === 1) {
            // Video started playing — unmute now
            iframeRef.current?.contentWindow?.postMessage(
              JSON.stringify({ event: "command", func: "unMute", args: [] }), "*",
            );
            iframeRef.current?.contentWindow?.postMessage(
              JSON.stringify({ event: "command", func: "setVolume", args: [100] }), "*",
            );
          }
          if (d.info === 0) {
            // Video ended — go to next
            advance();
          }
        }
      } catch { /* ignore malformed messages */ }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fallback timer — advance even if the end event never fires
  useEffect(() => {
    if (!videoIds.length) return;
    const t = setTimeout(advance, FALLBACK_MS);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, videoIds.length]);

  // Poll latest gesture from backend (more robust than SSE across proxies)
  useEffect(() => {
    let cancelled = false;

    const pollGesture = async () => {
      try {
        const res = await fetch("/api/gesture/consume");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.type === "flick_up") {
          advance();
        }
      } catch {
        // ignore transient network errors
      }
    };

    const id = setInterval(pollGesture, GESTURE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heartbeat while reels widget is mounted so backend tracks gestures only when active
  useEffect(() => {
    let cancelled = false;

    const sendHeartbeat = async () => {
      try {
        await fetch("/api/gesture/heartbeat", { method: "POST" });
      } catch {
        if (!cancelled) {
          // ignore transient network errors
        }
      }
    };

    sendHeartbeat();
    const id = setInterval(sendHeartbeat, GESTURE_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);


  const onIframeLoad = () => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: "yt-reels" }), "*",
    );
  };

  // Fetch video IDs from backend proxy
  useEffect(() => {
    let cancelled = false;
    const fetchIds = async () => {
      try {
        const p = new URLSearchParams({ source_type: sourceType });
        if (sourceType === "channel" && channelId) p.set("channel_id", channelId);
        if (sourceType === "search" && searchQuery) p.set("search_query", searchQuery);
        const res = await fetch(`/api/youtube/shorts?${p}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "OK" && data.videoIds?.length) {
          setVideoIds(data.videoIds);
          setIdx(0);
          setError("");
        } else {
          setError(data.error ?? "No videos found");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    fetchIds();
    const rid = setInterval(fetchIds, REFRESH_MS);
    return () => { cancelled = true; clearInterval(rid); };
  }, [sourceType, channelId, searchQuery]);

  if (error) {
    return (
      <div
        className="flex h-full items-center justify-center text-center text-white/30 px-2"
        style={{ fontSize: "9cqmin" }}
      >
        {error}
      </div>
    );
  }

  if (!videoIds.length) {
    return (
      <div
        className="flex h-full items-center justify-center text-white/30"
        style={{ fontSize: "9cqmin" }}
      >
        Loading…
      </div>
    );
  }

  const videoId = videoIds[idx];
  const src =
    `https://www.youtube.com/embed/${videoId}` +
    `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1` +
    `&playsinline=1&enablejsapi=1&fs=0`;

  return (
    <div className="h-full w-full overflow-hidden bg-black">
      {/* key={videoId} forces React to remount the iframe for each new video */}
      <iframe
        key={videoId}
        ref={iframeRef}
        src={src}
        className="h-full w-full border-0"
        allow="autoplay; encrypted-media; gyroscope; picture-in-picture"
        onLoad={onIframeLoad}
      />
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

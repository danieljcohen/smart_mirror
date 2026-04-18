import { useEffect, useState } from "react";
import { registerWidget } from "./registry";

function Clock(_: { config?: Record<string, string> }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex h-full items-center text-white/95">
      <div>
        <div className="font-extralight tracking-tight" style={{ fontSize: "30cqmin" }}>{time}</div>
        <div className="font-semibold text-white/85" style={{ fontSize: "13cqmin" }}>{date}</div>
      </div>
    </div>
  );
}

registerWidget({
  id: "clock",
  name: "Clock",
  description: "Current time and date",
  defaultLayout: { w: 4, h: 2, minW: 2, minH: 1 },
  component: Clock,
});

export default Clock;

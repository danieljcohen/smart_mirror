import { useEffect, useState } from "react";
import { registerWidget } from "./registry";

function Clock() {
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
    <div className="flex h-full items-center text-white/90">
      <div>
        <div className="font-extralight tracking-tight" style={{ fontSize: "30cqmin" }}>{time}</div>
        <div className="font-light text-white/50" style={{ fontSize: "11cqmin" }}>{date}</div>
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

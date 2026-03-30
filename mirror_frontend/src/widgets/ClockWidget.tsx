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
        <div className="text-5xl font-extralight tracking-tight">{time}</div>
        <div className="mt-1 text-lg font-light text-white/50">{date}</div>
      </div>
    </div>
  );
}

registerWidget({
  id: "clock",
  name: "Clock",
  description: "Current time and date",
  defaultLayout: { w: 4, h: 2, minW: 2, minH: 2 },
  component: Clock,
});

export default Clock;

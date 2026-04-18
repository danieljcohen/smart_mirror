import { registerWidget } from "./registry";
import { useHourlyWeather } from "../hooks/useHourlyWeather";

function HourlyWeather(_: { config?: Record<string, string> }) {
  const slots = useHourlyWeather(12);

  if (!slots) {
    return (
      <div
        className="flex h-full items-center justify-center font-semibold text-white/75"
        style={{ fontSize: "10cqmin" }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-stretch overflow-x-auto">
      {slots.map((slot, i) => (
        <div
          key={i}
          className={`flex shrink-0 grow flex-col items-center justify-center py-1 transition-colors ${
            slot.isCurrent ? "rounded-lg bg-white/10" : ""
          }`}
        >
          <span
            className={slot.isCurrent ? "font-semibold text-white/95" : "font-semibold text-white/80"}
            style={{ fontSize: "7cqmin" }}
          >
            {slot.label}
          </span>
          <span style={{ fontSize: "10cqmin", lineHeight: 1.1 }}>{slot.icon}</span>
          <span
            className={slot.isCurrent ? "font-semibold text-white" : "font-medium text-white/90"}
            style={{ fontSize: "9cqmin" }}
          >
            {slot.temp}°
          </span>
        </div>
      ))}
    </div>
  );
}

registerWidget({
  id: "hourly-weather",
  name: "Hourly Weather",
  description: "Hourly temperatures and conditions for the day",
  defaultLayout: { w: 8, h: 2, minW: 4, minH: 1 },
  component: HourlyWeather,
});

export default HourlyWeather;

import { registerWidget } from "./registry";

const PREVIEW_HOURS = [
  { label: "Now",   icon: "☀️", temp: 72, current: true  },
  { label: "1 PM",  icon: "☀️", temp: 74, current: false },
  { label: "2 PM",  icon: "⛅",  temp: 75, current: false },
  { label: "3 PM",  icon: "☁️", temp: 73, current: false },
  { label: "4 PM",  icon: "🌧️", temp: 70, current: false },
  { label: "5 PM",  icon: "🌧️", temp: 68, current: false },
  { label: "6 PM",  icon: "🌦️", temp: 66, current: false },
  { label: "7 PM",  icon: "☁️", temp: 64, current: false },
  { label: "8 PM",  icon: "☁️", temp: 62, current: false },
  { label: "9 PM",  icon: "🌫️", temp: 61, current: false },
  { label: "10 PM", icon: "🌫️", temp: 60, current: false },
  { label: "11 PM", icon: "☁️", temp: 59, current: false },
];

function HourlyWeatherPreview(_: { config?: Record<string, string> }) {
  return (
    <div className="flex h-full w-full items-stretch overflow-hidden">
      {PREVIEW_HOURS.map((slot, i) => (
        <div
          key={i}
          className={`flex shrink-0 grow flex-col items-center justify-center py-1 ${
            slot.current ? "rounded-lg bg-white/10" : ""
          }`}
        >
          <span
            className={slot.current ? "text-white/90" : "text-white/40"}
            style={{ fontSize: "6cqmin" }}
          >
            {slot.label}
          </span>
          <span style={{ fontSize: "10cqmin", lineHeight: 1.1 }}>{slot.icon}</span>
          <span
            className={`font-light ${slot.current ? "text-white" : "text-white/70"}`}
            style={{ fontSize: "8cqmin" }}
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
  component: HourlyWeatherPreview,
});

export default HourlyWeatherPreview;

import { registerWidget } from "./registry";
import { useWeather } from "../hooks/useWeather";

function Weather(_: { config?: Record<string, string> }) {
  const weather = useWeather();

  if (!weather) {
    return (
      <div className="flex h-full items-center justify-center font-semibold text-white/75" style={{ fontSize: "10cqmin" }}>
        Loading weather...
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center" style={{ gap: "4cqmin" }}>
      <span style={{ fontSize: "20cqmin" }}>{weather.icon}</span>
      <div className="text-left">
        <div className="font-light text-white/90" style={{ fontSize: "16cqmin" }}>{weather.temp}°F</div>
        <div className="font-semibold text-white/85" style={{ fontSize: "11cqmin" }}>{weather.description}</div>
      </div>
    </div>
  );
}

registerWidget({
  id: "weather",
  name: "Weather",
  description: "Local weather conditions",
  defaultLayout: { w: 4, h: 2, minW: 3, minH: 1 },
  component: Weather,
});

export default Weather;

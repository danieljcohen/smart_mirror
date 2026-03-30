import { registerWidget } from "./registry";
import { useWeather } from "../hooks/useWeather";

function Weather() {
  const weather = useWeather();

  if (!weather) {
    return (
      <div className="flex h-full items-center justify-center text-white/30 text-sm">
        Loading weather...
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-3">
      <span className="text-3xl">{weather.icon}</span>
      <div className="text-left">
        <div className="text-2xl font-light text-white/90">{weather.temp}°F</div>
        <div className="text-sm text-white/50">{weather.description}</div>
      </div>
    </div>
  );
}

registerWidget({
  id: "weather",
  name: "Weather",
  description: "Local weather conditions",
  defaultLayout: { w: 4, h: 2, minW: 3, minH: 2 },
  component: Weather,
});

export default Weather;

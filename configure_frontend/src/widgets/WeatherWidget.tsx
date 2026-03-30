import { registerWidget } from "./registry";

function WeatherPreview() {
  return (
    <div className="flex h-full items-center gap-3">
      <span className="text-3xl">☀️</span>
      <div className="text-left">
        <div className="text-2xl font-light text-white/90">72°F</div>
        <div className="text-sm text-white/50">Weather</div>
      </div>
    </div>
  );
}

registerWidget({
  id: "weather",
  name: "Weather",
  description: "Local weather conditions",
  defaultLayout: { w: 4, h: 2, minW: 3, minH: 2 },
  component: WeatherPreview,
});

export default WeatherPreview;

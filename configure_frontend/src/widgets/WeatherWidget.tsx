import { registerWidget } from "./registry";

function WeatherPreview() {
  return (
    <div className="flex h-full items-center justify-center" style={{ gap: "4cqmin" }}>
      <span style={{ fontSize: "20cqmin" }}>☀️</span>
      <div className="text-left">
        <div className="font-light text-white/90" style={{ fontSize: "16cqmin" }}>72°F</div>
        <div className="text-white/50" style={{ fontSize: "9cqmin" }}>Weather</div>
      </div>
    </div>
  );
}

registerWidget({
  id: "weather",
  name: "Weather",
  description: "Local weather conditions",
  defaultLayout: { w: 4, h: 2, minW: 3, minH: 1 },
  component: WeatherPreview,
});

export default WeatherPreview;

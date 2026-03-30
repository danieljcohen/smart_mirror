import "./ClockWidget";
import "./WeatherWidget";
import "./GreetingWidget";

export { default as registry, getAllWidgets, getWidget } from "./registry";
export type { WidgetDefinition } from "./registry";

import "./ClockWidget";
import "./WeatherWidget";
import "./GreetingWidget";
import "./GeminiChatWidget";
import "./TransitWidget";

export { default as registry, getAllWidgets, getWidget } from "./registry";
export type { WidgetDefinition } from "./registry";

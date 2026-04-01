import { getWidget } from "../widgets";

interface WidgetRendererProps {
  widgetId: string;
  config?: Record<string, string>;
}

export function WidgetRenderer({ widgetId, config }: WidgetRendererProps) {
  const def = getWidget(widgetId);
  if (!def) {
    return (
      <div className="flex h-full items-center justify-center text-white/20 text-xs">
        Unknown widget: {widgetId}
      </div>
    );
  }
  const Component = def.component;
  return <Component config={config} />;
}

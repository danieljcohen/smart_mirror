import { getWidget } from "../widgets";

export function WidgetRenderer({ widgetId }: { widgetId: string }) {
  const def = getWidget(widgetId);
  if (!def) {
    return (
      <div className="flex h-full items-center justify-center text-white/20 text-xs">
        Unknown widget: {widgetId}
      </div>
    );
  }
  const Component = def.component;
  return <Component />;
}

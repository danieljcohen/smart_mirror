import type { ComponentType } from "react";

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  defaultLayout: { w: number; h: number; minW?: number; minH?: number };
  component: ComponentType;
}

const registry = new Map<string, WidgetDefinition>();

export function registerWidget(def: WidgetDefinition) {
  registry.set(def.id, def);
}

export function getWidget(id: string): WidgetDefinition | undefined {
  return registry.get(id);
}

export function getAllWidgets(): WidgetDefinition[] {
  return Array.from(registry.values());
}

export default registry;

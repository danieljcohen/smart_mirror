import type { ComponentType } from "react";

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "select" | "connect";
  placeholder?: string;
  password?: boolean;
  options?: { value: string; label: string }[];
  /** For type="connect": POST endpoint to store credentials before OAuth */
  credentialsEndpoint?: string;
  /** For type="connect": GET endpoint that starts the OAuth redirect */
  authorizeEndpoint?: string;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  defaultLayout: { w: number; h: number; minW?: number; minH?: number };
  component: ComponentType<{ config?: Record<string, string> }>;
  /** Fields shown in the per-widget config panel inside the layout editor. */
  configFields?: ConfigField[];
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

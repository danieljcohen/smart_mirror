import { registerWidget } from "./registry";
import { useRecognitionContext } from "../hooks/useRecognition";

function formatNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function Greeting(_: { config?: Record<string, string> }) {
  const names = useRecognitionContext();

  if (!names.length) {
    return (
      <div className="flex h-full items-center justify-center font-medium text-white/75" style={{ fontSize: "14cqmin" }}>
        Waiting for someone...
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center animate-fade-in text-center">
      <div className="font-light text-white/90" style={{ fontSize: "24cqmin" }}>
        Hello, <span className="font-normal">{formatNames(names)}</span>
      </div>
    </div>
  );
}

registerWidget({
  id: "greeting",
  name: "Greeting",
  description: "Personalized greeting message",
  defaultLayout: { w: 6, h: 2, minW: 3, minH: 1 },
  component: Greeting,
});

export default Greeting;

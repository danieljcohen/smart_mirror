import { registerWidget } from "./registry";

function GreetingPreview(_: { config?: Record<string, string> }) {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <div className="font-light text-white/90" style={{ fontSize: "24cqmin" }}>
        Hello, <span className="font-normal">User</span>
      </div>
    </div>
  );
}

registerWidget({
  id: "greeting",
  name: "Greeting",
  description: "Personalized greeting message",
  defaultLayout: { w: 6, h: 2, minW: 3, minH: 1 },
  component: GreetingPreview,
});

export default GreetingPreview;

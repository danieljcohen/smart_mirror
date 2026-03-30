import { registerWidget } from "./registry";

function GreetingPreview() {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <div className="text-4xl font-light text-white/90">
        Hello, <span className="font-normal">User</span>
      </div>
    </div>
  );
}

registerWidget({
  id: "greeting",
  name: "Greeting",
  description: "Personalized greeting message",
  defaultLayout: { w: 6, h: 2, minW: 3, minH: 2 },
  component: GreetingPreview,
});

export default GreetingPreview;

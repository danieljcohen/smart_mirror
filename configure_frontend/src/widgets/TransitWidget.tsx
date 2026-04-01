import { registerWidget } from "./registry";

function TransitPreview(_: { config?: Record<string, string> }) {
  return (
    <div className="flex h-full flex-col justify-center px-3 py-2 gap-2">
      <div className="flex items-center gap-2">
        <span style={{ fontSize: "14cqmin" }}>🚇</span>
        <div>
          <div className="font-light text-white/90" style={{ fontSize: "13cqmin" }}>24 min</div>
          <div className="text-white/40" style={{ fontSize: "8cqmin" }}>to Work</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex items-center justify-center rounded font-bold text-white"
          style={{ fontSize: "9cqmin", width: "14cqmin", height: "14cqmin", background: "#00933C" }}
        >
          4
        </span>
        <span
          className="inline-flex items-center justify-center rounded font-bold text-white"
          style={{ fontSize: "9cqmin", width: "14cqmin", height: "14cqmin", background: "#00933C" }}
        >
          5
        </span>
        <span className="text-white/40" style={{ fontSize: "8cqmin" }}>downtown</span>
      </div>
    </div>
  );
}

registerWidget({
  id: "transit",
  name: "Transit",
  description: "Commute time and transit directions to work",
  defaultLayout: { w: 4, h: 2, minW: 3, minH: 2 },
  component: TransitPreview,
  configFields: [
    {
      key: "work_address",
      label: "Work Address",
      type: "address",
      placeholder: "e.g. 1 Infinite Loop, Cupertino, CA",
    },
    {
      key: "travel_mode",
      label: "Travel Mode",
      type: "select",
      options: [
        { value: "transit", label: "Transit" },
        { value: "walking", label: "Walking" },
        { value: "driving", label: "Driving" },
      ],
    },
  ],
});

export default TransitPreview;

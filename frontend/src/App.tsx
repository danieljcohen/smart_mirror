import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import GestureController from "./GestureController";

const POLL_MS = 3_000;
const GREETING_TIMEOUT_MS = 6_000;

interface Face {
  name: string;
  confidence: number;
}

interface Weather {
  temp: number;
  description: string;
  icon: string;
}

function formatNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function useRecognition() {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch("/api/recognize");
        const data = await res.json();
        const faces = data.faces as Face[] | undefined;

        if (faces?.length) {
          console.log(
            `[recognize] ${faces.length} face(s) detected:`,
            faces.map((f) => `${f.name} (${(f.confidence * 100).toFixed(1)}%)`).join(", "),
          );
        } else {
          console.log("[recognize] no faces detected");
        }

        const known = [
          ...new Set(
            faces
              ?.filter((f) => f.name !== "unknown" && f.confidence > 0.4)
              .map((f) => f.name),
          ),
        ];
        if (known.length) {
          console.log(`[recognize] greeting ${known.join(", ")}`);
          setNames(known);
          clearTimeout(timeout);
          timeout = setTimeout(() => setNames([]), GREETING_TIMEOUT_MS);
        }
      } catch (err) {
        console.warn("[recognize] backend unavailable:", err);
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(id);
      clearTimeout(timeout);
    };
  }, []);

  return names;
}

function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    async function fetchWeather() {
      try {
        const geo = await fetch("https://ipapi.co/json/");
        const { latitude, longitude } = await geo.json();

        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`,
        );
        const data = await res.json();
        const code: number = data.current.weather_code;
        const temp: number = Math.round(data.current.temperature_2m);

        setWeather({
          temp,
          description: weatherLabel(code),
          icon: weatherIcon(code),
        });
      } catch {
        /* no weather */
      }
    }

    fetchWeather();
    const id = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return weather;
}

function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 67) return "Rainy";
  if (code <= 77) return "Snowy";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Stormy";
}

function weatherIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌦️";
  if (code <= 86) return "🌨️";
  return "⛈️";
}

function Clock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="text-white/90">
      <div className="text-6xl font-extralight tracking-tight">{time}</div>
      <div className="mt-1 text-lg font-light text-white/50">{date}</div>
    </div>
  );
}

function WeatherWidget({ weather }: { weather: Weather }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 px-5 py-3 backdrop-blur-sm">
      <span className="text-3xl">{weather.icon}</span>
      <div className="text-left">
        <div className="text-2xl font-light text-white/90">
          {weather.temp}°F
        </div>
        <div className="text-sm text-white/50">{weather.description}</div>
      </div>
    </div>
  );
}

function Greeting({ names }: { names: string[] }) {
  return (
    <div className="animate-fade-in text-center">
      <div className="text-4xl font-light text-white/90">
        Hello, <span className="font-normal">{formatNames(names)}</span>
      </div>
    </div>
  );
}

export default function App() {
  const names = useRecognition();
  const weather = useWeather();

  // Persistent initial positions
  const initialPositions = JSON.parse(localStorage.getItem('widgetPositions') || '{}');

  const handleDragEnd = (name: string, info: any) => {
    const current = JSON.parse(localStorage.getItem('widgetPositions') || '{}');
    current[name] = { 
       x: (current[name]?.x || 0) + info.offset.x, 
       y: (current[name]?.y || 0) + info.offset.y 
    };
    localStorage.setItem('widgetPositions', JSON.stringify(current));
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black p-10 font-sans">
      <GestureController />

      <motion.div 
         className="absolute top-10 left-10"
         drag
         dragMomentum={false}
         initial={initialPositions['clock'] || {x: 0, y: 0}}
         onDragEnd={(_, info) => handleDragEnd('clock', info)}
         data-draggable
      >
        <Clock />
      </motion.div>

      {weather && (
        <motion.div 
           className="absolute top-10 right-10"
           drag
           dragMomentum={false}
           initial={initialPositions['weather'] || {x: 0, y: 0}}
           onDragEnd={(_, info) => handleDragEnd('weather', info)}
           data-draggable
        >
          <WeatherWidget weather={weather} />
        </motion.div>
      )}

      {names.length > 0 && (
        <motion.div 
           className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
           drag
           dragMomentum={false}
           initial={initialPositions['greeting'] || {x: 0, y: 0}}
           onDragEnd={(_, info) => handleDragEnd('greeting', info)}
           data-draggable
        >
          <Greeting names={names} />
        </motion.div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";

interface Weather {
  temp: number;
  description: string;
  icon: string;
}

function getCoords(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("no geolocation"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => reject(new Error("geolocation denied")),
      { timeout: 5000 },
    );
  });
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

export function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    async function fetchWeather() {
      try {
        let coords: { latitude: number; longitude: number };
        try {
          coords = await getCoords();
        } catch {
          const geo = await fetch("https://ipapi.co/json/");
          coords = await geo.json();
        }

        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`,
        );
        const data = await res.json();
        const code: number = data.current.weather_code;
        const temp: number = Math.round(data.current.temperature_2m);

        setWeather({ temp, description: weatherLabel(code), icon: weatherIcon(code) });
      } catch (err) {
        console.warn("[weather] failed to fetch:", err);
      }
    }

    fetchWeather();
    const id = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return weather;
}

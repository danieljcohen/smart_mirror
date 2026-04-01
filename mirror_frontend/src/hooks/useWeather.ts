import { useEffect, useState } from "react";

interface Weather {
  temp: number;
  description: string;
  icon: string;
}

interface Coords {
  latitude: number;
  longitude: number;
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

/** Geocode an address string → coordinates via the Pi backend proxy. */
async function geocodeAddress(address: string): Promise<Coords> {
  const params = new URLSearchParams({ address });
  const res = await fetch(`/api/geocode?${params}`);
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.[0]) {
    throw new Error(`Geocoding failed: ${data.status}`);
  }
  const loc = data.results[0].geometry.location;
  return { latitude: loc.lat, longitude: loc.lng };
}

/** Browser geolocation → coordinates. */
function getBrowserCoords(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("no geolocation")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => reject(new Error("geolocation denied")),
      { timeout: 5000 },
    );
  });
}

/** Resolve coordinates in priority order:
 *  1. Mirror location address from /api/settings (geocoded via Google)
 *  2. Browser geolocation
 *  3. IP-based geolocation (ipapi.co)
 */
async function resolveCoords(): Promise<Coords> {
  // 1. Mirror location
  try {
    const settingsRes = await fetch("/api/settings");
    const settings = await settingsRes.json();
    const mirrorLocation: string = settings?.mirror_location ?? "";
    if (mirrorLocation) {
      return await geocodeAddress(mirrorLocation);
    }
  } catch {
    // fall through
  }

  // 2. Browser geolocation
  try {
    return await getBrowserCoords();
  } catch {
    // fall through
  }

  // 3. IP-based fallback
  const geo = await fetch("https://ipapi.co/json/");
  return await geo.json();
}

export function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    async function fetchWeather() {
      try {
        const coords = await resolveCoords();
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
    const id = setInterval(fetchWeather, 10 * 60 * 1_000);
    return () => clearInterval(id);
  }, []);

  return weather;
}

import { useEffect, useState } from "react";
import { resolveCoords, weatherIcon, weatherLabel } from "./useWeather";

export interface HourlySlot {
  hour: number;       // 0-23
  label: string;      // "3 PM", "12 AM", etc.
  temp: number;
  icon: string;
  description: string;
  isCurrent: boolean;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function useHourlyWeather(hours = 12) {
  const [slots, setSlots] = useState<HourlySlot[] | null>(null);

  useEffect(() => {
    async function fetchHourly() {
      try {
        const coords = await resolveCoords();
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${coords.latitude}&longitude=${coords.longitude}` +
          `&hourly=temperature_2m,weather_code` +
          `&temperature_unit=fahrenheit` +
          `&forecast_days=2` +
          `&timezone=auto`,
        );
        const data = await res.json();
        const times: string[] = data.hourly.time;
        const temps: number[] = data.hourly.temperature_2m;
        const codes: number[] = data.hourly.weather_code;

        const nowHour = new Date().getHours();
        const nowDateStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

        // Find the index of the current hour in the response
        const currentIdx = times.findIndex(t => t.startsWith(nowDateStr) && parseInt(t.slice(11, 13)) === nowHour);
        const startIdx = currentIdx >= 0 ? currentIdx : 0;

        const result: HourlySlot[] = [];
        for (let i = 0; i < hours && startIdx + i < times.length; i++) {
          const idx = startIdx + i;
          const hour = parseInt(times[idx].slice(11, 13));
          const code = codes[idx];
          result.push({
            hour,
            label: formatHour(hour),
            temp: Math.round(temps[idx]),
            icon: weatherIcon(code),
            description: weatherLabel(code),
            isCurrent: i === 0,
          });
        }

        setSlots(result);
      } catch (err) {
        console.warn("[hourly weather] failed:", err);
      }
    }

    fetchHourly();
    const id = setInterval(fetchHourly, 30 * 60 * 1_000); // refresh every 30 min
    return () => clearInterval(id);
  }, [hours]);

  return slots;
}

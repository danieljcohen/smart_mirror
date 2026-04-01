import { useEffect, useRef, useState } from "react";

interface Suggestion {
  displayName: string;
  lat: number;
  lng: number;
}

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

async function searchAddresses(query: string): Promise<Suggestion[]> {
  if (query.length < 3) return [];
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "6",
    addressdetails: "1",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": "SmartMirror/1.0" },
  });
  const data = await res.json();
  return data.map((r: { display_name: string; lat: string; lon: string }) => ({
    displayName: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

export function AddressInput({ value, onChange, placeholder, className }: AddressInputProps) {
  const [inputText, setInputText] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Whether the current value was confirmed via a suggestion selection
  const [confirmed, setConfirmed] = useState(!!value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep input text in sync if parent resets the value
  useEffect(() => {
    setInputText(value);
    setConfirmed(!!value);
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (text: string) => {
    setInputText(text);
    setConfirmed(false);
    onChange(text); // propagate raw text immediately so parent can save

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchAddresses(text);
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  };

  const selectSuggestion = (s: Suggestion) => {
    setInputText(s.displayName);
    setConfirmed(true);
    setSuggestions([]);
    setOpen(false);
    onChange(s.displayName);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={inputText}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className={`w-full rounded-lg border bg-zinc-800 px-3 py-2 pr-8 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-blue-500 ${
            confirmed
              ? "border-green-600/60"
              : inputText && !confirmed
              ? "border-yellow-600/50"
              : "border-zinc-700"
          } ${className ?? ""}`}
        />
        {/* Status indicator */}
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs">
          {loading ? (
            <span className="text-zinc-500">⋯</span>
          ) : confirmed ? (
            <span className="text-green-500">✓</span>
          ) : inputText ? (
            <span className="text-yellow-500/70">?</span>
          ) : null}
        </span>
      </div>

      {/* Suggestion dropdown */}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); selectSuggestion(s); }}
                className="w-full px-3 py-2 text-left text-xs text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              >
                {s.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Unconfirmed hint */}
      {inputText && !confirmed && !open && !loading && (
        <p className="mt-1 text-xs text-yellow-500/70">
          Select an address from the suggestions to confirm it.
        </p>
      )}
    </div>
  );
}

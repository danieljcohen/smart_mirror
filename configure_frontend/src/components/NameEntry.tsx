import { useState } from "react";
import { supabase } from "../lib/supabase";

interface NameEntryProps {
  onLogin: (name: string) => void;
  onRegister: () => void;
}

export function NameEntry({ onLogin, onRegister }: NameEntryProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const { data } = await supabase
        .from("users")
        .select("id")
        .eq("name", trimmed)
        .limit(1);

      if (data && data.length > 0) {
        onLogin(trimmed);
      } else {
        setError(`"${trimmed}" is not registered. Register your face first.`);
      }
    } catch {
      setError("Could not reach the database. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-light text-white">Smart Mirror</h1>
          <p className="mt-2 text-zinc-400">Enter your name to customize your layout</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError(null); }}
            placeholder="Your name"
            autoFocus
            disabled={loading}
            className="w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-4 text-lg text-white placeholder-zinc-500 outline-none focus:border-blue-500 disabled:opacity-50"
          />

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full rounded-2xl bg-blue-600 px-5 py-4 text-lg text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            {loading ? "Checking…" : "Continue →"}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-800" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-zinc-950 px-3 text-xs text-zinc-600">or</span>
          </div>
        </div>

        <button
          onClick={onRegister}
          className="w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-4 text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-800"
        >
          Register a new face
        </button>
      </div>
    </div>
  );
}

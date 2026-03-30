import { createContext, useContext, useEffect, useState } from "react";

const POLL_MS = 3_000;
const GREETING_TIMEOUT_MS = 10_000;

interface Face {
  name: string;
  confidence: number;
}

export const RecognitionContext = createContext<string[]>([]);

export function useRecognitionContext(): string[] {
  return useContext(RecognitionContext);
}

export function useRecognition() {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch("/api/recognize");
        const data = await res.json();
        const faces = data.faces as Face[] | undefined;

        const known = [
          ...new Set(
            faces
              ?.filter((f) => f.name !== "unknown" && f.confidence > 0.4)
              .map((f) => f.name),
          ),
        ];
        if (known.length) {
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

import { createContext, useContext, useEffect, useRef, useState } from "react";

const POLL_MS = 4_000;
// Number of consecutive missed polls before clearing the recognized person.
// At 3s per poll, 10 misses = 30 seconds of nobody detected before giving up.
const MISS_THRESHOLD = 10;

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
  const missCount = useRef(0);
  const lastKnownRef = useRef<string>("");

  useEffect(() => {
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
          missCount.current = 0;
          const primary = known.join(",");
          if (primary !== lastKnownRef.current) {
            lastKnownRef.current = primary;
            setNames(known);
          }
        } else {
          missCount.current++;
          if (missCount.current >= MISS_THRESHOLD && lastKnownRef.current !== "") {
            lastKnownRef.current = "";
            setNames([]);
          }
        }
      } catch (err) {
        console.warn("[recognize] backend unavailable:", err);
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return names;
}

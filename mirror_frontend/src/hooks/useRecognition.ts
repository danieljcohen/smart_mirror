import { createContext, useContext, useEffect, useRef, useState } from "react";

const POLL_MS = 3_500;
// Consecutive polls where the *primary* user is absent before releasing them.
const MISS_THRESHOLD = 4;

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
  const primaryRef = useRef<string>("");
  const primaryMissCount = useRef(0);

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

        const currentPrimary = primaryRef.current;

        if (currentPrimary && known.includes(currentPrimary)) {
          // Primary user still in frame — keep them, reset their miss counter
          primaryMissCount.current = 0;
          const ordered = [currentPrimary, ...known.filter((n) => n !== currentPrimary)];
          setNames(ordered);
        } else if (currentPrimary && !known.includes(currentPrimary)) {
          // Primary user missing from this poll
          primaryMissCount.current++;
          if (primaryMissCount.current >= MISS_THRESHOLD) {
            // Timeout expired — release the primary user
            if (known.length) {
              // Another person is visible, promote them
              primaryRef.current = known[0];
              primaryMissCount.current = 0;
              setNames(known);
            } else {
              // Nobody visible — clear
              primaryRef.current = "";
              primaryMissCount.current = 0;
              setNames([]);
            }
          }
          // Otherwise keep showing the current primary (unchanged state)
        } else if (!currentPrimary && known.length) {
          // No primary yet, someone appeared — lock onto them
          primaryRef.current = known[0];
          primaryMissCount.current = 0;
          setNames(known);
        } else {
          // No primary, nobody visible — stay cleared
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

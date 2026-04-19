import { useEffect, useRef, useState } from "react";

interface RegisterFaceProps {
  defaultName: string;
  onBack: () => void;
  /** Called with the registered name after a successful registration. */
  onSuccess?: (name: string) => void;
}

export function RegisterFace({ defaultName, onBack, onSuccess }: RegisterFaceProps) {
  const [name, setName] = useState(defaultName);
  const [captures, setCaptures] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        setCameraError("Camera access denied — please allow camera access and refresh.");
      }
    }
    startCamera();
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const ANGLES = [
    "Look straight at the camera",
    "Turn your head slightly left",
    "Turn your head slightly right",
    "Tilt your head slightly up",
    "Tilt your head slightly down",
  ];

  const captureFrame = (): string => {
    const video = videoRef.current!;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const takePhoto = () => {
    if (captures.length >= ANGLES.length) return;
    setCaptures(prev => [...prev, captureFrame()]);
    setResult(null);
  };

  const retake = () => {
    setCaptures([]);
    setResult(null);
  };

  const currentStep = captures.length; // 0–4: which angle we're on
  const isDone = captures.length >= ANGLES.length;

  const handleSubmit = async () => {
    const registerUrl = import.meta.env.VITE_MODAL_REGISTER_URL?.trim().replace(/\/$/, "");
    if (!registerUrl) { setResult({ ok: false, message: "VITE_MODAL_REGISTER_URL not configured." }); return; }
    if (!name.trim()) { setResult({ ok: false, message: "Enter a name." }); return; }
    if (captures.length === 0) { setResult({ ok: false, message: "Capture photos first." }); return; }

    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch(registerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), images: captures }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail ?? body.error ?? `Register service responded with ${res.status}`);

      setResult({
        ok: true,
        message: `"${name.trim()}" registered — ${body.encodings_saved} encoding(s) saved to Supabase.`,
      });
      setCaptures([]);
      // Auto-login after a short delay so the user sees the success message
      if (onSuccess) setTimeout(() => onSuccess(name.trim()), 1500);
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Registration failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-light text-white">Register Face</h1>
            <p className="text-sm text-zinc-500">Enroll a person for mirror recognition</p>
          </div>
          <button
            onClick={onBack}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
          >
            ← Back
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
        {/* Name */}
        <div className="space-y-2">
          <label className="block text-sm text-zinc-400">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Person's name"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-600 outline-none focus:border-blue-500"
          />
        </div>

        {/* Camera + step-by-step capture */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm text-zinc-400">Camera</label>
            <span className="text-xs text-zinc-600">
              {isDone ? "All photos taken" : `Photo ${currentStep + 1} of ${ANGLES.length}`}
            </span>
          </div>

          {cameraError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              {cameraError}
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900" style={{ aspectRatio: "16/9" }}>
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover scale-x-[-1]" />

              {/* Current angle instruction overlay */}
              {!isDone && (
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-4">
                  <p className="text-center text-sm font-medium text-white">
                    {ANGLES[currentStep]}
                  </p>
                </div>
              )}

              {/* Step dots */}
              <div className="absolute top-3 inset-x-0 flex justify-center gap-1.5">
                {ANGLES.map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 w-2 rounded-full transition-colors ${
                      i < captures.length
                        ? "bg-green-400"
                        : i === currentStep
                        ? "bg-white"
                        : "bg-white/30"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Thumbnails row */}
          {captures.length > 0 && (
            <div className="flex gap-2">
              {captures.map((src, i) => (
                <div key={i} className="relative flex-1">
                  <img
                    src={src}
                    alt={ANGLES[i]}
                    className="h-14 w-full rounded-lg border border-green-500/40 object-cover"
                    style={{ transform: "scaleX(-1)" }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
                    <span className="text-lg text-green-400">✓</span>
                  </div>
                </div>
              ))}
              {/* Empty slots */}
              {Array.from({ length: ANGLES.length - captures.length }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="h-14 flex-1 rounded-lg border border-zinc-700 bg-zinc-900"
                />
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {!isDone ? (
              <button
                onClick={takePhoto}
                disabled={submitting || !!cameraError}
                className="flex-1 rounded-xl bg-zinc-700 py-3 text-sm font-medium text-white transition hover:bg-zinc-600 disabled:opacity-40"
              >
                {currentStep === 0 ? "Take Photo" : "Next →"}
              </button>
            ) : (
              <button
                onClick={retake}
                disabled={submitting}
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 py-3 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
              >
                Retake All
              </button>
            )}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={captures.length === 0 || submitting || !name.trim()}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? "Registering…" : "Register Face on Mirror"}
        </button>

        {/* Result */}
        {result && (
          <div
            className={`rounded-xl border p-4 text-sm ${
              result.ok
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}

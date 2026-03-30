import { useCallback, useRef, useState } from "react";

interface RegisterFaceProps {
  onRegister: (name: string, images: string[]) => Promise<void>;
  onBack: () => void;
}

export function RegisterFace({ onRegister, onBack }: RegisterFaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [name, setName] = useState("");
  const [step, setStep] = useState<"name" | "capture" | "submitting">("name");
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  const startCamera = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraReady(true);
    } catch {
      setError("Could not access camera. Check permissions and try again.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.85);
    setPhotos(prev => [...prev, base64]);
  }, []);

  const removePhoto = useCallback((idx: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const goToCapture = () => {
    if (!name.trim()) return;
    setStep("capture");
    startCamera();
  };

  const submit = async () => {
    if (photos.length === 0) {
      setError("Take at least one photo first.");
      return;
    }
    setStep("submitting");
    setError("");
    stopCamera();
    try {
      await onRegister(name.trim(), photos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setStep("capture");
      startCamera();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-light text-white">Smart Mirror</h1>
          <p className="mt-2 text-zinc-400">Register a new face</p>
        </div>

        {step === "name" && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <h2 className="text-lg font-medium text-white">What's your name?</h2>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && goToCapture()}
              placeholder="Enter your name"
              autoFocus
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 outline-none focus:border-blue-500"
            />
            <button
              onClick={goToCapture}
              disabled={!name.trim()}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              Next: Take Photos →
            </button>
          </div>
        )}

        {(step === "capture" || step === "submitting") && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-white">
                Hi, <span className="text-blue-400">{name}</span>
              </h2>
              <span className="text-sm text-zinc-500">{photos.length} photo{photos.length !== 1 ? "s" : ""} taken</span>
            </div>

            {/* Camera feed */}
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full rounded-xl"
              />
              {!cameraReady && step !== "submitting" && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
                  Starting camera...
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />

            {/* Captured thumbnails */}
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photos.map((src, i) => (
                  <div key={i} className="group relative">
                    <img src={src} className="h-14 w-14 rounded-lg object-cover border border-zinc-700" />
                    <button
                      onClick={() => removePhoto(i)}
                      className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white group-hover:flex"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Hint */}
            <p className="text-xs text-zinc-500">
              Take 3–5 photos from slightly different angles for best accuracy.
            </p>

            <div className="flex gap-2">
              <button
                onClick={capturePhoto}
                disabled={!cameraReady || step === "submitting"}
                className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-white transition hover:bg-white/20 disabled:opacity-40"
              >
                📷 Take Photo
              </button>
              <button
                onClick={submit}
                disabled={photos.length === 0 || step === "submitting"}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {step === "submitting" ? "Registering..." : "Register ✓"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          onClick={() => { stopCamera(); onBack(); }}
          className="w-full text-sm text-zinc-500 hover:text-zinc-300 transition"
        >
          ← Back to sign in
        </button>
      </div>
    </div>
  );
}

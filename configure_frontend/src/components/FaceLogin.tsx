import { useCallback, useRef, useState } from "react";

interface FaceLoginProps {
  onFaceCapture: (base64: string) => Promise<void>;
  onNameLogin: (name: string) => Promise<void>;
}

export function FaceLogin({ onFaceCapture, onNameLogin }: FaceLoginProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
      setError("");
    } catch {
      setError("Could not access camera. Try logging in with your name instead.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.8);

    setLoading(true);
    setError("");
    try {
      await onFaceCapture(base64);
      stopCamera();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Face login failed");
    } finally {
      setLoading(false);
    }
  }, [onFaceCapture, stopCamera]);

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      await onNameLogin(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-light text-white">Smart Mirror</h1>
          <p className="mt-2 text-zinc-400">Sign in to customize your layout</p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-lg font-medium text-white">Face Login</h2>
          {!cameraActive ? (
            <button
              onClick={startCamera}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-white transition hover:bg-white/20"
            >
              Open Camera
            </button>
          ) : (
            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-xl">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full rounded-xl bg-black"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={capture}
                  disabled={loading}
                  className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-white transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {loading ? "Scanning..." : "Scan Face"}
                </button>
                <button
                  onClick={stopCamera}
                  className="rounded-xl bg-zinc-700 px-4 py-3 text-white transition hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-zinc-800" />
          <span className="text-sm text-zinc-500">or</span>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        <form onSubmit={handleNameSubmit} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-lg font-medium text-white">Login with Name</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-xl bg-blue-600 px-6 py-3 text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              Go
            </button>
          </div>
        </form>

        {error && (
          <p className="rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

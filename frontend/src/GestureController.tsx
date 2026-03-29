import { useEffect, useRef, useState } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export default function GestureController() {
  const [isReady, setIsReady] = useState(false);
  const cursorRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let landmarker: HandLandmarker | null = null;
    let animationFrameId: number;
    let running = true;
    let isPinching = false;
    let lastX = 0;
    let lastY = 0;
    let targetEl: Element | null = null;

    async function init() {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
      );
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: "IMAGE",
        numHands: 1
      });
      setIsReady(true);
      tick();
    }

    function dispatchPointerEvent(type: string, x: number, y: number, target: Element | null) {
      if (!target) target = document.elementFromPoint(x, y);
      if (!target) return;

      const event = new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: 1,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        isPrimary: true,
        button: type === 'pointerdown' ? 0 : -1,
        buttons: isPinching ? 1 : 0
      });

      target.dispatchEvent(event);
    }

    function tick() {
      if (!running) return;

      if (landmarker && imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
        try {
          const result = landmarker.detect(imgRef.current);
          if (result.landmarks.length > 0) {
            const hand = result.landmarks[0];
            const indexTip = hand[8];
            const thumbTip = hand[4];

            let x = (1 - indexTip.x) * window.innerWidth;
            let y = indexTip.y * window.innerHeight;

            x = lastX + (x - lastX) * 0.4;
            y = lastY + (y - lastY) * 0.4;
            lastX = x;
            lastY = y;

            if (cursorRef.current) {
              cursorRef.current.style.transform = `translate(${x}px, ${y}px)`;
            }

            const dx = indexTip.x - thumbTip.x;
            const dy = indexTip.y - thumbTip.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const currentlyPinching = dist < 0.05;

            if (currentlyPinching && !isPinching) {
              isPinching = true;
              if (cursorRef.current) cursorRef.current.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';

              targetEl = document.elementFromPoint(x, y);

              let current: Element | null = targetEl;
              while (current && current !== document.body) {
                if (current.hasAttribute('data-draggable')) {
                  targetEl = current;
                  break;
                }
                current = current.parentElement;
              }

              dispatchPointerEvent('pointerdown', x, y, targetEl);
            }
            else if (currentlyPinching && isPinching) {
              dispatchPointerEvent('pointermove', x, y, window.document.body);
            }
            else if (!currentlyPinching && isPinching) {
              isPinching = false;
              if (cursorRef.current) cursorRef.current.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
              dispatchPointerEvent('pointerup', x, y, window.document.body);
              targetEl = null;
            }
          }
        } catch (err) {
        }
      }

      animationFrameId = requestAnimationFrame(tick);
    }

    init();

    return () => {
      running = false;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      landmarker?.close();
    };
  }, []);

  return (
    <>
      {/* Hidden MJPEG Stream */}
      <img
        ref={imgRef}
        src="http://localhost:3000/video_feed"
        style={{ display: "none" }}
        crossOrigin="anonymous"
        alt="stream"
      />

      {/* Virtual Cursor */}
      {isReady && (
        <div
          ref={cursorRef}
          style={{
            position: "fixed",
            top: -15,
            left: -15,
            width: 30,
            height: 30,
            borderRadius: "50%",
            backgroundColor: "rgba(255, 255, 255, 0.5)",
            border: "3px solid white",
            pointerEvents: "none",
            zIndex: 9999,
            transition: "background-color 0.15s ease",
            boxShadow: "0 0 10px rgba(0,0,0,0.5)"
          }}
        />
      )}
    </>
  );
}

#!/usr/bin/env python3
"""
Register a new person for facial recognition.

Usage:
    python register_face.py <person_name> [--count N] [--camera N]
"""

import argparse
import sys
from pathlib import Path

import cv2
import face_recognition

KNOWN_FACES_DIR = Path(__file__).resolve().parent / "known_faces"


def capture_from_camera(name: str, count: int = 5, camera: int = 0) -> None:
    person_dir = KNOWN_FACES_DIR / name
    person_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        print(f"Error: cannot open camera {camera}")
        sys.exit(1)

    saved = 0
    print(f"\nCapturing {count} photos for '{name}'.")
    print("Press SPACE to capture a photo, Q to quit.\n")

    while saved < count:
        ok, frame = cap.read()
        if not ok:
            break

        display = frame.copy()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        locations = face_recognition.face_locations(rgb, model="hog")

        for top, right, bottom, left in locations:
            cv2.rectangle(display, (left, top), (right, bottom), (0, 255, 0), 2)

        status = f"Captured: {saved}/{count} | SPACE=capture Q=quit"
        cv2.putText(display, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow("Register Face", display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord(" "):
            if not locations:
                print("  No face detected – try again.")
                continue
            img_path = person_dir / f"{name}_{saved + 1:03d}.jpg"
            cv2.imwrite(str(img_path), frame)
            saved += 1
            print(f"  Saved {img_path.name} ({saved}/{count})")

    cap.release()
    cv2.destroyAllWindows()
    print(f"\nDone. {saved} photo(s) saved to {person_dir}")
    print("Restart the server to load the new encodings.")


def main():
    parser = argparse.ArgumentParser(description="Register a face for recognition")
    parser.add_argument("name", help="Person's name (used as folder name and label)")
    parser.add_argument("--count", type=int, default=5, help="Number of photos to capture (default: 5)")
    parser.add_argument("--camera", type=int, default=0, help="Camera index (default: 0)")
    args = parser.parse_args()

    capture_from_camera(args.name, count=args.count, camera=args.camera)


if __name__ == "__main__":
    main()

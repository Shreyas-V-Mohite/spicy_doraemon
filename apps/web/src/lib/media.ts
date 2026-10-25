import { useEffect, useRef, useState } from "react";

export interface LocalMedia {
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
}

// The professor's camera and microphone for the class. Muting turns a track
// off rather than removing it, so students' connections stay as they are.
export function useLocalMedia(): LocalMedia {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function start() {
    if (streamRef.current) return true;
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = s;
      setStream(s);
      setMicOn(true);
      setCamOn(true);
      return true;
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera and microphone are blocked. Allow them in the address bar, then try again."
          : "Couldn't start the camera. Is another app using it?",
      );
      return false;
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }

  function toggle(kind: "audio" | "video", on: boolean, set: (v: boolean) => void) {
    const tracks = kind === "audio" ? stream?.getAudioTracks() : stream?.getVideoTracks();
    if (!tracks?.length) return;
    for (const t of tracks) t.enabled = !on;
    set(!on);
  }

  return {
    stream,
    micOn,
    camOn,
    error,
    start,
    stop,
    toggleMic: () => toggle("audio", micOn, setMicOn),
    toggleCam: () => toggle("video", camOn, setCamOn),
  };
}

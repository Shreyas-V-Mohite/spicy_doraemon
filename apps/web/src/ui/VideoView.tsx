import { useEffect, useRef, useState } from "react";

// A live camera feed. Browsers may refuse to play sound until the viewer
// clicks something, so a blocked start shows a button to unmute.
export default function VideoView({
  stream,
  muted = false,
  mirrored = false,
  className,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) {
      v.play().then(
        () => setBlocked(false),
        () => setBlocked(true),
      );
    }
  }, [stream]);

  return (
    <>
      <video
        ref={ref}
        className={[className, mirrored ? "mirrored" : ""].filter(Boolean).join(" ")}
        autoPlay
        playsInline
        muted={muted}
      />
      {blocked && !muted && (
        <button
          className="unmute"
          onClick={() => void ref.current?.play().then(() => setBlocked(false))}
        >
          Click to hear your professor
        </button>
      )}
    </>
  );
}

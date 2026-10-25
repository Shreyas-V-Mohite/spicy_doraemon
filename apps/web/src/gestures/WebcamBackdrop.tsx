import { useEffect, useRef, useState } from "react";
import {
  HAND_SKELETON,
  type HandGestureController,
  type Keypoint,
  type TrackingSnapshot,
} from "@spicy/hand-gesture";

// The professor's mirrored camera feed behind the molecule, with the tracked
// hands drawn on top so the professor sees themselves "holding" it. The video
// and the overlay share one box and mirror, so landmarks line up with the hand.
// (The 3D viewer above this layer has a transparent background.)
export default function WebcamBackdrop({ controller }: { controller: HandGestureController }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapRef = useRef<TrackingSnapshot | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    return controller.subscribeSnapshots((s) => {
      snapRef.current = s;
      setLive(s.phase === "running");
    });
  }, [controller]);

  // Mount the controller's <video> element into the backdrop.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const video = controller.webcam.video;
    video.className = "backdrop__video";
    host.prepend(video);
    return () => video.remove();
  }, [controller]);

  useEffect(() => {
    let raf = 0;
    let drawn: unknown = null;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const snap = snapRef.current;
      if (!canvas || !ctx || !snap) return;
      const frame = snap.phase === "running" ? snap.frame : null;
      // Only redraw when a new tracking result arrived.
      if (frame === drawn) return;
      drawn = frame;
      if (!frame) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      if (canvas.width !== frame.frameWidth || canvas.height !== frame.frameHeight) {
        canvas.width = frame.frameWidth;
        canvas.height = frame.frameHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = frame.frameWidth / 640;
      // Other people's hands: faint, to show they are seen but ignored.
      for (const other of frame.ignored ?? []) drawHand(ctx, other.keypoints, "#94a3b8", scale, 0.35);
      for (const h of snap.hands) {
        const mode = h.mapper.mode;
        const accent =
          mode === "ROTATE" ? "#7dd3fc" : mode === "MOVE" ? "#86efac" : mode === "ZOOM" ? "#f0abfc" : "#c7d2fe";
        drawHand(ctx, h.hand.keypoints, accent, scale, 1);
        if (mode === "MOVE") {
          // A ring at the index fingertip: the molecule is grabbed under it.
          const tip = h.hand.keypoints[8];
          ctx.strokeStyle = "#86efac";
          ctx.lineWidth = 3 * scale;
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, 16 * scale, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={live ? "backdrop is-live" : "backdrop"} ref={hostRef} aria-hidden>
      <canvas ref={canvasRef} className="backdrop__overlay" />
      <div className="backdrop__shade" />
    </div>
  );
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  kp: Keypoint[],
  accent: string,
  scale: number,
  alpha: number,
) {
  ctx.lineWidth = 3.5 * scale;
  ctx.lineCap = "round";
  ctx.strokeStyle = accent;
  for (const [i, j] of HAND_SKELETON) {
    const a = kp[i];
    const c = kp[j];
    ctx.globalAlpha = alpha * Math.max(0.25, Math.min(0.9, Math.min(a.score, c.score) * 1.3));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
  kp.forEach((k, idx) => {
    ctx.fillStyle = idx % 4 === 0 && idx > 0 ? "#ffffff" : accent;
    ctx.globalAlpha = alpha * Math.max(0.3, Math.min(1, k.score * 1.4));
    ctx.beginPath();
    ctx.arc(k.x, k.y, (idx % 4 === 0 ? 4.5 : 3) * scale, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

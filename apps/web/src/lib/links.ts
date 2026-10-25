// VITE_PUBLIC_URL lets a local dev page still hand students the public address.
const origin = import.meta.env.VITE_PUBLIC_URL || window.location.origin;

// Where students join a session: printed on the stage, in the QR code, and
// copied for the video-call chat.
export function studentUrl(code: string): string {
  return `${origin}/s/${code}`;
}

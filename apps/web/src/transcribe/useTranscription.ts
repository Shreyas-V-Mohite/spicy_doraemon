import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriberStatus } from "./Transcriber";
import { WebSpeechTranscriber } from "./WebSpeechTranscriber";

interface Options {
  // Called with each finished phrase.
  onFinal: (text: string) => void;
  // Called when listening starts or stops, for telling students.
  onActiveChange: (active: boolean) => void;
}

// Owns the transcriber for the page's lifetime so it keeps running while the
// private panel is hidden in Present mode.
export function useTranscription({ onFinal, onActiveChange }: Options) {
  const [status, setStatus] = useState<TranscriberStatus>("off");
  const [detail, setDetail] = useState<string | undefined>();
  const [interim, setInterim] = useState("");
  const handlers = useRef({ onFinal, onActiveChange });
  useEffect(() => {
    handlers.current = { onFinal, onActiveChange };
  });
  const transcriber = useRef<WebSpeechTranscriber | null>(null);
  // Chrome restarts recognition about once a minute; only report real changes.
  const active = useRef(false);

  const get = useCallback(() => {
    if (!transcriber.current) {
      transcriber.current = new WebSpeechTranscriber({
        onFinal: (t) => handlers.current.onFinal(t),
        onInterim: setInterim,
        onStatus: (s, d) => {
          setStatus(s);
          setDetail(d);
          const nowActive = s === "listening";
          if (nowActive !== active.current) {
            active.current = nowActive;
            handlers.current.onActiveChange(nowActive);
          }
        },
      });
    }
    return transcriber.current;
  }, []);

  const start = useCallback(() => get().start(), [get]);
  const stop = useCallback(() => get().stop(), [get]);
  const supported = typeof window !== "undefined" && get().supported;

  // Leaving the page stops listening.
  useEffect(() => () => transcriber.current?.stop(), []);

  return { status, detail, interim, start, stop, supported };
}

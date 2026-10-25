import { useEffect, useRef, useState } from "react";
import { recognitionCtor, type Recognition } from "./WebSpeechTranscriber";

// Speak a question instead of typing it: one utterance, recognised by the
// browser (Chrome/Edge) in the browser's language, appended to the draft.
// The student still reviews it and presses Ask.
export function useDictation(onText: (text: string, final: boolean) => void) {
  const rec = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = recognitionCtor() !== null;

  useEffect(() => () => rec.current?.stop(), []);

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = false;
    r.interimResults = true;
    r.onstart = () => {
      setError(null);
      setListening(true);
    };
    r.onresult = (e) => {
      let text = "";
      let final = true;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (!e.results[i].isFinal) final = false;
      }
      onTextRef.current(text.trim(), final);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access is blocked. Allow it in the address bar to speak your question.");
      } else if (e.error === "no-speech") {
        setError("Didn't catch that. Try again.");
      } else if (e.error !== "aborted") {
        setError("Speech recognition stopped. Try again or type your question.");
      }
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    r.start();
  }

  return { supported, listening, error, start, stop: () => rec.current?.stop() };
}

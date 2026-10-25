import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// One download and parse per deck, shared by every view of it on the page.
const decks = new Map<string, Promise<PDFDocumentProxy>>();

function openDeck(url: string) {
  let deck = decks.get(url);
  if (!deck) {
    deck = pdfjs.getDocument({ url }).promise;
    deck.catch(() => decks.delete(url));
    decks.set(url, deck);
  }
  return deck;
}

// Page count of a PDF the professor is about to upload.
export async function countPages(file: File): Promise<number> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = doc.numPages;
  void doc.destroy();
  return n;
}

// One slide as a JPEG (base64, no data: prefix) plus its text, for Claude to
// read the molecules on it.
export async function renderSlideForAi(url: string, index: number): Promise<{ image: string; text: string }> {
  const doc = await openDeck(url);
  const page = await doc.getPage(Math.min(doc.numPages, index + 1));
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, 1280 / base.width) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas unavailable");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: g, viewport }).promise;
  const content = await page.getTextContent();
  const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  return { image: canvas.toDataURL("image/jpeg", 0.8).split(",")[1], text };
}

// Draws one page of the deck, fitted inside its box and sharp on HiDPI screens.
export default function SlideView({ url, index }: { url: string; index: number }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    openDeck(url).then(
      (d) => live && setDoc(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [url]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!doc || !c || size.w === 0 || size.h === 0) return;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null = null;
    let cancelled = false;
    void (async () => {
      const page = await doc.getPage(Math.min(doc.numPages, index + 1));
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(size.w / base.width, size.h / base.height);
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: fit * dpr });
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      c.style.width = `${Math.floor(viewport.width / dpr)}px`;
      c.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, size]);

  return (
    <div ref={box} className="slide-view">
      {failed ? <p className="muted small">The slides couldn't be loaded.</p> : <canvas ref={canvas} />}
    </div>
  );
}

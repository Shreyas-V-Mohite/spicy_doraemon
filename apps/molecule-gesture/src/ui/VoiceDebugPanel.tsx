import type { MoleculeVoice } from '../voice/useMoleculeVoice';

const ENGINE_LABEL = { deepgram: 'Deepgram Nova-3', browser: 'Browser (Web Speech API)' } as const;

/**
 * Voice pipeline, step by step, for the last phrase: what the speech engine
 * transcribed, how it was interpreted, and what PubChem confirmed.
 * Off by default (⚙ → Voice debug panel, or ?debug=voice).
 */
export function VoiceDebugPanel({ voice, onClose }: { voice: MoleculeVoice; onClose(): void }) {
  const d = voice.debug;
  return (
    <aside className="voice-debug" aria-label="Voice debug panel">
      <header>
        <strong>Voice debug</strong>
        <span className="voice-debug__engine" data-engine={d.engine}>
          {ENGINE_LABEL[d.engine]}
        </span>
        <button className="voice-debug__close" onClick={onClose} aria-label="Close voice debug panel">
          ×
        </button>
      </header>
      {d.engineNote && <p className="voice-debug__note">{d.engineNote}</p>}
      <dl>
        <dt>Live (not acted on)</dt>
        <dd data-field="live">{d.live || '—'}</dd>
        <dt>Raw transcript (final)</dt>
        <dd data-field="raw">{d.raw || '—'}</dd>
        <dt>Interpreted command</dt>
        <dd data-field="command">{d.command || '—'}</dd>
        <dt>Validated molecule (PubChem)</dt>
        <dd data-field="validated">{d.validated.length ? d.validated.map((v, i) => <div key={i}>{v}</div>) : '—'}</dd>
      </dl>
    </aside>
  );
}

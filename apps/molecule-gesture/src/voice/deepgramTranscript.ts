/**
 * Turns Deepgram streaming messages into live captions and finished phrases.
 *
 * Deepgram sends interim Results (may still change), final Results
 * (is_final: that stretch of audio won't change), and marks the end of an
 * utterance with speech_final (after a short silence) or an UtteranceEnd
 * message. A phrase is only handed on when the utterance is over, built
 * from final segments only, so commands never act on unstable words.
 */
export interface DeepgramMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string; confidence?: number }[] };
}

export interface TranscriptUpdate {
  /** Words so far in the current utterance (finals + the latest interim), for captions. */
  interim?: string;
  /** A finished utterance (final segments only). */
  final?: string;
}

export class DeepgramTranscript {
  private committed: string[] = [];

  reset(): void {
    this.committed = [];
  }

  feed(msg: DeepgramMessage): TranscriptUpdate {
    if (msg.type === 'UtteranceEnd') return this.finish();
    if (msg.type !== 'Results') return {};
    const text = (msg.channel?.alternatives?.[0]?.transcript ?? '').trim();
    if (!msg.is_final) return { interim: [...this.committed, text].filter(Boolean).join(' ') };
    if (text) this.committed.push(text);
    if (msg.speech_final) return this.finish();
    return { interim: this.committed.join(' ') };
  }

  private finish(): TranscriptUpdate {
    const final = this.committed.join(' ').trim();
    this.committed = [];
    return final ? { final, interim: '' } : {};
  }
}

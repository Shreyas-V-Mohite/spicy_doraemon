import { CommandEmitter, type GestureCommand, type GestureController, type GestureCommandListener } from './types';

export const MANUAL_ROTATE_STEP = 12; // degrees per press
export const MANUAL_ZOOM_STEP = 1.15;

/**
 * Buttons + keyboard fallback. Emits the exact same GestureCommands as the
 * hand pipeline, so the viewer cannot tell the two apart.
 *
 * Keys: ←/→/↑/↓ rotate, Q/E spin, +/− zoom, R reset, Esc stop.
 */
export class ManualGestureController implements GestureController {
  private readonly commands = new CommandEmitter();
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window) {}

  subscribe(callback: GestureCommandListener): () => void {
    return this.commands.subscribe(callback);
  }

  async start(): Promise<void> {
    if (this.keyHandler) return;
    this.keyHandler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const cmd = keyToCommand(e.key);
      if (cmd) {
        e.preventDefault();
        this.commands.emit(cmd);
      }
    };
    this.target.addEventListener('keydown', this.keyHandler as EventListener);
  }

  stop(): void {
    if (this.keyHandler) this.target.removeEventListener('keydown', this.keyHandler as EventListener);
    this.keyHandler = null;
  }

  rotate(dx: number, dy: number, dz = 0): void {
    this.commands.emit({ type: 'ROTATE', dx, dy, dz });
  }

  zoom(factor: number): void {
    this.commands.emit({ type: 'ZOOM', factor });
  }

  reset(): void {
    this.commands.emit({ type: 'RESET' });
  }

  halt(): void {
    this.commands.emit({ type: 'STOP' });
  }
}

export function keyToCommand(key: string): GestureCommand | null {
  switch (key) {
    case 'ArrowLeft':
      return { type: 'ROTATE', dx: -MANUAL_ROTATE_STEP, dy: 0 };
    case 'ArrowRight':
      return { type: 'ROTATE', dx: MANUAL_ROTATE_STEP, dy: 0 };
    case 'ArrowUp':
      return { type: 'ROTATE', dx: 0, dy: -MANUAL_ROTATE_STEP };
    case 'ArrowDown':
      return { type: 'ROTATE', dx: 0, dy: MANUAL_ROTATE_STEP };
    case 'q':
    case 'Q':
      return { type: 'ROTATE', dx: 0, dy: 0, dz: -MANUAL_ROTATE_STEP };
    case 'e':
    case 'E':
      return { type: 'ROTATE', dx: 0, dy: 0, dz: MANUAL_ROTATE_STEP };
    case '+':
    case '=':
      return { type: 'ZOOM', factor: MANUAL_ZOOM_STEP };
    case '-':
    case '_':
      return { type: 'ZOOM', factor: 1 / MANUAL_ZOOM_STEP };
    case 'r':
    case 'R':
      return { type: 'RESET' };
    case 'Escape':
      return { type: 'STOP' };
    default:
      return null;
  }
}

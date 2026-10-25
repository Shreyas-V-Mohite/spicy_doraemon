import { useState } from 'react';
import { STDB_DB_NAME, STDB_HOST } from '../sync/config';

function randomRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `CHEM-${s}`;
}

function go(params: Record<string, string>) {
  const u = new URL(location.href);
  u.search = new URLSearchParams(params).toString();
  location.assign(u.toString());
}

export function Lobby() {
  const [roomId, setRoomId] = useState(randomRoomId);
  const [name, setName] = useState('');
  const cleanRoom = roomId.trim().toUpperCase();
  const valid = /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(cleanRoom);

  return (
    <div className="lobby">
      <div className="lobby__card">
        <div className="lobby__hero">
          <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden>
            <g fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="16" cy="16" r="4" fill="currentColor" />
              <circle cx="6" cy="8" r="3" />
              <circle cx="26" cy="8" r="3" />
              <circle cx="16" cy="28" r="3" />
              <path d="M13 14 8 10M19 14l5-4M16 20v5" />
            </g>
          </svg>
          <h1>Molecule Gesture Lab</h1>
          <p>Teach organic chemistry by turning molecules in mid-air. Your students see every move live.</p>
        </div>

        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prof. Rivera" maxLength={40} />
        </label>
        <label className="field">
          <span>Room ID</span>
          <div className="field__row">
            <input
              className="mono"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              maxLength={32}
              aria-invalid={!valid}
            />
            <button className="btn btn--ghost" onClick={() => setRoomId(randomRoomId())} title="New random room">
              ↻
            </button>
          </div>
        </label>

        <div className="lobby__actions">
          <button
            className="btn btn--primary btn--lg"
            disabled={!valid}
            onClick={() => go({ room: cleanRoom, role: 'teacher', name: name.trim() || 'Teacher' })}
          >
            Start class as teacher
          </button>
          <button
            className="btn btn--secondary btn--lg"
            disabled={!valid}
            onClick={() => go({ room: cleanRoom, role: 'student', name: name.trim() || `Student ${Math.floor(Math.random() * 900 + 100)}` })}
          >
            Join as student
          </button>
        </div>
        <button className="btn btn--link" onClick={() => go({ role: 'solo', name: name.trim() || 'You' })}>
          Try it solo (no SpacetimeDB needed)
        </button>
        <p className="lobby__footnote">
          Sync: <code>{STDB_HOST}</code> · database <code>{STDB_DB_NAME}</code>
        </p>
      </div>
    </div>
  );
}

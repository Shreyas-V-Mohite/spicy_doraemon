/**
 * Molecule Gesture Lab — SpacetimeDB module.
 *
 * SpacetimeDB is the classroom's authoritative real-time state:
 *   room            – one row per classroom session (teacher, follow lock)
 *   scene_molecule  – every molecule on the teacher's stage: which molecule,
 *                     its own 3Dmol camera (rotation / size / placement),
 *                     updated ~10 Hz while the teacher manipulates it
 *   participant     – who is connected to which room, and in which role
 *
 * Molecules are only ever added (by voice) and removed (dropped in the
 * trash). Clients subscribe only to their own room's rows (room isolation).
 *
 * AUTH NOTE (hackathon/demo level): the teacher is whichever identity first
 * opens the room as teacher. Only that identity may change the scene. If that
 * teacher is offline, another teacher may take over. No passwords/accounts.
 */
import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';

const room = table(
  { public: true },
  {
    roomId: t.string().primaryKey(),
    teacher: t.identity(),
    /** When true, students are kept in Follow Teacher mode. */
    lockFollow: t.bool(),
    createdAt: t.timestamp(),
  },
);

const sceneMolecule = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.string().index('btree'),
    /** e.g. "builtin:benzene" or "pubchem:2519" — every client resolves it the same way. */
    moleculeId: t.string(),
    /**
     * 3Dmol setView(): [pos.x, pos.y, pos.z, zoom, q.x, q.y, q.z, q.w, screen x, screen y].
     * Empty right after it is added, until the teacher's viewer has laid it out.
     */
    view: t.array(t.f64()),
    /** Teacher's interaction with this molecule, e.g. "ROTATE", "MOVE", "IDLE". */
    gesture: t.string(),
    /** Server-assigned, increasing per update. */
    seq: t.u64(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const participant = table(
  { public: true },
  {
    /** Hex ConnectionId — one row per open browser tab. */
    connectionKey: t.string().primaryKey(),
    identity: t.identity(),
    roomId: t.string().index('btree'),
    role: t.string(),
    name: t.string(),
    joinedAt: t.timestamp(),
  },
);

const spacetimedb = schema({ room, sceneMolecule, participant });
export default spacetimedb;

const ROOM_ID_RE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const MOLECULE_ID_RE = /^[a-z][a-z0-9_-]*:[A-Za-z0-9_.-]{1,64}$/;
/** WebGL contexts are limited per page; each molecule gets its own viewer. */
const MAX_MOLECULES = 8;

function normalizeRoomId(raw: string): string {
  const id = raw.trim().toUpperCase();
  if (!ROOM_ID_RE.test(id)) {
    throw new SenderError('Room ID must be 3–32 characters: letters, digits and dashes.');
  }
  return id;
}

function connectionKey(ctx: { connectionId: { toHexString(): string } | null }): string {
  if (!ctx.connectionId) throw new SenderError('This reducer must be called from a client connection.');
  return ctx.connectionId.toHexString();
}

function requireTeacher<R extends { teacher: Identity }>(r: R | null, sender: Identity, roomId: string): R {
  if (!r) throw new SenderError(`Room ${roomId} does not exist.`);
  if (!r.teacher.isEqual(sender)) throw new SenderError('Only the room teacher can do that.');
  return r;
}

function checkView(view: number[]) {
  if (![0, 8, 10].includes(view.length) || !view.every((v) => Number.isFinite(v) && Math.abs(v) < 1e6)) {
    throw new SenderError('View must be empty or 8/10 finite numbers (3Dmol setView format).');
  }
}

export const joinRoom = spacetimedb.reducer(
  { roomId: t.string(), role: t.string(), name: t.string() },
  (ctx, { roomId: rawRoomId, role, name }) => {
    const roomId = normalizeRoomId(rawRoomId);
    if (role !== 'teacher' && role !== 'student') throw new SenderError('Role must be "teacher" or "student".');
    const displayName = name.trim().slice(0, 40) || (role === 'teacher' ? 'Teacher' : 'Student');
    const key = connectionKey(ctx);

    if (role === 'teacher') {
      const existing = ctx.db.room.roomId.find(roomId);
      if (!existing) {
        ctx.db.room.insert({ roomId, teacher: ctx.sender, lockFollow: false, createdAt: ctx.timestamp });
      } else if (!existing.teacher.isEqual(ctx.sender)) {
        // Demo-level takeover: allowed only if the original teacher is gone.
        for (const p of ctx.db.participant.roomId.filter(roomId)) {
          if (p.role === 'teacher' && p.connectionKey !== key) {
            throw new SenderError('This room already has an active teacher. Join as a student or pick another room ID.');
          }
        }
        ctx.db.room.roomId.update({ ...existing, teacher: ctx.sender });
      }
    }

    const row = { connectionKey: key, identity: ctx.sender, roomId, role, name: displayName, joinedAt: ctx.timestamp };
    if (ctx.db.participant.connectionKey.find(key)) ctx.db.participant.connectionKey.update(row);
    else ctx.db.participant.insert(row);
  },
);

export const leaveRoom = spacetimedb.reducer((ctx) => {
  ctx.db.participant.connectionKey.delete(connectionKey(ctx));
});

export const addMolecule = spacetimedb.reducer(
  { roomId: t.string(), moleculeId: t.string(), view: t.array(t.f64()) },
  (ctx, { roomId: rawRoomId, moleculeId, view }) => {
    const roomId = normalizeRoomId(rawRoomId);
    requireTeacher(ctx.db.room.roomId.find(roomId), ctx.sender, roomId);
    if (!MOLECULE_ID_RE.test(moleculeId)) throw new SenderError('Invalid molecule ID.');
    checkView(view);
    let count = 0;
    for (const _ of ctx.db.sceneMolecule.roomId.filter(roomId)) count++;
    if (count >= MAX_MOLECULES) throw new SenderError(`At most ${MAX_MOLECULES} molecules — drop one in the trash first.`);
    ctx.db.sceneMolecule.insert({
      id: 0n, // auto-increment
      roomId,
      moleculeId,
      view,
      gesture: 'IDLE',
      seq: 1n,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
  },
);

export const updateMolecule = spacetimedb.reducer(
  { id: t.u64(), view: t.array(t.f64()), gesture: t.string() },
  (ctx, { id, view, gesture }) => {
    const m = ctx.db.sceneMolecule.id.find(id);
    if (!m) return; // already trashed; a late update is harmless
    requireTeacher(ctx.db.room.roomId.find(m.roomId), ctx.sender, m.roomId);
    checkView(view);
    ctx.db.sceneMolecule.id.update({ ...m, view, gesture: gesture.slice(0, 16), seq: m.seq + 1n, updatedAt: ctx.timestamp });
  },
);

export const removeMolecule = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const m = ctx.db.sceneMolecule.id.find(id);
  if (!m) return;
  requireTeacher(ctx.db.room.roomId.find(m.roomId), ctx.sender, m.roomId);
  ctx.db.sceneMolecule.id.delete(id);
});

export const setLockFollow = spacetimedb.reducer(
  { roomId: t.string(), locked: t.bool() },
  (ctx, { roomId: rawRoomId, locked }) => {
    const roomId = normalizeRoomId(rawRoomId);
    const r = requireTeacher(ctx.db.room.roomId.find(roomId), ctx.sender, roomId);
    ctx.db.room.roomId.update({ ...r, lockFollow: locked });
  },
);

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  if (ctx.connectionId) ctx.db.participant.connectionKey.delete(ctx.connectionId.toHexString());
});

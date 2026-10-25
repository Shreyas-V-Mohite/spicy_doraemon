import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from '../module_bindings';
import { isViewState, toViewState, type ViewState } from '../viewer/viewState';
import type { SceneItem, SceneStore } from '../scene/types';
import type { Role } from './config';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface SharedRoom {
  roomId: string;
  lockFollow: boolean;
  teacherHex: string;
}

export interface ClassroomSync {
  status: ConnectionStatus;
  statusDetail?: string;
  identityHex?: string;
  joined: boolean;
  /** All room-scoped subscriptions have delivered their initial rows. */
  ready: boolean;
  joinError?: string;
  room: SharedRoom | null;
  /** The shared stage: every molecule in the room, with its own view. */
  scene: SceneStore;
  participants: { name: string; role: string; isMe: boolean }[];
  /** True when this tab's identity owns the room (may edit the scene). */
  isRoomTeacher: boolean;
  setLockFollow(locked: boolean): void;
  lastPublishError?: string;
}

/**
 * Room-scoped SpacetimeDB state for one tab. Subscribes only to rows for
 * `roomId` (room isolation) and (re)joins the room on every new connection,
 * including after automatic reconnects (each gets a new ConnectionId).
 */
export function useClassroomSync(roomId: string, role: Role, name: string): ClassroomSync {
  const conn = useSpacetimeDB();
  const { isActive, identity, connectionError } = conn;
  const connectionHex = conn.connectionId?.toHexString();
  const [joinError, setJoinError] = useState<string>();
  const [joinedConnection, setJoinedConnection] = useState<string>();
  const [lastPublishError, setLastPublishError] = useState<string>();
  const everConnected = useRef(false);
  if (isActive) everConnected.current = true;

  const [roomRows, roomReady] = useTable(tables.room.where((r) => r.roomId.eq(roomId)));
  const [moleculeRows, moleculesReady] = useTable(tables.sceneMolecule.where((r) => r.roomId.eq(roomId)));
  const [participantRows, participantsReady] = useTable(tables.participant.where((r) => r.roomId.eq(roomId)));

  const getConn = useCallback(() => conn.getConnection() as DbConnection | null, [conn]);
  const report = useCallback((err: unknown) => setLastPublishError(err instanceof Error ? err.message : String(err)), []);

  // Join (or re-join after reconnect) once the socket is live.
  useEffect(() => {
    if (!isActive || !connectionHex) return;
    const c = getConn();
    if (!c) return;
    let cancelled = false;
    c.reducers
      .joinRoom({ roomId, role, name })
      .then(() => {
        if (cancelled) return;
        setJoinError(undefined);
        setJoinedConnection(connectionHex);
      })
      .catch((err: unknown) => {
        if (!cancelled) setJoinError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [isActive, connectionHex, roomId, role, name, getConn]);

  // Leave cleanly when the tab closes (disconnect also cleans up server-side).
  useEffect(() => {
    const leave = () => {
      getConn()?.reducers.leaveRoom({}).catch(() => {});
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, [getConn]);

  const room: SharedRoom | null = useMemo(() => {
    const r = roomRows[0];
    return r ? { roomId: r.roomId, lockFollow: r.lockFollow, teacherHex: r.teacher.toHexString() } : null;
  }, [roomRows]);

  const items: SceneItem[] = useMemo(
    () =>
      [...moleculeRows]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((m) => ({
          key: m.id.toString(),
          moleculeId: m.moleculeId,
          view: isViewState(m.view) ? toViewState(m.view) : null,
          gesture: m.gesture,
          seq: Number(m.seq),
        })),
    [moleculeRows],
  );

  const participants = useMemo(
    () =>
      participantRows
        .map((p) => ({ name: p.name, role: p.role, isMe: p.connectionKey === connectionHex }))
        .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'teacher' ? -1 : 1)),
    [participantRows, connectionHex],
  );

  const identityHex = identity?.toHexString();
  const isRoomTeacher = role === 'teacher' && !!room && !!identityHex && room.teacherHex === identityHex;

  const add = useCallback(
    (moleculeId: string) => {
      getConn()?.reducers.addMolecule({ roomId, moleculeId, view: [] }).then(() => setLastPublishError(undefined), report);
    },
    [getConn, roomId, report],
  );

  const update = useCallback(
    (key: string, view: ViewState, gesture: string) => {
      const c = getConn();
      if (!c || !isActive) return;
      c.reducers.updateMolecule({ id: BigInt(key), view: [...view], gesture }).catch(report);
    },
    [getConn, isActive, report],
  );

  const remove = useCallback(
    (key: string) => {
      getConn()?.reducers.removeMolecule({ id: BigInt(key) }).catch(report);
    },
    [getConn, report],
  );

  const scene: SceneStore = useMemo(
    () => ({ items, canEdit: isRoomTeacher, add, update, remove, lastError: lastPublishError }),
    [items, isRoomTeacher, add, update, remove, lastPublishError],
  );

  const setLockFollow = useCallback(
    (locked: boolean) => {
      getConn()?.reducers.setLockFollow({ roomId, locked }).catch(report);
    },
    [getConn, roomId, report],
  );

  const status: ConnectionStatus = isActive ? 'connected' : everConnected.current ? 'reconnecting' : connectionError ? 'offline' : 'connecting';

  return {
    status,
    statusDetail: connectionError?.message,
    identityHex,
    joined: isActive && joinedConnection === connectionHex,
    ready: roomReady && moleculesReady && participantsReady,
    joinError,
    room,
    scene,
    participants,
    isRoomTeacher,
    setLockFollow,
    lastPublishError,
  };
}

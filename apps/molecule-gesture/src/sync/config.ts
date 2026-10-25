import { DbConnection, type ErrorContext } from '../module_bindings';
import type { Identity } from 'spacetimedb';

export const STDB_HOST: string = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
export const STDB_DB_NAME: string = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'molecule-gesture';


export type Role = 'teacher' | 'student';

/**
 * Tokens are stored per role so a teacher tab and a student tab in the same
 * browser get distinct SpacetimeDB identities (otherwise both would share
 * one identity and the student tab would be treated as the teacher).
 */
function tokenKey(role: Role) {
  return `${STDB_HOST}/${STDB_DB_NAME}/${role}/auth_token`;
}

function readToken(role: Role): string | undefined {
  try {
    return localStorage.getItem(tokenKey(role)) || undefined;
  } catch {
    return undefined;
  }
}

function saveToken(role: Role, token: string) {
  try {
    localStorage.setItem(tokenKey(role), token);
  } catch {
    /* storage unavailable (private mode); identity just won't persist */
  }
}

export function createConnectionBuilder(role: Role) {
  return DbConnection.builder()
    .withUri(STDB_HOST)
    .withDatabaseName(STDB_DB_NAME)
    .withToken(readToken(role))
    .withAutomaticReconnect()
    .onConnect((_conn: DbConnection, identity: Identity, token: string) => {
      saveToken(role, token);
      console.info(`[stdb] connected as ${role} ${identity.toHexString().slice(0, 12)}…`);
    })
    .onAutomaticReconnect((_conn: DbConnection, _identity: Identity, token: string) => {
      saveToken(role, token);
      console.info('[stdb] reconnected');
    })
    .onDisconnect(() => console.warn('[stdb] disconnected'))
    .onConnectError((_ctx: ErrorContext, err: Error) => console.error('[stdb] connection error', err));
}

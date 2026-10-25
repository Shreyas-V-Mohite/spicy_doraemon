import { useMemo } from 'react';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { Lobby } from './ui/Lobby';
import { ClassroomView } from './ui/ClassroomView';
import { createConnectionBuilder, type Role } from './sync/config';
import { useClassroomSync } from './sync/useClassroomSync';

type PageRoleParam = Role | 'solo';
const isRole = (r: string | null): r is PageRoleParam => r === 'teacher' || r === 'student' || r === 'solo';

function readParams() {
  const p = new URLSearchParams(location.search);
  const role = p.get('role');
  return {
    role: isRole(role) ? role : null,
    roomId: (p.get('room') ?? '').trim().toUpperCase(),
    name: (p.get('name') ?? '').trim().slice(0, 40),
  };
}

export default function App() {
  const { role, roomId, name } = useMemo(readParams, []);

  if (role === 'solo') return <ClassroomView role="solo" name={name || 'You'} sync={null} />;
  if (!role || !roomId) return <Lobby />;
  return <SyncedRoom role={role} roomId={roomId} name={name || (role === 'teacher' ? 'Teacher' : 'Student')} />;
}

function SyncedRoom({ role, roomId, name }: { role: Role; roomId: string; name: string }) {
  const builder = useMemo(() => createConnectionBuilder(role), [role]);
  return (
    <SpacetimeDBProvider connectionBuilder={builder}>
      <SyncedClassroom role={role} roomId={roomId} name={name} />
    </SpacetimeDBProvider>
  );
}

function SyncedClassroom({ role, roomId, name }: { role: Role; roomId: string; name: string }) {
  const sync = useClassroomSync(roomId, role, name);
  return <ClassroomView role={role} roomId={roomId} name={name} sync={sync} />;
}

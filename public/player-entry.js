export function playerEntry(value, registrationOpen) {
  const name = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const shortcut = name.toLowerCase();
  if (shortcut === 'jhu asa presentation screen') return { path: '/screen' };
  if (shortcut === 'jhu asa 2026') return { path: '/staff' };
  if (name.length < 2 || name.length > 35) return { error: 'Enter a name between 2 and 35 characters.' };
  if (!registrationOpen) return { error: 'Player registration is closed. Check with an organizer.' };
  return { name };
}

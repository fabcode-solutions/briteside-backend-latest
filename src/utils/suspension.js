export function isUserEffectivelySuspended(user) {
  return (
    (user?.isSuspended ?? false) &&
    (!user?.suspendedUntil || new Date(user.suspendedUntil) > new Date())
  );
}

export function suspensionDaysRemaining(user) {
  if (!isUserEffectivelySuspended(user) || !user.suspendedUntil) return null;
  return Math.max(0, Math.ceil((new Date(user.suspendedUntil) - new Date()) / 86400000));
}

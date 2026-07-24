function projectionClock(activity) {
  if (!activity || typeof activity !== 'object') return null;
  const projection = activity.goal_tombstone || activity.goal_projection;
  const epoch = Number(projection?.epoch);
  const sequence = Number(projection?.sequence);
  if (!Number.isSafeInteger(epoch) || epoch <= 0
      || !Number.isSafeInteger(sequence) || sequence <= 0) return null;
  return {
    epoch,
    sequence,
    state: activity.goal_tombstone || projection?.state === 'clear' || activity.goal === null
      ? 'clear'
      : 'present',
  };
}

export function compareGoalProjectedActivity(incoming, previous) {
  const nextClock = projectionClock(incoming);
  const previousClock = projectionClock(previous);
  if (nextClock && previousClock) {
    if (nextClock.epoch !== previousClock.epoch) return nextClock.epoch < previousClock.epoch ? -1 : 1;
    if (nextClock.sequence !== previousClock.sequence) return nextClock.sequence < previousClock.sequence ? -1 : 1;
    if (nextClock.state !== previousClock.state) return nextClock.state === 'clear' ? 1 : -1;
  } else if (nextClock || previousClock) {
    return nextClock ? 1 : -1;
  }
  const nextTime = Date.parse(incoming?.observed_at || incoming?.updated_at || '') || 0;
  const previousTime = Date.parse(previous?.observed_at || previous?.updated_at || '') || 0;
  if (nextTime !== previousTime) return nextTime < previousTime ? -1 : 1;
  return 0;
}

export function mergeGoalProjectedActivity(previous, incoming) {
  if (!incoming || typeof incoming !== 'object') {
    return projectionClock(previous) ? previous : incoming;
  }
  if (previous && compareGoalProjectedActivity(incoming, previous) < 0) return previous;
  return incoming;
}

export interface AfterTask { readonly title: string; readonly minutes: number; }
export interface ActivityPlan {
  readonly playMinutes: number;
  readonly afterTask: AfterTask | null;
}
export interface ActivityRun extends ActivityPlan {
  readonly source: Readonly<{ rouletteId: string; choiceIndex: number; version: string }>;
}

export function validateActivityPlan(data: Readonly<Record<string, unknown>>): ActivityPlan | Readonly<{ error: string }> {
  const playMinutes = data.playMinutes === undefined ? 30 : data.playMinutes;
  const raw = data.afterTask;
  const task = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Readonly<Record<string, unknown>> : null;
  return typeof playMinutes !== 'number' || !Number.isInteger(playMinutes) || playMinutes < 1 || playMinutes > 240
    ? { error: 'Choose a play time of 1–240 whole minutes.' }
    : raw === undefined || raw === null ? { playMinutes, afterTask: null }
    : !task || Object.keys(task).some(key => !['title', 'minutes'].includes(key))
      || typeof task.title !== 'string' || !task.title.trim() || task.title.trim().length > 60
      ? { error: 'Give the task a name of 1–60 characters.' }
    : typeof task.minutes !== 'number' || !Number.isInteger(task.minutes) || task.minutes < 1 || task.minutes > 60
      ? { error: 'Choose a task time of 1–60 whole minutes.' }
      : { playMinutes, afterTask: { title: task.title.trim(), minutes: task.minutes } };
}

export function activityMinutes(plan: ActivityPlan): number { return plan.playMinutes + (plan.afterTask?.minutes ?? 0); }

// Use absolute instants, so reloading or waking a sleeping tab resumes the
// correct step without a background timer or another database write.
export function activityPhase(title: string, startAt: string, plan: ActivityPlan, now: number) {
  const start = Date.parse(startAt), playEnd = start + plan.playMinutes * 60000;
  const end = start + activityMinutes(plan) * 60000;
  const isAfter = !!plan.afterTask && now >= playEnd;
  const phaseStart = isAfter ? playEnd : start, phaseEnd = isAfter ? end : playEnd;
  return {
    title: isAfter ? plan.afterTask.title : title,
    stage: now >= end ? 'complete' : isAfter ? 'after' : 'play',
    progress: Math.max(0, Math.min(100, (now - phaseStart) / (phaseEnd - phaseStart) * 100)),
    remaining: Math.max(0, phaseEnd - now),
  } as const;
}

export interface StartRouletteInput {
  readonly choiceIndex: number;
  readonly requestId: string;
  readonly version: string;
}
export function validateRouletteStart(data: Readonly<Record<string, unknown>>): StartRouletteInput | Readonly<{ error: string }> {
  return Object.keys(data).some(key => !['choiceIndex', 'requestId', 'version'].includes(key))
    || typeof data.choiceIndex !== 'number' || !Number.isInteger(data.choiceIndex) || data.choiceIndex < 0 || data.choiceIndex >= 20
    || typeof data.requestId !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.requestId)
    || typeof data.version !== 'string' || !data.version || data.version.length > 40
    ? { error: 'Choose a roulette result before starting.' }
    : { choiceIndex: data.choiceIndex, requestId: data.requestId, version: data.version };
}

export function matchesStart(run: ActivityRun | undefined, rouletteId: string, input: StartRouletteInput): boolean {
  return run?.source.rouletteId === rouletteId && run.source.choiceIndex === input.choiceIndex && run.source.version === input.version;
}

<script lang="ts">
  import { palette, remainingText, type cycle, type EventInput } from '@little/shared/events';
  import type { ScheduleRecord } from '@little/shared/api';
  import {
    buildQuickTimer,
    extendQuickTimer,
    isQuickTimer,
    MAX_TIMER_MINUTES,
    timerDurationLabel,
    timerDurations,
    timerPresets,
    timerTotalMinutes,
    type TimerPreset,
  } from '@little/shared/timer';

  type TimedSchedule = Readonly<ScheduleRecord & { timing: ReturnType<typeof cycle> }>;

  let {
    events,
    busy,
    oncreate,
    onupdate,
    onremove,
  }: {
    events: Readonly<Record<number, TimedSchedule>>;
    busy: boolean;
    oncreate: (input: Readonly<EventInput>, label: string) => void;
    onupdate: (id: string, input: Readonly<EventInput>, label: string) => void;
    onremove: (event: Readonly<ScheduleRecord>) => void;
  } = $props();

  const presetList: Readonly<Record<number, TimerPreset>> = Object.fromEntries(
    [
      ...Object.values(timerPresets),
      { id: 'custom', title: 'Custom', emoji: '✨', color: palette[0] },
    ].entries(),
  );
  const presetCount = Object.values(presetList).length;
  const durationList: Readonly<Record<number, number>> = timerDurations;
  const durationCount = Object.values(durationList).length;

  let step = $state<'activity' | 'duration' | 'running'>('activity');
  let presetIndex = $state(0);
  let durationIndex = $state(3); // Default to 30 min (index 3 in [5, 10, 15, 30, 45, 60])
  let runningIndex = $state(0);
  let customTitle = $state('My timer');
  let customEmoji = $state('✨');
  let customColor = $state(palette[0]);
  let swipeStartX = $state<number | null>(null);
  let error = $state('');

  const currentPreset: Readonly<TimerPreset> = $derived(
    presetList[presetIndex] ?? { id: 'game', title: 'Game time', emoji: '🎮', color: palette[0] },
  );
  const activeTitle = $derived(currentPreset.id === 'custom' ? customTitle : currentPreset.title);
  const activeEmoji = $derived(currentPreset.id === 'custom' ? customEmoji : currentPreset.emoji);
  const activeColor = $derived(currentPreset.id === 'custom' ? customColor : currentPreset.color);
  const currentDuration = $derived(durationList[durationIndex] ?? 30);

  const timerRows: Readonly<Record<number, TimedSchedule>> = $derived(
    Object.fromEntries(Object.values(events).filter(isQuickTimer).entries()),
  );
  const activeTimers: Readonly<Record<number, TimedSchedule>> = $derived(
    Object.fromEntries(
      Object.values(timerRows)
        .filter((e: TimedSchedule) => !e.timing.complete)
        .sort((a: TimedSchedule, b: TimedSchedule) => a.timing.end - b.timing.end)
        .entries(),
    ),
  );
  const activeTimerCount = $derived(Object.values(activeTimers).length);
  const safeRunningIndex = $derived(
    activeTimerCount === 0 ? 0 : Math.min(runningIndex, activeTimerCount - 1),
  );
  const currentRunningTimer: TimedSchedule | undefined = $derived(activeTimers[safeRunningIndex]);

  function cyclePreset(delta: number) {
    presetIndex = (presetIndex + delta + presetCount) % presetCount;
    error = '';
  }

  function cycleDuration(delta: number) {
    durationIndex = (durationIndex + delta + durationCount) % durationCount;
    error = '';
  }

  function cycleRunning(delta: number) {
    runningIndex = activeTimerCount <= 1 ? 0 : (safeRunningIndex + delta + activeTimerCount) % activeTimerCount;
  }

  // eslint-disable-next-line functional/prefer-immutable-types -- Read the pointer X coordinate to begin a horizontal carousel swipe gesture.
  function onPointerDown(event: PointerEvent) {
    swipeStartX = event.clientX;
  }

  // eslint-disable-next-line functional/prefer-immutable-types -- Complete a horizontal swipe gesture to advance the active carousel item.
  function onPointerUp(event: PointerEvent) {
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore pointer releases when no swipe gesture was started.
    if (swipeStartX === null) return;
    const dx = event.clientX - swipeStartX;
    swipeStartX = null;
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore small taps below the horizontal swipe threshold.
    if (Math.abs(dx) < 36) return;
    const delta = dx < 0 ? 1 : -1;
    void (step === 'activity' ? cyclePreset(delta) : step === 'duration' ? cycleDuration(delta) : cycleRunning(delta));
  }

  function startMinutes(minutes: number) {
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore duplicate clicks while a schedule write is already in flight.
    if (busy) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
    const built = buildQuickTimer({ title: activeTitle, emoji: activeEmoji, color: activeColor, minutes, timeZone: zone }, Date.now());
    // eslint-disable-next-line functional/no-conditional-statements -- Show validation feedback inline before issuing an API write.
    if ('error' in built) {
      error = built.error;
      return;
    }
    error = '';
    oncreate(built, `${built.emoji} ${built.title} (${timerDurationLabel(minutes)}) started!`);
    step = 'running';
    runningIndex = 0;
  }

  function addMinutes(item: TimedSchedule, extra: number) {
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore duplicate clicks while a schedule write is already in flight.
    if (busy || !item.canEdit) return;
    const updated = extendQuickTimer(item, extra, Date.now());
    // eslint-disable-next-line functional/no-conditional-statements -- Surface validation errors if the timer has reached the 240-minute ceiling.
    if ('error' in updated) {
      error = updated.error;
      return;
    }
    error = '';
    onupdate(item.id, updated, `Added +${extra} min to ${item.title}.`);
  }
</script>

<!-- eslint-disable functional/functional-parameters -- Carousel controls and step pills update the reactive single-screen stage. -->
<section class="game-timer-stage" aria-label="Quick family timer">
  <div class="stage-topbar">
    <div class="step-pills" role="tablist" aria-label="Timer steps">
      <button
        type="button"
        role="tab"
        aria-selected={step === 'activity'}
        class:active={step === 'activity'}
        onclick={() => { step = 'activity'; }}
      >1. Activity</button>
      <button
        type="button"
        role="tab"
        aria-selected={step === 'duration'}
        class:active={step === 'duration'}
        onclick={() => { step = 'duration'; }}
      >2. Time</button>
      <button
        type="button"
        role="tab"
        aria-selected={step === 'running'}
        class:active={step === 'running'}
        onclick={() => { step = 'running'; }}
      >
        ⏱️ Live
        {#if activeTimerCount}<span class="live-count">{activeTimerCount}</span>{/if}
      </button>
    </div>
  </div>

  <!-- STEP 1: ACTIVITY CAROUSEL (1 card at a time, swipe or arrows) -->
  {#if step === 'activity'}
    <div
      class="carousel-stage"
      role="region"
      aria-label="Activity carousel"
      style={`--stage-color:${activeColor}`}
      onpointerdown={onPointerDown}
      onpointerup={onPointerUp}
    >
      <p class="stage-prompt">What are we doing?</p>

      <div class="carousel-row">
        <button type="button" class="nav-arrow" aria-label="Previous activity" onclick={() => cyclePreset(-1)}>‹</button>

        <div class="focus-card">
          <span class="focus-emoji" aria-hidden="true">{activeEmoji}</span>
          {#if currentPreset.id === 'custom'}
            <div class="custom-inline">
              <input
                class="custom-emoji-input"
                bind:value={customEmoji}
                maxlength="16"
                aria-label="Custom emoji"
              />
              <input
                class="custom-title-input"
                bind:value={customTitle}
                maxlength="60"
                placeholder="Activity name"
                aria-label="Custom activity name"
              />
            </div>
          {:else}
            <h2 class="focus-title">{activeTitle}</h2>
          {/if}
          <span class="card-counter">{presetIndex + 1} / {presetCount} · Swipe or tap arrows</span>
        </div>

        <button type="button" class="nav-arrow" aria-label="Next activity" onclick={() => cyclePreset(1)}>›</button>
      </div>

      <div class="dot-strip" role="group" aria-label="Jump to activity">
        {#each Object.values(presetList) as preset, idx (preset.id)}
          <button
            type="button"
            class="emoji-dot"
            class:chosen={presetIndex === idx}
            aria-label={preset.title}
            aria-pressed={presetIndex === idx}
            onclick={() => { presetIndex = idx; }}
          >{preset.emoji}</button>
        {/each}
      </div>

      <button
        type="button"
        class="big-action-btn"
        disabled={!activeTitle.trim()}
        onclick={() => { step = 'duration'; }}
      >
        Next: How many minutes? →
      </button>
    </div>

  <!-- STEP 2: DURATION CAROUSEL (1 time at a time, swipe or arrows, 1 tap to start) -->
  {:else if step === 'duration'}
    <div
      class="carousel-stage"
      role="region"
      aria-label="Duration carousel"
      style={`--stage-color:${activeColor}`}
      onpointerdown={onPointerDown}
      onpointerup={onPointerUp}
    >
      <button type="button" class="selected-activity-chip" onclick={() => { step = 'activity'; }}>
        <span>{activeEmoji} {activeTitle}</span>
        <small>Change</small>
      </button>

      <p class="stage-prompt">How many minutes?</p>

      <div class="carousel-row">
        <button type="button" class="nav-arrow" aria-label="Shorter time" onclick={() => cycleDuration(-1)}>‹</button>

        <div class="focus-card duration-focus-card">
          <div class="focus-duration">{timerDurationLabel(currentDuration)}</div>
          <span class="card-counter">Swipe or tap to pick · Max {MAX_TIMER_MINUTES} min</span>
        </div>

        <button type="button" class="nav-arrow" aria-label="Longer time" onclick={() => cycleDuration(1)}>›</button>
      </div>

      <div class="dot-strip" role="group" aria-label="Quick duration choices">
        {#each Object.values(durationList) as mins, idx (mins)}
          <button
            type="button"
            class="time-dot"
            class:chosen={durationIndex === idx}
            aria-pressed={durationIndex === idx}
            onclick={() => { durationIndex = idx; }}
          >{timerDurationLabel(mins)}</button>
        {/each}
      </div>

      {#if error}<p class="stage-error" role="alert">{error}</p>{/if}

      <button
        type="button"
        class="big-action-btn start-now-btn"
        disabled={busy || !activeTitle.trim()}
        onclick={() => startMinutes(currentDuration)}
      >
        {busy ? 'Starting…' : `Start ${timerDurationLabel(currentDuration)} timer! ▶`}
      </button>
    </div>

  <!-- STEP 3: LIVE RUNNING TIMERS CAROUSEL (1 card at a time, no vertical scroll) -->
  {:else}
    <div
      class="carousel-stage"
      role="region"
      aria-label="Live running timers carousel"
      style={`--stage-color:${currentRunningTimer?.color ?? activeColor}`}
      onpointerdown={onPointerDown}
      onpointerup={onPointerUp}
    >
      {#if !currentRunningTimer}
        <div class="focus-card empty-live-card">
          <span class="focus-emoji" aria-hidden="true">⏱️</span>
          <h2 class="focus-title">No timers running</h2>
          <p class="empty-copy">Pick an activity and time to start a shared family countdown!</p>
        </div>
        <button type="button" class="big-action-btn" onclick={() => { step = 'activity'; }}>
          ＋ Set a timer
        </button>
      {:else}
        <div class="carousel-row">
          <button
            type="button"
            class="nav-arrow"
            disabled={activeTimerCount <= 1}
            aria-label="Previous running timer"
            onclick={() => cycleRunning(-1)}
          >‹</button>

          <article class="focus-card live-timer-card">
            <div class="live-top">
              <span class="live-badge">{safeRunningIndex + 1} / {activeTimerCount}</span>
              {#if currentRunningTimer.canEdit}
                <div class="live-controls">
                  <button
                    type="button"
                    class="mini-extend"
                    disabled={busy}
                    onclick={() => addMinutes(currentRunningTimer, 5)}
                  >+5 min</button>
                  <button
                    type="button"
                    class="mini-remove"
                    disabled={busy}
                    aria-label={`Delete ${currentRunningTimer.title}`}
                    onclick={() => onremove(currentRunningTimer)}
                  >×</button>
                </div>
              {/if}
            </div>

            <div class="live-hero">
              <span class="live-emoji" aria-hidden="true">{currentRunningTimer.emoji}</span>
              <h2 class="focus-title">{currentRunningTimer.title}</h2>
            </div>

            <div class="live-countdown">
              {remainingText(currentRunningTimer.timing.remaining)}
              <small>left</small>
            </div>

            <div
              class="live-track"
              role="progressbar"
              aria-label={`${currentRunningTimer.title}: elapsed time`}
              aria-valuenow={Math.round(currentRunningTimer.timing.progress * 10) / 10}
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div class="live-fill" style={`width:${currentRunningTimer.timing.progress}%`}></div>
            </div>

            <span class="card-counter">
              {timerDurationLabel(timerTotalMinutes(currentRunningTimer))} timer · Started by {currentRunningTimer.createdBy.username}
            </span>
          </article>

          <button
            type="button"
            class="nav-arrow"
            disabled={activeTimerCount <= 1}
            aria-label="Next running timer"
            onclick={() => cycleRunning(1)}
          >›</button>
        </div>

        {#if error}<p class="stage-error" role="alert">{error}</p>{/if}

        <button type="button" class="big-action-btn secondary-stage-btn" onclick={() => { step = 'activity'; }}>
          ＋ Start another timer
        </button>
      {/if}
    </div>
  {/if}
</section>
<!-- eslint-enable functional/functional-parameters -->

<style>
  .game-timer-stage {
    height: calc(100dvh - 110px);
    max-height: 620px;
    min-height: 410px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 0 8px;
    user-select: none;
  }

  .stage-topbar {
    display: flex;
    justify-content: center;
  }
  .step-pills {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface);
    border: 1.5px solid var(--border);
    padding: 4px;
    border-radius: 999px;
    box-shadow: 0 4px 12px var(--shadow-soft);
  }
  .step-pills button {
    border: 0;
    background: none;
    padding: 7px 16px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 800;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .step-pills button.active {
    background: var(--pastel-pink);
    color: var(--ink);
  }
  .live-count {
    font-size: 10px;
    background: var(--pastel-green);
    color: var(--green-ink);
    padding: 1px 6px;
    border-radius: 999px;
  }

  .carousel-stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: color-mix(in srgb, var(--stage-color) 22%, var(--surface));
    border: 2px solid color-mix(in srgb, var(--stage-color) 85%, var(--border));
    border-radius: 32px;
    padding: 20px 18px;
    box-shadow: 0 12px 32px var(--shadow-soft);
    touch-action: pan-y;
  }

  .stage-prompt {
    font-size: 15px;
    font-weight: 800;
    color: var(--text-secondary);
    margin: 0;
  }

  .selected-activity-chip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    font-size: 13px;
    font-weight: 800;
  }
  .selected-activity-chip small {
    color: var(--rose-ink);
    font-size: 11px;
  }

  .carousel-row {
    width: 100%;
    max-width: 540px;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .nav-arrow {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1.5px solid var(--border);
    background: var(--surface);
    font-size: 26px;
    font-weight: 800;
    line-height: 1;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    box-shadow: 0 4px 12px var(--shadow-soft);
    transition: transform 0.12s ease;
  }
  .nav-arrow:hover:not(:disabled) {
    transform: scale(1.07);
    background: var(--surface-pink);
  }
  .nav-arrow:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .focus-card {
    flex: 1;
    min-width: 0;
    height: 100%;
    max-height: 250px;
    background: var(--surface);
    border: 2px solid var(--border);
    border-radius: 28px;
    padding: 20px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
    box-shadow: 0 8px 22px var(--shadow-soft);
  }

  .focus-emoji {
    font-size: 62px;
    line-height: 1;
  }
  .focus-title {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.6px;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .focus-duration {
    font-size: 52px;
    font-weight: 800;
    letter-spacing: -1.5px;
    line-height: 1;
    color: var(--ink);
  }
  .card-counter {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
  }

  .custom-inline {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 260px;
  }
  .custom-emoji-input {
    width: 52px;
    text-align: center;
    font-size: 20px;
    padding: 8px;
    border-radius: 12px;
    border: 1.5px solid var(--border-strong);
    background: var(--surface-soft);
  }
  .custom-title-input {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 800;
    padding: 9px 12px;
    border-radius: 12px;
    border: 1.5px solid var(--border-strong);
    background: var(--surface-soft);
    color: var(--ink);
  }

  .dot-strip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .emoji-dot {
    width: 38px;
    height: 38px;
    border-radius: 13px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    font-size: 18px;
    display: grid;
    place-items: center;
    transition: transform 0.12s ease;
  }
  .emoji-dot.chosen {
    border-color: var(--rose-ink);
    background: var(--pastel-pink);
    transform: scale(1.1);
  }

  .time-dot {
    padding: 7px 12px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    font-size: 12px;
    font-weight: 800;
    color: var(--text-secondary);
  }
  .time-dot.chosen {
    border-color: var(--rose-ink);
    background: var(--stage-color);
    color: var(--ink);
    transform: scale(1.06);
  }

  .big-action-btn {
    width: 100%;
    max-width: 380px;
    padding: 15px 22px;
    border-radius: 20px;
    border: 2px solid var(--primary-border);
    background: var(--primary);
    color: var(--ink);
    font-size: 15px;
    font-weight: 800;
    box-shadow: 0 6px 16px var(--shadow-soft);
    transition: transform 0.12s ease, background 0.15s ease;
  }
  .big-action-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    background: var(--primary-hover);
  }
  .start-now-btn {
    background: var(--stage-color);
    border-color: color-mix(in srgb, var(--stage-color) 70%, var(--ink));
  }
  .secondary-stage-btn {
    background: var(--surface);
    border-color: var(--border-strong);
  }

  .live-timer-card {
    justify-content: space-between;
    padding: 16px 18px;
  }
  .live-top {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .live-badge {
    font-size: 11px;
    font-weight: 800;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--surface-soft);
    border: 1px solid var(--border);
  }
  .live-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mini-extend {
    padding: 4px 10px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    background: var(--pastel-lemon);
    font-size: 11px;
    font-weight: 800;
  }
  .mini-remove {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 0;
    background: var(--surface-pink);
    color: var(--rose-ink);
    font-size: 18px;
    line-height: 1;
    display: grid;
    place-items: center;
  }
  .live-hero {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .live-emoji { font-size: 32px; line-height: 1; }
  .live-countdown {
    font-size: 36px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: -1px;
    line-height: 1;
  }
  .live-countdown small {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-muted);
    margin-left: 4px;
  }
  .live-track {
    width: 100%;
    height: 22px;
    border-radius: 999px;
    background: var(--surface-soft);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .live-fill {
    height: 100%;
    background: var(--stage-color);
    transition: width 1s linear;
  }
  .empty-copy {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
  }
  .stage-error {
    font-size: 12px;
    color: var(--danger);
    margin: 0;
  }

  @media (max-width: 600px) {
    .game-timer-stage {
      height: calc(100dvh - 96px);
      padding: 8px 0;
    }
    .carousel-stage { padding: 14px 12px; border-radius: 26px; }
    .nav-arrow { width: 40px; height: 40px; font-size: 22px; }
    .focus-emoji { font-size: 48px; }
    .focus-title { font-size: 21px; }
    .focus-duration { font-size: 42px; }
    .live-countdown { font-size: 28px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .live-fill, .nav-arrow, .emoji-dot, .big-action-btn { transition: none; }
  }
</style>

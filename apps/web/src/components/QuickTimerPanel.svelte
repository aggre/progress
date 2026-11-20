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

  const firstPreset: Readonly<TimerPreset> = timerPresets[0] ?? { id: 'game', title: 'Game time', emoji: '🎮', color: palette[0] };
  let selectedPresetId = $state(firstPreset.id);
  let title = $state(firstPreset.title);
  let emoji = $state(firstPreset.emoji);
  let color = $state(firstPreset.color);
  let customMinutes = $state(20);
  let showCompleted = $state(false);
  let error = $state('');

  const timerRows: Readonly<Record<number, TimedSchedule>> = $derived(
    Object.fromEntries(Object.values(events).filter(isQuickTimer).entries()),
  );
  const activeTimers: Readonly<Record<number, TimedSchedule>> = $derived(
    Object.fromEntries(Object.values(timerRows).filter((e: TimedSchedule) => !e.timing.complete).entries()),
  );
  const completedCount = $derived(
    Object.values(timerRows).filter((e: TimedSchedule) => e.timing.complete).length,
  );
  const visibleTimers: Readonly<Record<number, TimedSchedule>> = $derived(
    Object.fromEntries(
      Object.values(timerRows)
        .filter((e: TimedSchedule) => showCompleted || !e.timing.complete)
        .sort((a: TimedSchedule, b: TimedSchedule) => a.timing.end - b.timing.end)
        .entries(),
    ),
  );

  function selectPreset(preset: Readonly<TimerPreset>) {
    selectedPresetId = preset.id;
    title = preset.title;
    emoji = preset.emoji;
    color = preset.color;
    error = '';
  }

  function startMinutes(minutes: number) {
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore duplicate clicks while a schedule write is already in flight.
    if (busy) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
    const built = buildQuickTimer({ title, emoji, color, minutes, timeZone: zone }, Date.now());
    // eslint-disable-next-line functional/no-conditional-statements -- Show validation feedback inline before issuing an API write.
    if ('error' in built) {
      error = built.error;
      return;
    }
    error = '';
    oncreate(built, `${built.emoji} ${built.title} (${timerDurationLabel(minutes)}) started!`);
  }

  // eslint-disable-next-line functional/prefer-immutable-types -- Handle the custom-minutes form submission and trigger the timer start callback.
  function submitCustom(event: SubmitEvent) {
    event.preventDefault();
    startMinutes(Number(customMinutes));
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

<section class="timer-screen" aria-labelledby="timer-heading">
  <div class="timer-header">
    <div>
      <p class="eyebrow">QUICK FAMILY TIMER</p>
      <h1 id="timer-heading">What are we doing,<br class="mobile-break" /> and for how long<span class="heading-dot">?</span></h1>
      <p class="subtitle">Pick an activity, then tap a time to start right away. Everyone in your family will see the countdown.</p>
    </div>
  </div>

  <div class="composer-card" style={`--chosen-color:${color}`}>
    <div class="step-block">
      <div class="step-title">
        <span class="step-badge">1</span>
        <h2>What are we doing?</h2>
      </div>
      <!-- eslint-disable functional/functional-parameters -- Preset buttons update the current activity selection in the browser view. -->
      <div class="preset-grid" role="group" aria-label="Choose an activity">
        {#each Object.values(timerPresets) as preset (preset.id)}
          <button
            type="button"
            class="preset-tile"
            class:chosen={selectedPresetId === preset.id && title === preset.title && emoji === preset.emoji}
            style={`--preset-color:${preset.color}`}
            aria-pressed={selectedPresetId === preset.id && title === preset.title && emoji === preset.emoji}
            disabled={busy}
            onclick={() => selectPreset(preset)}
          >
            <span class="preset-emoji" aria-hidden="true">{preset.emoji}</span>
            <span class="preset-name">{preset.title}</span>
          </button>
        {/each}
      </div>
      <!-- eslint-enable functional/functional-parameters -->

      <div class="custom-activity">
        <label class="emoji-field">
          <span>Icon</span>
          <input
            class="emoji-input"
            bind:value={emoji}
            maxlength="16"
            required
            aria-label="Timer emoji"
            disabled={busy}
          />
        </label>
        <label class="title-field">
          <span>Or type your own activity</span>
          <input
            bind:value={title}
            maxlength="100"
            required
            placeholder="Game time, Piano, Clean up…"
            aria-label="Activity name"
            disabled={busy}
          />
        </label>
        <!-- eslint-disable functional/functional-parameters -- Color swatch buttons update the selected bar color. -->
        <div class="mini-swatches" role="group" aria-label="Timer color">
          {#each Object.values(palette) as swatch (swatch)}
            <button
              type="button"
              class="swatch"
              class:selected={color === swatch}
              style={`--swatch:${swatch}`}
              aria-label={`Use color ${swatch}`}
              aria-pressed={color === swatch}
              disabled={busy}
              onclick={() => { color = swatch; }}
            >{color === swatch ? '✓' : ''}</button>
          {/each}
        </div>
        <!-- eslint-enable functional/functional-parameters -->
      </div>
    </div>

    <div class="step-divider"></div>

    <div class="step-block">
      <div class="step-title">
        <span class="step-badge">2</span>
        <h2>How many minutes? <span class="ready-pill">{emoji} {title || 'Timer'}</span></h2>
      </div>
      <p class="step-hint">Tap a button below to start the timer immediately!</p>

      <!-- eslint-disable functional/functional-parameters -- Duration buttons start a shared family timer immediately on tap. -->
      <div class="duration-grid" role="group" aria-label="Start timer with preset duration">
        {#each Object.values(timerDurations) as mins (mins)}
          <button
            type="button"
            class="duration-button"
            disabled={busy || !title.trim()}
            onclick={() => { void startMinutes(mins); }}
          >
            <span class="duration-main">{timerDurationLabel(mins)}</span>
            <span class="duration-sub">Start now →</span>
          </button>
        {/each}
      </div>
      <!-- eslint-enable functional/functional-parameters -->

      <form class="custom-duration" onsubmit={submitCustom}>
        <label>
          <span>Custom time (1–{MAX_TIMER_MINUTES} min)</span>
          <div class="custom-duration-controls">
            <input
              type="number"
              min="1"
              max={MAX_TIMER_MINUTES}
              step="1"
              bind:value={customMinutes}
              required
              disabled={busy}
              aria-label="Custom minutes"
            />
            <span class="unit-label">min</span>
            <button type="submit" class="secondary-start" disabled={busy || !title.trim()}>
              {busy ? 'Starting…' : `Start ${timerDurationLabel(Number(customMinutes) || 1)}`}
            </button>
          </div>
        </label>
      </form>

      {#if error}
        <p class="form-error" role="alert">{error}</p>
      {/if}
    </div>
  </div>

  <div class="running-section">
    <div class="running-header">
      <h3>
        Running timers
        <span class="count-pill">{Object.values(activeTimers).length}</span>
      </h3>
      {#if completedCount > 0}
        <label class="completed-toggle">
          <input type="checkbox" bind:checked={showCompleted} />
          <span>Show finished ({completedCount})</span>
        </label>
      {/if}
    </div>

    {#if !Object.values(visibleTimers).length}
      <div class="empty-timers">
        <span class="empty-icon" aria-hidden="true">⏱️</span>
        <h4>No timers running right now.</h4>
        <p>Pick an activity above and tap <strong>5 min</strong>, <strong>10 min</strong>, <strong>30 min</strong>, or <strong>1 hr</strong> to begin!</p>
      </div>
    {:else}
      <div class="timer-list">
        {#each Object.values(visibleTimers) as item (item.id)}
          <article
            class="timer-card"
            class:is-complete={item.timing.complete}
            style={`--timer-color:${item.color}`}
          >
            <div class="timer-card-top">
              <div class="timer-identity">
                <span class="timer-emoji" aria-hidden="true">{item.emoji}</span>
                <div>
                  <h4>{item.title}</h4>
                  <span class="timer-meta">
                    {timerDurationLabel(timerTotalMinutes(item))} timer · Started by {item.createdBy.username}
                  </span>
                </div>
              </div>
              <!-- eslint-disable functional/functional-parameters -- Timer action buttons extend or delete the selected timer. -->
              <div class="timer-actions">
                {#if item.canEdit}
                  <button
                    type="button"
                    class="extend-button"
                    disabled={busy}
                    aria-label={`Add 5 minutes to ${item.title}`}
                    onclick={() => { void addMinutes(item, 5); }}
                  >+5 min</button>
                  <button
                    type="button"
                    class="remove-button"
                    disabled={busy}
                    aria-label={`Delete ${item.title} timer`}
                    title="Delete timer"
                    onclick={() => onremove(item)}
                  >×</button>
                {/if}
              </div>
              <!-- eslint-enable functional/functional-parameters -->
            </div>

            <div
              class="progress-track"
              role="progressbar"
              aria-label={`${item.title}: elapsed time`}
              aria-valuenow={Math.round(item.timing.progress * 10) / 10}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuetext={`${remainingText(item.timing.remaining)} remaining`}
            >
              <div class="progress-fill" style={`width:${item.timing.progress}%`}></div>
            </div>

            <div class="timer-card-bottom">
              <span class="progress-label">
                {item.timing.complete ? 'Finished!' : `${Math.round(item.timing.progress)}% done`}
              </span>
              <strong class="countdown-text" class:done-text={item.timing.complete}>
                {item.timing.complete ? 'Time’s up! 🎉' : `${remainingText(item.timing.remaining)} left`}
              </strong>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .timer-screen { padding-top: 24px; }
  .eyebrow { font-size: 10px; letter-spacing: 2px; font-weight: 700; color: var(--rose-ink); margin: 0 0 10px; }
  h1 { font-size: 32px; line-height: 1.15; font-weight: 800; letter-spacing: -0.9px; margin: 0; }
  .heading-dot { color: var(--rose-ink); }
  .mobile-break { display: none; }
  .subtitle { color: var(--text-muted); font-size: 13px; line-height: 1.6; margin: 10px 0 0; }

  .composer-card {
    margin-top: 22px;
    background: var(--surface);
    border: 2px solid color-mix(in srgb, var(--chosen-color) 70%, var(--border));
    border-radius: 24px;
    padding: 26px;
    box-shadow: 0 10px 30px var(--shadow-soft);
  }
  .step-block { display: flex; flex-direction: column; gap: 16px; }
  .step-divider { height: 1px; background: var(--border); margin: 24px 0; }
  .step-title { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .step-badge {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--pastel-pink);
    color: var(--ink);
    font-weight: 800;
    font-size: 14px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .step-title h2 { font-size: 20px; font-weight: 800; letter-spacing: -0.4px; margin: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ready-pill {
    font-size: 13px;
    font-weight: 700;
    background: color-mix(in srgb, var(--chosen-color) 45%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--chosen-color) 80%, var(--border-strong));
    padding: 4px 12px;
    border-radius: 999px;
  }
  .step-hint { font-size: 12px; color: var(--text-muted); margin: -6px 0 0; }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(135px, 1fr));
    gap: 10px;
  }
  .preset-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px 12px;
    border-radius: 18px;
    border: 2px solid var(--border);
    background: color-mix(in srgb, var(--preset-color) 22%, var(--surface));
    transition: transform 0.12s ease, border-color 0.15s ease, background 0.15s ease;
    text-align: center;
  }
  .preset-tile:hover {
    transform: translateY(-2px);
    background: color-mix(in srgb, var(--preset-color) 45%, var(--surface));
  }
  .preset-tile.chosen {
    border-color: var(--rose-ink);
    background: color-mix(in srgb, var(--preset-color) 65%, var(--surface));
    box-shadow: 0 4px 14px var(--shadow-soft);
  }
  .preset-emoji { font-size: 30px; line-height: 1; }
  .preset-name { font-size: 13px; font-weight: 800; color: var(--ink); }

  .custom-activity {
    display: grid;
    grid-template-columns: 74px 1fr auto;
    gap: 12px;
    align-items: end;
    background: var(--surface-soft);
    padding: 14px;
    border-radius: 16px;
  }
  .custom-activity label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
  }
  .custom-activity input {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 11px;
    padding: 10px 12px;
    font-size: 14px;
    font-weight: 700;
    color: var(--ink);
    width: 100%;
  }
  .emoji-input { text-align: center; font-size: 20px !important; padding: 7px !important; }
  .mini-swatches { display: flex; align-items: center; gap: 7px; padding-bottom: 6px; flex-wrap: wrap; }
  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--swatch) 60%, var(--ink));
    background: var(--swatch);
    font-size: 12px;
    font-weight: 800;
    display: grid;
    place-items: center;
    padding: 0;
  }
  .swatch.selected { outline: 2px solid var(--rose-ink); outline-offset: 2px; }

  .duration-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }
  .duration-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 18px 14px;
    border-radius: 18px;
    border: 2px solid color-mix(in srgb, var(--chosen-color) 85%, var(--border-strong));
    background: color-mix(in srgb, var(--chosen-color) 55%, var(--surface));
    transition: transform 0.12s ease, background 0.15s ease;
  }
  .duration-button:hover:not(:disabled) {
    transform: translateY(-2px);
    background: var(--chosen-color);
  }
  .duration-main { font-size: 24px; font-weight: 800; letter-spacing: -0.6px; color: var(--ink); }
  .duration-sub { font-size: 11px; font-weight: 700; color: var(--text-secondary); }

  .custom-duration {
    background: var(--surface-soft);
    padding: 12px 14px;
    border-radius: 14px;
  }
  .custom-duration label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-muted);
  }
  .custom-duration-controls { display: flex; align-items: center; gap: 8px; }
  .custom-duration-controls input {
    width: 82px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 14px;
    font-weight: 800;
    color: var(--ink);
  }
  .unit-label { font-size: 12px; color: var(--text-muted); }
  .secondary-start {
    border: 1px solid var(--primary-border);
    background: var(--primary);
    color: var(--ink);
    border-radius: 11px;
    padding: 9px 14px;
    font-size: 12px;
    font-weight: 800;
  }
  .secondary-start:hover:not(:disabled) { background: var(--primary-hover); }

  .form-error {
    font-size: 12px;
    color: var(--danger);
    background: var(--danger-soft);
    border: 1px solid var(--danger-border);
    padding: 11px 14px;
    border-radius: 10px;
    margin: 0;
  }

  .running-section { margin-top: 32px; }
  .running-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .running-header h3 {
    font-size: 20px;
    font-weight: 800;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .count-pill {
    font-size: 12px;
    background: var(--pastel-green);
    color: var(--green-ink);
    padding: 2px 9px;
    border-radius: 999px;
  }
  .completed-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .completed-toggle input { accent-color: var(--rose-ink); }

  .empty-timers {
    text-align: center;
    padding: 38px 20px;
    border: 1px dashed var(--border-strong);
    border-radius: 20px;
    background: var(--surface);
  }
  .empty-icon { font-size: 32px; }
  .empty-timers h4 { font-size: 18px; font-weight: 800; margin: 10px 0 6px; }
  .empty-timers p { font-size: 13px; color: var(--text-muted); margin: 0; }

  .timer-list { display: flex; flex-direction: column; gap: 18px; }
  .timer-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 18px 20px;
    box-shadow: 0 4px 16px var(--shadow-soft);
  }
  .timer-card.is-complete { opacity: 0.8; }
  .timer-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .timer-identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .timer-emoji { font-size: 28px; line-height: 1; flex-shrink: 0; }
  .timer-identity h4 { font-size: 19px; font-weight: 800; margin: 0; overflow-wrap: anywhere; }
  .timer-meta { font-size: 11px; color: var(--text-muted); display: block; margin-top: 2px; }
  .timer-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .extend-button {
    border: 1px solid var(--border-strong);
    background: var(--surface-soft);
    border-radius: 10px;
    padding: 6px 11px;
    font-size: 12px;
    font-weight: 800;
    color: var(--ink);
  }
  .extend-button:hover:not(:disabled) { background: var(--pastel-lemon); }
  .remove-button {
    width: 36px;
    height: 36px;
    border: 0;
    background: none;
    color: var(--text-muted);
    font-size: 22px;
    border-radius: 10px;
    display: grid;
    place-items: center;
  }
  .remove-button:hover:not(:disabled) { background: var(--surface-pink); color: var(--rose-ink); }

  .progress-track {
    width: 100%;
    height: 38px;
    background: color-mix(in srgb, var(--border) 35%, var(--surface));
    border-radius: 10px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--timer-color);
    transition: width 1s linear;
  }
  .timer-card-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
  }
  .progress-label { font-size: 12px; color: var(--text-muted); font-weight: 700; }
  .countdown-text {
    font-size: 20px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.3px;
  }
  .done-text { color: var(--green-ink); }

  @media (max-width: 720px) {
    h1 { font-size: 26px; }
    .mobile-break { display: block; }
    .composer-card { padding: 18px; }
    .custom-activity { grid-template-columns: 64px 1fr; }
    .mini-swatches { grid-column: 1 / -1; padding-bottom: 0; }
    .preset-grid { grid-template-columns: repeat(auto-fill, minmax(105px, 1fr)); }
    .duration-grid { grid-template-columns: repeat(3, 1fr); }
    .duration-main { font-size: 20px; }
  }
  @media (max-width: 440px) {
    .duration-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (prefers-reduced-motion: reduce) {
    .progress-fill, .preset-tile, .duration-button { transition: none; }
  }
</style>

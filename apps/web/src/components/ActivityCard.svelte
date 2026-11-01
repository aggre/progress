<script lang="ts">
  import type { ScheduleRecord } from '@little/shared/api';
  import { activityPhase, type ActivityPlan } from '@little/shared/activity';
  import { remainingText } from '@little/shared/events';

  let { event, plan, now, onremove }: { event: ScheduleRecord; plan: ActivityPlan; now: number; onremove: (event: ScheduleRecord) => void } = $props();
  const phase = $derived(activityPhase(event.title, event.startAt, plan, now));
</script>

<article id={`activity-${event.id}`} tabindex="-1" class="activity-card" class:complete={phase.stage === 'complete'} aria-label={`${event.title} activity plan`}>
  <div class="card-top">
    <div class="current" role="status" aria-live="polite" aria-atomic="true">
      <span class="symbol" aria-hidden="true">{phase.stage === 'complete' ? '🌟' : phase.stage === 'after' ? '🧹' : '🎉'}</span>
      <h3>{phase.stage === 'complete' ? `${event.title} · All done!` : phase.title}</h3>
    </div>
    <!-- eslint-disable-next-line functional/functional-parameters -- Open the dashboard's deletion confirmation for this complete activity plan. -->
    {#if event.canEdit}<button class="remove" aria-label={`Delete ${event.title} activity`} onclick={() => onremove(event)}>×</button>{/if}
  </div>
  <div class="progress" role="progressbar" aria-label={`${phase.title}: elapsed time`} aria-valuenow={Math.round(phase.progress)} aria-valuemin="0" aria-valuemax="100" aria-valuetext={`${remainingText(phase.remaining)} remaining`}><div style={`width:${phase.progress}%`}></div></div>
  <div class="card-bottom">
    <details class="plan-details">
      <summary>{phase.stage === 'complete' ? 'Completed plan' : phase.stage === 'play' && plan.afterTask ? `Up next: ${plan.afterTask.title}` : phase.stage === 'after' ? 'Final step' : 'Play time'}</summary>
      <ol class="steps" aria-label="Activity steps">
        <li class:active={phase.stage === 'play'} class:done={phase.stage !== 'play'} aria-current={phase.stage === 'play' ? 'step' : undefined}><span class="step-icon" aria-hidden="true">{phase.stage === 'play' ? '1' : '✓'}</span><span class="step-name">{event.title}</span><span class="minutes">{plan.playMinutes} min</span></li>
        {#if plan.afterTask}<li class:active={phase.stage === 'after'} class:done={phase.stage === 'complete'} aria-current={phase.stage === 'after' ? 'step' : undefined}><span class="step-icon" aria-hidden="true">{phase.stage === 'complete' ? '✓' : '2'}</span><span class="step-name">{plan.afterTask.title}</span><span class="minutes">{plan.afterTask.minutes} min</span></li>{/if}
      </ol>
      <p>Started by {event.createdBy.username}</p>
    </details>
    <div class="countdown"><strong>{phase.stage === 'complete' ? 'All done!' : `${remainingText(phase.remaining)} left`}</strong></div>
  </div>
</article>

<style>
  .activity-card{min-width:0}
  .card-top{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:44px;margin-bottom:6px}
  .current{display:flex;align-items:baseline;gap:10px;min-width:0}
  .symbol{flex-shrink:0;font-size:25px;line-height:1}
  h3{font-size:20px;line-height:1.4;font-weight:800;letter-spacing:-.2px;margin:0;overflow-wrap:anywhere}
  .remove{width:44px;height:44px;flex-shrink:0;border:0;background:none;color:var(--text-muted);font-size:23px;padding:0;border-radius:10px}
  .remove:hover{background:var(--surface-pink);color:var(--rose-ink)}
  .progress{width:100%;height:44px;background:color-mix(in srgb,var(--border) 30%,var(--surface));border-radius:7px;overflow:hidden}
  .progress>div{height:100%;background:var(--pastel-green);transition:width 1s linear}
  .card-bottom{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-top:5px}
  .countdown{text-align:right;max-width:65%;padding-top:3px}
  .countdown strong{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.2px}
  .plan-details{flex:1;min-width:0;font-size:11px;line-height:1.6;color:var(--text-muted)}
  .plan-details summary{width:fit-content;max-width:100%;padding:4px 0;cursor:pointer;overflow-wrap:anywhere}
  .plan-details p{margin:8px 0 0;overflow-wrap:anywhere}
  .steps{list-style:none;display:flex;flex-direction:column;gap:6px;padding:0;margin:8px 0 0}
  .steps li{display:flex;align-items:baseline;gap:8px;min-width:0}
  .steps li.active{color:var(--green-ink);font-weight:800}
  .steps li.done{color:var(--text-muted)}
  .step-icon{flex-shrink:0}
  .step-name{overflow-wrap:anywhere;flex:1}
  .minutes{white-space:nowrap}
  .complete{opacity:.75}
  @media(max-width:680px){.symbol{font-size:23px}h3{font-size:18px}.progress{height:40px}}
  @media(prefers-reduced-motion:reduce){.progress>div{transition:none}}
</style>

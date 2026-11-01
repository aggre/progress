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
      <div><p class="eyebrow">{phase.stage === 'complete' ? 'ALL DONE' : phase.stage === 'after' ? 'TIME FOR THE NEXT STEP' : 'LET’S PLAY'}</p><h3>{phase.stage === 'complete' ? `${event.title} · All done!` : phase.title}</h3></div>
    </div>
    <div class="actions"><div class="countdown"><strong>{phase.stage === 'complete' ? '✓' : remainingText(phase.remaining)}</strong><span>{phase.stage === 'complete' ? 'Nicely done.' : 'left in this step'}</span></div>
      <!-- eslint-disable-next-line functional/functional-parameters -- Open the dashboard's deletion confirmation for this complete activity plan. -->
      {#if event.canEdit}<button class="remove" aria-label={`Delete ${event.title} activity`} onclick={() => onremove(event)}>×</button>{/if}
    </div>
  </div>
  <ol class="steps" aria-label="Activity steps">
    <li class:active={phase.stage === 'play'} class:done={phase.stage !== 'play'} aria-current={phase.stage === 'play' ? 'step' : undefined}><span class="step-icon" aria-hidden="true">{phase.stage === 'play' ? '1' : '✓'}</span><span class="step-name">{event.title}</span><span class="minutes">{plan.playMinutes} min</span></li>
    {#if plan.afterTask}<li class:active={phase.stage === 'after'} class:done={phase.stage === 'complete'} aria-current={phase.stage === 'after' ? 'step' : undefined}><span class="step-icon" aria-hidden="true">{phase.stage === 'complete' ? '✓' : '2'}</span><span class="step-name">{plan.afterTask.title}</span><span class="minutes">{plan.afterTask.minutes} min</span></li>{/if}
  </ol>
  <div class="progress" role="progressbar" aria-label={`${phase.title}: elapsed time`} aria-valuenow={Math.round(phase.progress)} aria-valuemin="0" aria-valuemax="100" aria-valuetext={`${remainingText(phase.remaining)} remaining`}><div style={`width:${phase.progress}%`}></div></div>
  <p class="caption">{phase.stage === 'complete' ? 'A little play, a little progress.' : phase.stage === 'play' && plan.afterTask ? `Up next: ${plan.afterTask.title}` : phase.stage === 'after' ? 'One last little step.' : 'Enjoy your playtime.'}<span>Started by {event.createdBy.username}</span></p>
</article>

<style>
  .activity-card{padding:23px 25px 16px;border:1px solid var(--border);background:var(--surface);border-radius:10px}.card-top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.current{display:flex;align-items:center;gap:13px;min-width:0}.symbol{display:grid;place-items:center;flex-shrink:0;width:43px;height:43px;border:1px solid #dce6ca;border-radius:11px;background:#eff3e6;font-size:23px}.eyebrow{font-size:8px;letter-spacing:1.4px;color:#84996e;margin:0 0 8px}h3{font-size:17px;font-weight:500;margin:0;overflow-wrap:anywhere}.actions{display:flex;gap:12px;align-items:center;flex-shrink:0}.countdown{display:flex;flex-direction:column;gap:6px;text-align:right}.countdown strong{font-weight:500;font-size:18px;font-variant-numeric:tabular-nums}.countdown>span{font-size:9px;color:var(--text-muted)}.remove{border:0;background:none;color:#91a17e;font-size:23px;padding:4px}.steps{list-style:none;display:flex;gap:9px;padding:0;margin:0 0 15px}.steps li{flex:1;min-width:0;display:flex;align-items:center;gap:8px;border:1px solid var(--border);background:var(--surface-soft);color:var(--text-muted);padding:10px 12px;border-radius:7px;font-size:11px}.steps li.active{border-color:#cad9b4;background:var(--surface-green);color:var(--green-ink)}.steps li.done{color:#819967}.step-icon{font-size:9px;border:1px solid #d6e1c9;border-radius:50%;width:18px;height:18px;display:grid;place-items:center;flex-shrink:0}.step-name{overflow-wrap:anywhere;flex:1}.minutes{font-size:10px;white-space:nowrap}.progress{height:12px;background:#eaf0df;border-radius:5px;overflow:hidden}.progress>div{height:100%;background:var(--pastel-green);border-radius:5px}.caption{font-size:10px;line-height:1.6;color:var(--text-muted);margin:11px 0 0;display:flex;justify-content:space-between;gap:10px;overflow-wrap:anywhere}.caption>span{color:#9bA18e;font-size:9px}.complete{opacity:.8}@media(max-width:680px){.activity-card{padding:17px 15px 14px}.card-top{gap:10px}.current{gap:9px}.symbol{width:35px;height:35px;font-size:20px}h3{font-size:15px}.eyebrow{font-size:7px;letter-spacing:1px}.actions{gap:5px}.countdown strong{font-size:14px}.countdown>span{font-size:8px}.steps{flex-direction:column;gap:6px}.steps li{padding:9px 10px}.caption{flex-wrap:wrap}.remove{padding:2px}}
</style>

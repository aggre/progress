<script lang="ts">
  import type { ActivityPlan } from '@little/shared/activity';
  import { onMount } from 'svelte';
  import { angleDelta, coast, normalizeAngle, releaseVelocity, winningIndex, MAX_SPIN_SPEED, STOP_SPIN_SPEED, type SpinSample } from '@little/shared/roulette';

  let { title, options, plan, busy, onstart }: { title: string; options: Readonly<ArrayLike<string>>; plan: ActivityPlan; busy: boolean; onstart: (index: number, requestId: string) => void } = $props();
  let rotation = $state(0);
  let velocity = $state(0);
  let dragging = $state(false);
  let spinning = $state(false);
  let result = $state<number | null>(null);
  let requestId = '';
  let pointer: number | null = null;
  let lastAngle = 0;
  let draggedAngle = 0;
  let samples: Readonly<ArrayLike<SpinSample>> = [];
  let frame = 0;
  let lastFrame = 0;
  let reducedMotion = false;
  const colors: Readonly<ArrayLike<string>> = ['#dbe7b8', '#f2d4b6', '#d3e6de', '#e5d8eb', '#f0e3ac', '#d1e0ec'];
  const speed = $derived(Math.min(100, Math.abs(velocity) / MAX_SPIN_SPEED * 100));

  function point(degrees: number, radius: number): Readonly<{ x: number; y: number }> {
    return { x: 160 + Math.sin(degrees * Math.PI / 180) * radius, y: 160 - Math.cos(degrees * Math.PI / 180) * radius };
  }
  function segment(index: number): string {
    const start = point(index * 360 / options.length, 154), end = point((index + 1) * 360 / options.length, 154);
    return `M160 160 L${start.x} ${start.y} A154 154 0 0 1 ${end.x} ${end.y} Z`;
  }
  // eslint-disable-next-line functional/functional-parameters -- Complete the browser animation and announce its selected segment.
  function finish() {
    cancelAnimationFrame(frame); velocity = 0; spinning = false;
    result = winningIndex(rotation, options.length); requestId = crypto.randomUUID();
  }
  function animate(time: number) {
    const next = coast(rotation, velocity, Math.min((time - lastFrame) / 1000, 0.064));
    lastFrame = time; rotation = next.rotation; velocity = next.velocity;
    return Math.abs(velocity) < STOP_SPIN_SPEED ? finish() : (frame = requestAnimationFrame(animate));
  }
  function launch(speed: number) {
    cancelAnimationFrame(frame); result = null; velocity = speed;
    spinning = Math.abs(speed) >= STOP_SPIN_SPEED;
    lastFrame = performance.now();
    return spinning ? (frame = requestAnimationFrame(animate)) : finish();
  }
  // eslint-disable-next-line functional/functional-parameters -- The Spin button provides a keyboard and reduced-motion alternative to dragging.
  function spin() {
    return dragging || busy ? undefined : reducedMotion
      ? (rotation = Math.random() * 360, finish())
      : launch(650 + Math.random() * 600);
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Measure the wheel's native DOM bounds for this pointer event.
  function pointerAngle(event: PointerEvent & { currentTarget: EventTarget & HTMLButtonElement }): number | null {
    const bounds: Readonly<DOMRectReadOnly> = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2, y = event.clientY - bounds.top - bounds.height / 2;
    return Math.hypot(x, y) < 20 ? null : Math.atan2(y, x) * 180 / Math.PI;
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Capture one native pointer so a finger can drag beyond the wheel's bounds.
  function grab(event: PointerEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    const angle = pointerAngle(event);
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore secondary fingers, mouse buttons, and the unstable center of the wheel at the DOM boundary.
    if (busy || !event.isPrimary || event.button !== 0 || pointer !== null || angle === null) return;
    cancelAnimationFrame(frame); pointer = event.pointerId; dragging = true; spinning = false; result = null; velocity = 0;
    lastAngle = angle; draggedAngle = 0; samples = [{ angle: 0, time: event.timeStamp }];
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Translate native pointer movement into wheel rotation and recent release samples.
  function drag(event: PointerEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    const angle = pointerAngle(event);
    // eslint-disable-next-line functional/no-conditional-statements -- Only the captured pointer may change the active browser gesture.
    if (pointer !== event.pointerId || angle === null) return;
    const delta = angleDelta(lastAngle, angle);
    lastAngle = angle; draggedAngle += delta; rotation = normalizeAngle(rotation + delta);
    samples = [...Array.from(samples).filter(sample => event.timeStamp - sample.time <= 100), { angle: draggedAngle, time: event.timeStamp }];
    velocity = releaseVelocity(samples, event.timeStamp);
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Release native pointer capture and preserve the finger's recent angular speed.
  function release(event: PointerEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore releases from unrelated pointers or an already released capture.
    if (pointer !== event.pointerId) return;
    pointer = null; dragging = false;
    const cancelled = event.type !== 'pointerup';
    launch(cancelled ? 0 : releaseVelocity(samples, event.timeStamp));
    return event.currentTarget.hasPointerCapture(event.pointerId) ? event.currentTarget.releasePointerCapture(event.pointerId) : undefined;
  }
  onMount(() => {
    // eslint-disable-next-line functional/prefer-immutable-types -- Track the browser media-query handle and unregister its listener on teardown.
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = preference.matches;
    // eslint-disable-next-line functional/functional-parameters -- Respond to changes in the native media query.
    const update = () => { reducedMotion = preference.matches; };
    preference.addEventListener('change', update);
    // eslint-disable-next-line functional/functional-parameters -- Cancel the animation and browser listener during component teardown.
    return () => { cancelAnimationFrame(frame); preference.removeEventListener('change', update); };
  });
</script>

<div class="wheel-area" class:has-result={result !== null}>
  <div class="wheel-wrap">
    <span class="pointer" aria-hidden="true">▼</span>
    <!-- eslint-disable-next-line functional/prefer-immutable-types -- Pointer and keyboard handlers receive native mutable browser events. -->
    <button type="button" class="wheel" class:dragging disabled={busy} aria-label={`Spin ${title} roulette`} aria-describedby="wheel-help" onpointerdown={grab} onpointermove={drag} onpointerup={release} onpointercancel={release} onlostpointercapture={release} onclick={event => event.detail === 0 ? spin() : undefined}>
      <svg viewBox="0 0 320 320" aria-hidden="true" style={`transform:rotate(${rotation}deg)`}>
        {#each options as option, index (index)}
          {@const mid = (index + 0.5) * 360 / options.length}
          {@const label = point(mid, 99)}
          <path d={segment(index)} fill={colors[index % colors.length]} stroke="#fffefa" stroke-width="2" />
          <text x={label.x} y={label.y} transform={`rotate(${mid - 90},${label.x},${label.y})`} text-anchor="middle" dominant-baseline="middle" font-size={options.length > 12 ? 10 : 12}>{Array.from(option).slice(0, 11).join('')}{Array.from(option).length > 11 ? '…' : ''}</text>
        {/each}
        <circle cx="160" cy="160" r="25" fill="#fffefa" stroke="#d9dfcc" />
        <circle cx="160" cy="160" r="6" fill="#7f9665" />
      </svg>
    </button>
  </div>
  <p id="wheel-help">Flick the wheel to spin. Grab it again to speed up, slow down, or reverse.</p>
  <div class="speed" aria-hidden="true"><span>GENTLE</span><div><i style={`width:${speed}%`}></i></div><span>FAST</span></div>
  {#if result === null}<button type="button" class="spin-button" disabled={dragging || busy} onclick={spin}>{spinning ? 'Give it another spin ↻' : 'Spin the wheel ↻'}</button>{/if}
  <div class="result" role="status" aria-live="polite" aria-atomic="true">
    {#if result !== null}<span>THE WHEEL CHOSE</span><strong>{options[result]}</strong>
    {:else}<p>{dragging ? 'You set the pace.' : spinning ? 'A little suspense…' : 'What will it be?'}</p>{/if}
  </div>
  {#if result !== null}
    <div class="plan" aria-label="Your activity plan">
      <div><span>🎉 Play time</span><strong>{plan.playMinutes} min</strong></div>
      {#if plan.afterTask}<span class="step-arrow" aria-hidden="true">↓</span><div><span>🧹 {plan.afterTask.title}</span><strong>{plan.afterTask.minutes} min</strong></div>{/if}
    </div>
    <!-- eslint-disable-next-line functional/functional-parameters -- Start the displayed plan with a stable ID that is reused if the HTTP request needs a retry. -->
    <button type="button" class="spin-button start-plan" disabled={busy} onclick={() => onstart(result!, requestId)}>{busy ? 'Starting…' : 'Start this plan'}</button>
    <button type="button" class="use-result" disabled={busy} onclick={spin}>Spin again ↻</button>
  {/if}
  <details><summary>All {options.length} choices</summary><ol>{#each options as option, index (index)}<li>{option}</li>{/each}</ol></details>
</div>

<style>
  .has-result .wheel-wrap{width:220px}.has-result #wheel-help,.has-result .speed{display:none}.plan{max-width:290px;margin:8px auto 18px;padding:14px 17px;background:var(--surface-green);border:1px solid #e0e6d3;border-radius:10px;text-align:left}.plan>div{display:flex;justify-content:space-between;gap:14px;align-items:center;font-size:12px;line-height:1.5}.plan>div>span{overflow-wrap:anywhere;min-width:0}.plan strong{font-size:11px;font-weight:500;white-space:nowrap;color:#74865f}.step-arrow{display:block;padding:4px 0;color:#8fa575}.start-plan{display:block;margin:auto;width:min(100%,290px)}

  .wheel-area{text-align:center}.wheel-wrap{position:relative;width:min(100%,330px);margin:18px auto 0;padding:10px}.pointer{position:absolute;top:-4px;left:50%;transform:translateX(-50%);color:#536840;font-size:29px;z-index:1;line-height:1;text-shadow:0 2px 0 var(--surface)}.wheel{display:block;width:100%;padding:0;background:none;border:0;border-radius:50%;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}.wheel.dragging{cursor:grabbing}.wheel svg{display:block;width:100%;filter:drop-shadow(0 5px 3px #394c2014);will-change:transform}.wheel text{fill:#435039;font-family:var(--font-rounded);font-weight:600}.wheel-area>p{font-size:11px;line-height:1.7;color:var(--text-muted);max-width:300px;margin:12px auto}.speed{display:flex;align-items:center;gap:10px;width:220px;max-width:100%;margin:16px auto;font-size:8px;letter-spacing:1px;color:#899379}.speed>div{height:5px;background:#e9eddf;flex:1;overflow:hidden;border-radius:5px}.speed i{height:100%;display:block;background:#8da56b;border-radius:5px}.spin-button{border:1px solid var(--primary-border);background:var(--primary);color:var(--ink);border-radius:8px;padding:12px 24px;font-size:12px;min-width:190px}.result{min-height:76px;display:flex;flex-direction:column;justify-content:center;gap:10px;margin:13px 0 0}.result>span{font-size:8px;letter-spacing:1.8px;color:#7a8c63}.result strong{font-family:var(--font-rounded);font-size:26px;font-weight:400;overflow-wrap:anywhere}.result p{font-size:12px;color:#8c947e;font-style:italic}.use-result{background:none;border:0;padding:10px;font-size:11px;color:#627b49}details{text-align:left;border-top:1px solid #e3e7d8;margin-top:17px;padding-top:14px;font-size:11px;color:#79876a}summary{cursor:pointer}ol{display:grid;grid-template-columns:1fr 1fr;gap:10px 25px;padding-left:20px;line-height:1.6}li{overflow-wrap:anywhere}
  @media(max-width:500px){.wheel-wrap{width:270px;max-width:100%;margin-top:12px}.wheel-area>p{margin:8px auto}.speed{margin:12px auto}.result{min-height:66px;margin-top:7px}.result strong{font-size:23px}}
</style>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { sort as sortRows, sortBy } from 'ramda';
  import { cycle, remainingText, repeatLabel, palette, units, shift, toLocal, fromLocal, starterEvents, type EventInput, type RepeatUnit } from '@little/shared/events';
  import { isQuickTimer, timerDurationLabel, timerTotalMinutes } from '@little/shared/timer';

  import type { Identity, ScheduleRecord } from '@little/shared/api';
  import { api, BASE_PATH } from '../lib/api';
  import SettingsPanel from './SettingsPanel.svelte';
  import ActivityCard from './ActivityCard.svelte';
  import RouletteLibrary from './RouletteLibrary.svelte';
  import QuickTimerPanel from './QuickTimerPanel.svelte';
  type EventRow = Readonly<ScheduleRecord & { timing: ReturnType<typeof cycle> }>;
  type FeaturePage = 'home' | 'timer' | 'progress' | 'roulette';
  let { identity, onlogout, onfamily }: { identity: Identity; onlogout: () => void; onfamily: () => void } = $props();

  let activePage = $state<FeaturePage>('home');
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte owns this reactive collection proxy; API loads and edits replace its current browser state.
  let events = $state<ScheduleRecord[]>([]);
  let now = $state(Date.now());
  let loading = $state(true);
  let error = $state('');
  let filter = $state('all');
  let query = $state('');
  let sort = $state('custom');
  let showCompleted = $state(false);
  let settingsOpen = $state(false);
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte binds the mutable native event editor dialog at the DOM boundary.
  let dialog: HTMLDialogElement;
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte binds the mutable native input used to focus the event editor.
  let nameInput = $state<HTMLInputElement>();
  let editing = $state<Readonly<ScheduleRecord> | null>(null);
  let editorKind = $state<'countdown' | 'roulette'>('countdown');
  let editorOpen = $state(false);
  let saving = $state(false);
  let formError = $state('');
  let title = $state('');
  let emoji = $state('✨');
  let color = $state(palette[0]);
  let repeatUnit = $state<RepeatUnit>('none');
  let repeatEvery = $state(1);
  let zone = $state('Asia/Tokyo');
  let targetLocal = $state('');
  let deleteEvent = $state<Readonly<ScheduleRecord> | null>(null);
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte binds the mutable native confirmation dialog at the DOM boundary.
  let deleteDialog: HTMLDialogElement;
  let toast = $state('');
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native timer handle so the browser toast can be cancelled.
  let toastTimer: ReturnType<typeof setTimeout>;
  let seeding = $state(false);
  const emojis: Readonly<Record<number, string>> = Object.fromEntries(['✨','🎯','🌿','☀️','🌙','🎉','🎂','✈️','📚','💻','🏃','☕','❤️','☘️','⏱️','🏖️'].entries());
  const timeZones: Readonly<Record<number, string>> = Object.fromEntries([...new Set(['Asia/Tokyo', Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC', ...Intl.supportedValuesOf('timeZone')])].entries());
  const rows: Readonly<Record<number, EventRow>> = $derived(Object.fromEntries(events.map((e:Readonly<ScheduleRecord>): EventRow=>({...e, timing:cycle(e,now)})).entries()));
  const completed = $derived(Object.values(rows).filter(e=>e.timing.complete).length);
  const active: Readonly<Record<number, EventRow>> = $derived(Object.fromEntries(Object.values(rows).filter(e=>!e.timing.complete).entries()));
  const activeTimers: Readonly<Record<number, EventRow>> = $derived(Object.fromEntries(Object.values(active).filter(isQuickTimer).entries()));
  const activeActivities: Readonly<Record<number, EventRow>> = $derived(Object.fromEntries(Object.values(active).filter(e=>Boolean(e.activity)).entries()));
  const activeCountdowns: Readonly<Record<number, EventRow>> = $derived(Object.fromEntries(Object.values(active).filter(e=>!isQuickTimer(e) && !e.activity).entries()));
  const repeatingCount = $derived(events.filter((e:Readonly<ScheduleRecord>)=>e.repeatUnit !== 'none').length);
  const visible: Readonly<Record<number, EventRow>> = $derived.by((): Readonly<Record<number, EventRow>>=>{
    const list: Readonly<Record<number, EventRow>> = Object.fromEntries(Object.values(rows).filter(e=>(showCompleted || !e.timing.complete) && (filter === 'all' || (filter === 'timers' ? isQuickTimer(e) : filter === 'repeating' ? e.repeatUnit !== 'none' : e.repeatUnit === 'none')) && `${e.title} ${e.activity?.afterTask?.title ?? ''}`.toLowerCase().includes(query.toLowerCase())).entries());
    return Object.fromEntries((sort === 'soonest' ? sortBy((event: EventRow)=>event.timing.end,Object.values(list))
      : sort === 'name' ? sortRows((a: EventRow,b: EventRow)=>a.title.localeCompare(b.title),Object.values(list))
      : Object.values(list)).entries());
  });
  const next = $derived(sortBy((event: EventRow)=>event.timing.end,Object.values(active))[0]);
  const clockDate = $derived(new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'Asia/Tokyo'}).format(now));
  const clockTime = $derived(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Tokyo'}).format(now));
  function dateLabel(value: number, timeZone: string) { return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone}).format(value); }
  function notify(message: string) { toast=message; clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast='',4000); }
  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Load schedules for the current browser session through the API. This browser dialog or API operation returns its native completion Promise.
  async function load() {
    error='';
    // eslint-disable-next-line functional/no-try-statements -- Handle schedule API failures and always clear the browser loading state.
    try { events=(await api<{ events: ScheduleRecord[] }>('/api/schedules')).events; } catch(e) { error=e instanceof Error ? e.message : 'Unable to load events.'; }
    finally { loading=false; }
  }
  onMount(()=>{
    void load();
    // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native interval handle for component cleanup.
    const timer = setInterval(()=>now=Date.now(),1000);
    // eslint-disable-next-line functional/functional-parameters -- Refresh browser time and schedules when the window gains focus.
    const focus = ()=>{ now=Date.now(); void (!dialog?.open && !deleteDialog?.open && !saving && !seeding && load()); };
    window.addEventListener('focus',focus);
    // eslint-disable-next-line functional/functional-parameters -- Component cleanup cancels browser timers and removes the window listener.
    return ()=>{clearInterval(timer);clearTimeout(toastTimer);window.removeEventListener('focus',focus);};
  });
  // eslint-disable-next-line functional/prefer-immutable-types -- This browser dialog or API operation returns its native completion Promise.
  async function openEditor(event: Readonly<ScheduleRecord> | null=null, kind: 'countdown' | 'roulette'='countdown') {
    return event && (!event.canEdit || event.activity) ? undefined : (
      editing=event, editorKind=kind, editorOpen=true, formError='', saving=false,
      zone=event?.timeZone || 'Asia/Tokyo',
      title=event?.title || '', emoji=event?.emoji || '✨', color=event?.color || palette[events.length % Object.values(palette).length],
      repeatUnit=event?.repeatUnit || 'none', repeatEvery=event?.repeatEvery || 1,
      targetLocal=toLocal(event?.targetAt || new Date(Date.now()+86400000*7).toISOString(),zone),
      dialog.showModal(), await tick(), kind === 'countdown' ? nameInput?.focus() : undefined
    );
  }
  // eslint-disable-next-line functional/functional-parameters -- Svelte calls this parameterless two-way binding getter to read the current reactive repeat selection.
  function getRepeatChoice(): RepeatUnit | 'two-weeks' {
    return repeatUnit === 'week' && repeatEvery === 2 ? 'two-weeks' : repeatUnit;
  }
  function setRepeatChoice(choice: RepeatUnit | 'two-weeks') {
    repeatEvery = choice === 'two-weeks' ? 2 : getRepeatChoice() === 'two-weeks' ? 1 : repeatEvery;
    repeatUnit = choice === 'two-weeks' ? 'week' : choice;
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Create a quick timer schedule through the API and update the reactive schedule list.
  async function createQuickTimer(input: Readonly<EventInput>, message: string) {
    // eslint-disable-next-line functional/no-conditional-statements -- Avoid duplicate API writes while another save operation is in flight.
    if (saving) return;
    saving = true; error = '';
    // eslint-disable-next-line functional/no-try-statements -- Surface API failures without losing the user's current timer draft.
    try {
      const result = await api<Readonly<{ event: Readonly<ScheduleRecord> }>>('/api/schedules', 'POST', input);
      events = [...events, result.event];
      now = Date.now();
      notify(message);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to start timer.';
    } finally {
      saving = false;
    }
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Update an existing quick timer schedule through the API and replace it in the reactive schedule list.
  async function updateQuickTimer(id: string, input: Readonly<EventInput>, message: string) {
    // eslint-disable-next-line functional/no-conditional-statements -- Avoid duplicate API writes while another save operation is in flight.
    if (saving) return;
    saving = true; error = '';
    // eslint-disable-next-line functional/no-try-statements -- Surface API failures without discarding the current timer list.
    try {
      const result = await api<Readonly<{ event: Readonly<ScheduleRecord> }>>(`/api/schedules/${id}`, 'PUT', input);
      events = events.map((e: Readonly<ScheduleRecord>) => e.id === id ? result.event : e);
      now = Date.now();
      notify(message);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to update timer.';
    } finally {
      saving = false;
    }
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- This browser dialog or API operation returns its native completion Promise.
  async function save(
    // eslint-disable-next-line functional/prefer-immutable-types -- Prevent native form submission before sending the edited schedule through the API.
    event: SubmitEvent,
  ) {
    event.preventDefault();
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore duplicate native form submissions while the current browser save request is in flight.
    if (saving) return;
    saving=true;formError='';
    // eslint-disable-next-line functional/no-try-statements -- Handle event API failures and restore the browser saving state.
    try {
      const targetAt=fromLocal(targetLocal,zone);
      const startAt=repeatUnit === 'none' ? editing?.startAt ?? new Date().toISOString() : new Date(shift(targetAt,zone,repeatUnit,-repeatEvery)).toISOString();
      const input: Readonly<EventInput> = {title,emoji,color,targetAt,startAt,repeatUnit,repeatEvery,timeZone:zone};
      const result=await api<Readonly<{ event: Readonly<ScheduleRecord> }>>(`/api/schedules${editing ? '/'+editing.id : ''}`,editing ? 'PUT' : 'POST',input);
      events=editing ? events.map((e:Readonly<ScheduleRecord>)=>e.id===editing?.id ? result.event : e) : [...events,result.event];
      dialog.close();notify(editing ? 'Event updated.' : 'A little something to look forward to.');
    } catch(e) { formError=e instanceof Error ? e.message : 'Unable to save.'; } finally { saving=false; }
  }
  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Delete the currently selected schedule through the API and close its browser dialog. This browser API operation returns its native completion Promise.
  async function remove() {
    // eslint-disable-next-line functional/no-conditional-statements -- Dispatch deletion only for the current browser dialog selection while no save request is in flight.
    if (!deleteEvent || saving) return;
    saving=true; formError='';
    // eslint-disable-next-line functional/no-try-statements -- Handle deletion API failures and restore the browser saving state.
    try { await api('/api/schedules/'+deleteEvent.id,'DELETE');events=events.filter((e:Readonly<ScheduleRecord>)=>e.id!==deleteEvent?.id);deleteDialog.close();notify('Event deleted.'); }
    catch(e) {formError=e instanceof Error ? e.message : 'Unable to delete.';}finally{saving=false;}
  }
  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Create starter schedules through the API for the current browser session. This browser API operation returns its native completion Promise.
  async function seed() {
    seeding=true;error='';
    // eslint-disable-next-line functional/no-try-statements -- Handle starter event API failures and restore the browser seeding state.
    try {
      // eslint-disable-next-line functional/no-loop-statements -- Await each schedule creation and update the browser state before issuing the next HTTP request.
      for (const input of Object.values(starterEvents('Asia/Tokyo'))) { const result=await api<Readonly<{ event: Readonly<ScheduleRecord> }>>('/api/schedules','POST',input);events=[...events,result.event]; }
      notify('Your everyday countdowns are ready.');
    }
    catch(e){error=e instanceof Error ? e.message : 'Unable to add starter events.';}finally{seeding=false;}
  }
  // eslint-disable-next-line functional/functional-parameters -- Download the current browser schedules using a temporary DOM link.
  function exportEvents() {
    // eslint-disable-next-line functional/prefer-immutable-types -- The native Blob carries the browser download payload.
    const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),events},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    // eslint-disable-next-line functional/prefer-immutable-types -- The native anchor must be configured and clicked to download the export.
    const a=document.createElement('a');a.href=url;a.download='little-by-little-events.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function activityStarted(event: ScheduleRecord) {
    events = [...events.filter((item: Readonly<ScheduleRecord>) => item.id !== event.id), event];
    query = ''; filter = 'all'; now = Date.now(); void (dialog?.open && dialog.close()); notify('Your playtime has started.');
    void tick().then(() => document.getElementById(`activity-${event.id}`)?.focus());
  }
  function confirmDelete(e: Readonly<ScheduleRecord>) { deleteEvent=e;formError='';deleteDialog.showModal(); }
</script>

<div class="app-shell">
  <header class="topbar">
    <!-- eslint-disable-next-line functional/prefer-immutable-types -- Intercept the brand link click to return directly to the feature tile home screen. -->
    <a class="brand" href={BASE_PATH} aria-label="Little by little home" onclick={e => { e.preventDefault(); activePage = 'home'; }}><span class="brand-mark" aria-hidden="true">⌛</span><span>little by little<span class="brand-dot">.</span></span></a>
    <nav class="header-right" aria-label="Your space">
      {#if activePage !== 'home'}
        <!-- eslint-disable-next-line functional/functional-parameters -- Header pill returns directly to the home tile hub. -->
        <button type="button" class="home-pill" onclick={() => { activePage = 'home'; }}>← Home</button>
      {/if}
      <button class="family-button" onclick={onfamily}>Family</button>
      <!-- eslint-disable-next-line functional/functional-parameters -- Open settings without leaving the current event list or changing its filters. -->
      <button class="settings-button" aria-label="Settings" aria-haspopup="dialog" onclick={() => { settingsOpen = true; }}><svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="5" r="2"/><circle cx="13" cy="10" r="2"/><circle cx="7" cy="15" r="2"/></svg><span>Settings</span></button>
    </nav>
  </header>

  <main>
    {#if error}<div class="error-banner" role="alert"><span>{error}</span><button onclick={load}>Try again</button></div>{/if}

    {#if activePage === 'home'}
      <!-- eslint-disable functional/functional-parameters -- Home feature tiles open the selected feature screen. -->
      <section class="home-hub" aria-labelledby="hub-heading">
        <div class="hub-hero">
          <span class="family-tag">{identity.family.name}</span>
          <h1 id="hub-heading">What shall we do today<span class="heading-dot">?</span></h1>
        </div>

        <div class="tile-grid" role="navigation" aria-label="Choose a feature">
          <button type="button" class="feature-tile tile-timer" onclick={() => { activePage = 'timer'; }}>
            <span class="tile-bubble" aria-hidden="true">⏱️</span>
            <div class="tile-copy">
              <h2>Quick timer</h2>
              <p>5 min · 10 min · 30 min · 1 hr</p>
            </div>
            <span class="tile-pill" class:is-live={Object.values(activeTimers).length > 0}>
              {Object.values(activeTimers).length
                ? `${Object.values(activeTimers).length} running`
                : 'Start →'}
            </span>
          </button>

          <button type="button" class="feature-tile tile-progress" onclick={() => { activePage = 'progress'; }}>
            <span class="tile-bubble" aria-hidden="true">🌱</span>
            <div class="tile-copy">
              <h2>Progress</h2>
              <p>Countdowns & repeating days</p>
            </div>
            <span class="tile-pill">
              {loading
                ? '…'
                : Object.values(activeCountdowns).length
                  ? `${Object.values(activeCountdowns).length} upcoming`
                  : 'Open →'}
            </span>
          </button>

          <button type="button" class="feature-tile tile-roulette" onclick={() => { activePage = 'roulette'; }}>
            <span class="tile-bubble" aria-hidden="true">🎡</span>
            <div class="tile-copy">
              <h2>Roulette</h2>
              <p>Spin & pick what to play</p>
            </div>
            <span class="tile-pill" class:is-live={Object.values(activeActivities).length > 0}>
              {Object.values(activeActivities).length
                ? `${Object.values(activeActivities).length} playing`
                : 'Spin →'}
            </span>
          </button>
        </div>

        {#if Object.values(activeTimers)[0]}
          {@const liveTimer = Object.values(activeTimers)[0]}
          <button type="button" class="live-dock" style={`--dock-color:${liveTimer.color}`} onclick={() => { activePage = 'timer'; }}>
            <div class="dock-left">
              <span class="pulse-dot" aria-hidden="true"></span>
              <span class="dock-emoji" aria-hidden="true">{liveTimer.emoji}</span>
              <strong>{liveTimer.title}</strong>
              <span class="timer-pill">{timerDurationLabel(timerTotalMinutes(liveTimer))}</span>
            </div>
            <div class="dock-right">
              <span class="dock-remaining">{remainingText(liveTimer.timing.remaining)} left</span>
              <span class="dock-arrow" aria-hidden="true">→</span>
            </div>
          </button>
        {:else if Object.values(activeActivities)[0]}
          {@const liveAct = Object.values(activeActivities)[0]}
          <button type="button" class="live-dock" style="--dock-color:var(--pastel-green)" onclick={() => { activePage = 'roulette'; }}>
            <div class="dock-left">
              <span class="pulse-dot" aria-hidden="true"></span>
              <span class="dock-emoji" aria-hidden="true">🎉</span>
              <strong>{liveAct.title}</strong>
            </div>
            <div class="dock-right">
              <span class="dock-remaining">{remainingText(liveAct.timing.remaining)} left</span>
              <span class="dock-arrow" aria-hidden="true">→</span>
            </div>
          </button>
        {:else}
          <div class="quiet-dock">
            <span aria-hidden="true">✳</span>
            <span>Tap a tile above to begin</span>
          </div>
        {/if}
      </section>
      <!-- eslint-enable functional/functional-parameters -->
    {:else if activePage === 'timer'}
      <QuickTimerPanel
        events={rows}
        busy={saving}
        oncreate={(input: Readonly<EventInput>, label: string) => { void createQuickTimer(input, label); }}
        onupdate={(id: string, input: Readonly<EventInput>, label: string) => { void updateQuickTimer(id, input, label); }}
        onremove={confirmDelete}
      />
    {:else if activePage === 'roulette'}
      <section class="roulette-page" aria-labelledby="roulette-page-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">SPIN & PLAY TOGETHER</p>
            <h1 id="roulette-page-heading">Family roulettes<span class="heading-dot">.</span></h1>
            <p class="event-summary">Spin a wheel of fun ideas and start a shared playtime plan.</p>
          </div>
        </div>
        <div class="roulette-surface">
          <RouletteLibrary onbusy={(value: boolean) => { saving = value; }} onstarted={activityStarted} />
        </div>
        {#if Object.values(activeActivities).length}
          <div class="active-playtime">
            <h2>Active playtime plans</h2>
            <div class="event-list">
              {#each Object.values(activeActivities) as item (item.id)}
                {#if item.activity}
                  <ActivityCard event={item} plan={item.activity} {now} onremove={confirmDelete} />
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {:else}
      <section class="events-section" aria-labelledby="events-heading">
  <!-- eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Open the native event editor from the browser Add event button. The editor callback returns its native dialog completion Promise. -->
        <div class="section-heading"><div><h1 id="events-heading">Your time,<br class="mobile-break"/> in progress<span class="heading-dot">.</span></h1><p class="event-summary" aria-label="Schedule overview">{#if loading}Your family’s shared moments{:else}<span><strong>{Object.values(active).length}</strong> upcoming</span><span class="summary-dot" aria-hidden="true">·</span><span><strong>{repeatingCount}</strong> repeating</span>{/if}</p></div><div class="add-actions"><button class="secondary" onclick={()=>{ activePage = 'timer'; }}>⏱️ Quick timer</button><button class="secondary" onclick={()=>openEditor(null, 'roulette')}>Family roulettes ↻</button><button class="primary add-button" onclick={()=>openEditor()}><span aria-hidden="true">＋</span> Add event</button></div></div>
  <!-- eslint-disable-next-line functional/functional-parameters -- Browser filter buttons update the currently selected event-list tab. -->
        <div class="toolbar"><div class="tabs" aria-label="Filter events"><button class:chosen={filter==='all'} onclick={()=>filter='all'} aria-pressed={filter==='all'}>All events <span>{events.length}</span></button><button class:chosen={filter==='timers'} onclick={()=>filter='timers'} aria-pressed={filter==='timers'}>Timers</button><button class:chosen={filter==='repeating'} onclick={()=>filter='repeating'} aria-pressed={filter==='repeating'}>Repeating</button><button class:chosen={filter==='once'} onclick={()=>filter='once'} aria-pressed={filter==='once'}>One-time</button></div><div class="list-tools"><label class="search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input aria-label="Search events" placeholder="Find an event" bind:value={query}/></label><select aria-label="Sort events" bind:value={sort}><option value="custom">Date added</option><option value="soonest">Soonest first</option><option value="name">Name A–Z</option></select></div></div>
        {#if loading}<div class="loading-state"><span class="loading-ring"></span> Gathering your moments…</div>
  <!-- eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Open the native event editor from the empty-state browser button. The editor callback returns its native dialog completion Promise. -->
        {:else if !events.length && !error}<div class="empty-state"><span class="empty-emoji">🌱</span><h3>Something to look forward to.</h3><p>Your next adventure, a birthday, or simply a fresh day.<br/>Give your first countdown a little space.</p><button class="primary" onclick={()=>openEditor()}>＋ Create your first event</button><button class="text-button" disabled={seeding} onclick={seed}>{seeding ? 'Adding your countdowns…' : 'Or start with 6 everyday countdowns ↗'}</button></div>
  <!-- eslint-disable-next-line functional/functional-parameters -- Reset browser search and filter controls from the Show all events button. -->
        {:else if !Object.values(visible).length && !error}<div class="empty-state"><span class="empty-emoji">🔎</span><h3>No moments here, just yet.</h3><p>Try another search or filter, or add something new.</p><button class="text-button" onclick={()=>{query='';filter='all';showCompleted=true;}}>Show all events</button></div>
        {:else}<div class="event-list">{#each Object.values(visible) as e (e.id)}
          {#if e.activity}<ActivityCard event={e} plan={e.activity} {now} onremove={confirmDelete} />{:else}
          <article class="event-card" class:is-complete={e.timing.complete} style={`--event-color:${e.color}`}>
  <!-- eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Open the native editor for the schedule selected with its browser edit button. The editor callback returns its native dialog completion Promise. -->
            <div class="event-top"><div class="event-identity"><span class="event-emoji" aria-hidden="true">{e.emoji}</span><h3>{e.title}</h3>{#if isQuickTimer(e)}<span class="timer-pill">{timerDurationLabel(timerTotalMinutes(e))}</span>{/if}</div>{#if e.canEdit}<button class="edit-button" aria-label={`Edit ${e.title}`} title="Edit event" onclick={()=>openEditor(e)}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12.5 4.5 3 3M3.5 16.5l3.7-.7L16 7a2.1 2.1 0 0 0-3-3L4.2 12.8l-.7 3.7Z"/></svg></button>{/if}</div>
            <div class="progress-track" role="progressbar" aria-label={`${e.title}: elapsed time`} aria-valuenow={Math.round(e.timing.progress*10)/10} aria-valuemin="0" aria-valuemax="100" aria-valuetext={`${e.timing.progress.toFixed(1)} percent elapsed; ${remainingText(e.timing.remaining)} remaining`}><div class="progress-fill" style={`width:${e.timing.progress}%`}></div></div>
            <div class="event-bottom">
              <details class="event-details"><summary>{isQuickTimer(e) ? `Quick timer (${timerDurationLabel(timerTotalMinutes(e))})` : repeatLabel(e)}</summary><p>{dateLabel(e.timing.end,e.timeZone)} · {e.timeZone}</p><p>Added by {e.createdBy.username}</p><p>{e.timing.progress.toFixed(1)}% elapsed</p></details>
              <div class="event-countdown"><strong>{e.timing.complete ? 'Arrived' : `${remainingText(e.timing.remaining)} left`}</strong>{#if e.timing.upcoming}<span>Starts later</span>{/if}</div>
            </div>
          </article>
          {/if}
        {/each}</div>{/if}
        <div class="list-footer"><label class="completed-toggle"><input type="checkbox" bind:checked={showCompleted}/><span>Show completed{completed ? ` (${completed})` : ''}</span></label><span>{Object.values(visible).length} {Object.values(visible).length===1 ? 'event' : 'events'}<span class="footer-separator">·</span>Updated every second</span></div>
      </section>
    {/if}
    {#if activePage === 'progress' || activePage === 'roulette'}
      <div class="closing-note"><span aria-hidden="true">✳</span><p>{next ? 'There’s always something to look forward to.' : 'A little space for the things that matter.'}</p><span class="note-line"></span></div>
    {/if}
  </main>
  {#if activePage === 'progress' || activePage === 'roulette'}
    <footer class="site-footer"><span>little by little<span class="brand-dot">.</span></span><span>Good things take time.</span></footer>
  {/if}
</div>

{#if settingsOpen}
  <!-- eslint-disable-next-line functional/functional-parameters -- Dismiss the settings dialog while preserving the dashboard's current state. -->
  <SettingsPanel {identity} eventCount={events.length} {clockDate} {clockTime} onclose={() => { settingsOpen = false; }} onexport={exportEvents} {onlogout} />
{/if}

<!-- eslint-disable-next-line functional/prefer-immutable-types, functional/functional-parameters -- Read the native cancel Event to prevent closing the browser editor while saving. -->
<dialog bind:this={dialog} class="event-dialog" aria-labelledby="editor-heading" onclose={() => editorOpen = false} oncancel={e=>saving ? e.preventDefault() : undefined}>
  <!-- eslint-disable-next-line functional/functional-parameters -- Close the native event editor from its browser close button. -->
    <div class="dialog-heading"><div><p class="eyebrow">MAKE TIME FOR IT</p><h2 id="editor-heading">{editing ? 'Edit your moment.' : editorKind === 'roulette' ? 'Leave it to a little spin.' : 'A new little countdown.'}</h2></div><button type="button" class="close-button" aria-label="Close editor" disabled={saving} onclick={()=>dialog.close()}>×</button></div>
    {#if !editing}
      <!-- eslint-disable functional/functional-parameters -- Type selector buttons update the native event dialog view. -->
      <div class="event-kind" aria-label="What would you like to add?">
        <button type="button" class:chosen={editorKind === 'countdown'} aria-pressed={editorKind === 'countdown'} disabled={saving} onclick={() => editorKind = 'countdown'}>◷ Countdown</button>
        <button type="button" class:chosen={editorKind === 'roulette'} aria-pressed={editorKind === 'roulette'} disabled={saving} onclick={() => editorKind = 'roulette'}>↻ Roulette</button>
      </div>
      <!-- eslint-enable functional/functional-parameters -->
    {/if}
    {#if editorKind === 'roulette' && editorOpen}
      <RouletteLibrary onbusy={(value: boolean) => saving = value} onstarted={activityStarted} />
    {:else if editorKind === 'countdown'}
    <form onsubmit={save}>
    <div class="form-grid name-row"><label>Emoji<input class="emoji-input" bind:value={emoji} required maxlength="32" aria-label="Event emoji"/></label><label>Event name<input bind:this={nameInput} bind:value={title} placeholder="Something to look forward to" required maxlength="100"/></label></div>
  <!-- eslint-disable-next-line functional/functional-parameters -- Update the browser event editor emoji from its picker button. -->
    <div class="emoji-picker" aria-label="Choose an emoji">{#each Object.values(emojis) as item (item)}<button type="button" class:selected={emoji===item} aria-label={`Use ${item}`} aria-pressed={emoji===item} onclick={()=>emoji=item}>{item}</button>{/each}</div>
    <label class="field-label">Target date & time<input type="datetime-local" bind:value={targetLocal} required min="1900-01-01T00:00" max="2200-12-31T23:59"/></label>
    <div class="form-grid repeat-row"><label>Repeats<select aria-label="Repeats" bind:value={getRepeatChoice, setRepeatChoice}>{#each Object.values(units) as unit (unit)}<option value={unit}>{unit==='none' ? 'Does not repeat' : `Every ${unit}`}</option>{#if unit==='week'}<option value="two-weeks">Every 2 weeks</option>{/if}{/each}</select></label>{#if repeatUnit!=='none'}<label>Every<input type="number" bind:value={repeatEvery} min="1" max="1000" required aria-label="Repeat interval"/></label>{/if}</div>
    {#if repeatUnit!=='none'}<p class="field-hint">The bar fills from the previous occurrence to the next, then starts again. Month-end dates stay anchored.</p>{/if}
    <label class="field-label">Time zone<select aria-label="Time zone" bind:value={zone}>{#each Object.values(timeZones) as tz (tz)}<option value={tz}>{tz.replaceAll('_',' ')}</option>{/each}</select></label><p class="field-hint">Dates use this time zone. Daylight-saving changes follow the local clock.</p>
<!-- eslint-disable-next-line functional/functional-parameters -- Update the browser event editor color from its picker button. -->
    <fieldset class="color-field"><legend>Make it your color</legend><div class="color-picker">{#each Object.values(palette) as swatch (swatch)}<button type="button" class:color-selected={color===swatch} style={`--swatch:${swatch}`} aria-label={`Use color ${swatch}`} aria-pressed={color===swatch} onclick={()=>color=swatch}>{color===swatch ? '✓' : ''}</button>{/each}<label class="custom-color" title="Choose any color"><input type="color" bind:value={color} aria-label="Custom bar color"/><span>＋</span></label></div></fieldset>
    <div class="mini-preview"><span>{emoji} {title || 'Your next little moment'}</span><div style={`background:${color}`}></div></div>
    {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
<!-- eslint-disable-next-line functional/functional-parameters -- Browser dialog buttons open deletion confirmation or cancel editing. -->
    <div class="dialog-footer">{#if editing}<button type="button" class="danger-button" disabled={saving} onclick={()=>confirmDelete(editing!)}>Delete event</button>{:else}<span></span>{/if}<div><button type="button" class="secondary" disabled={saving} onclick={()=>dialog.close()}>Cancel</button><button class="primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create event'}</button></div></div>
  </form>
  {/if}
</dialog>
<!-- eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Browser confirmation buttons close the native dialogs or delete the selected schedule.  The cancel Event and deletion completion Promise belong to the native browser boundary. -->
<dialog bind:this={deleteDialog} class="delete-dialog" oncancel={e=>saving ? e.preventDefault() : undefined}><h2>Let this moment go?</h2><p>“{deleteEvent?.title}” will be permanently deleted.</p>{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}<div><button class="secondary" disabled={saving} onclick={()=>deleteDialog.close()}>Keep it</button><button class="delete-confirm" disabled={saving} onclick={async()=>{await remove();return !deleteDialog.open ? dialog.close() : undefined;}}>{saving ? 'Deleting…' : 'Delete event'}</button></div></dialog>
{#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}

<style>
  h1{font-size:34px;line-height:1.15;font-weight:800;letter-spacing:-1px;margin:0}
  .mobile-break{display:none}
  .event-summary{display:flex;flex-wrap:wrap;align-items:center;gap:9px}
  .event-summary strong{color:var(--green-ink);font-weight:800}
  .summary-dot{color:var(--border-strong)}
  .settings-button{display:flex;align-items:center;justify-content:center;gap:8px;min-width:40px;min-height:40px;border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:9px 13px;font-size:12px;font-weight:700}
  .settings-button:hover{background:var(--surface-pink)}
  .settings-button svg{flex-shrink:0}
  .settings-button circle{fill:var(--surface);stroke:currentColor;stroke-width:1.4}

  .app-shell{max-width:1280px;margin:auto;padding:0 64px}
  .topbar{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10;background:var(--canvas)}
  .brand{text-decoration:none;display:flex;align-items:center;gap:11px;font-weight:700;font-size:22px;letter-spacing:-.8px}
  .brand-mark{width:34px;height:38px;display:grid;place-items:center;background:var(--rainbow);border-radius:13px;font-size:21px;transform:rotate(-7deg)}
  .brand-dot{color:var(--rose-ink)}
  .header-right{display:flex;align-items:center;gap:10px}

  .home-pill{border:1px solid var(--primary-border);border-radius:12px;background:var(--surface-pink);padding:9px 14px;font-size:12px;font-weight:800;color:var(--rose-ink);min-height:40px}
  .home-pill:hover{background:var(--pastel-pink);color:var(--ink)}

  .home-hub{height:calc(100dvh - 84px);max-height:640px;min-height:410px;display:flex;flex-direction:column;justify-content:space-between;gap:14px;padding:16px 0 12px;user-select:none}
  .hub-hero{text-align:center}
  .family-tag{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.4px;padding:3px 12px;border-radius:999px;background:var(--surface-soft);border:1px solid var(--border);color:var(--text-secondary);margin-bottom:8px}
  .tile-grid{flex:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;max-width:920px;width:100%;margin:0 auto;align-content:center;min-height:0}
  .feature-tile{text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:14px;padding:24px 20px 20px;border-radius:28px;border:2px solid var(--border);background:var(--surface);box-shadow:0 8px 24px var(--shadow-soft);transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
  .feature-tile:hover{transform:translateY(-4px);box-shadow:0 14px 32px var(--shadow)}
  .tile-timer{background:var(--surface-pink);border-color:var(--pastel-pink)}
  .tile-timer:hover{border-color:var(--rose-ink)}
  .tile-progress{background:var(--surface-soft);border-color:var(--pastel-apricot)}
  .tile-progress:hover{border-color:var(--border-strong)}
  .tile-roulette{background:var(--surface-green);border-color:var(--pastel-green)}
  .tile-roulette:hover{border-color:var(--green-ink)}
  .tile-bubble{width:64px;height:64px;border-radius:22px;background:var(--surface);border:1.5px solid var(--border);display:grid;place-items:center;font-size:32px;box-shadow:0 6px 16px var(--shadow-soft);transition:transform .18s ease}
  .feature-tile:hover .tile-bubble{transform:scale(1.06) rotate(-5deg)}
  .tile-copy{display:flex;flex-direction:column;gap:4px}
  .feature-tile h2{font-size:22px;font-weight:800;letter-spacing:-.5px;margin:0}
  .tile-copy p{font-size:12px;font-weight:600;color:var(--text-muted);margin:0;line-height:1.4}
  .tile-pill{font-size:12px;font-weight:800;padding:6px 16px;border-radius:999px;background:var(--surface);border:1px solid var(--border);color:var(--ink)}
  .tile-pill.is-live{background:var(--pastel-green);border-color:var(--green-ink);color:var(--green-ink)}

  .live-dock{width:100%;max-width:560px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-radius:999px;background:var(--surface);border:2px solid color-mix(in srgb,var(--dock-color) 85%,var(--border));box-shadow:0 6px 18px var(--shadow-soft)}
  .live-dock:hover{background:var(--surface-soft)}
  .dock-left{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px}
  .dock-left strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dock-emoji{font-size:18px;line-height:1}
  .dock-right{display:flex;align-items:center;gap:8px;flex-shrink:0;font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}
  .dock-arrow{color:var(--rose-ink)}
  .quiet-dock{display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;font-weight:700;color:var(--text-muted);padding:8px 0}
  .quiet-dock>span:first-child{color:var(--rose-ink)}
  .pulse-dot{width:8px;height:8px;border-radius:50%;background:var(--green-ink);display:inline-block;flex-shrink:0}
  .timer-pill{font-size:11px;font-weight:800;background:var(--surface-soft);border:1px solid var(--border);padding:2px 8px;border-radius:999px;color:var(--text-secondary)}

  .roulette-page{padding-top:24px}
  .roulette-surface{background:var(--surface);border:1px solid var(--border);border-radius:24px;padding:24px;max-width:640px}
  .active-playtime{margin-top:32px}
  .active-playtime h2{font-size:20px;margin-bottom:14px}

  .eyebrow{font-size:10px;letter-spacing:2px;font-weight:600;color:var(--text-muted);display:flex;align-items:center;gap:8px;margin:0 0 12px}

  .events-section{padding-top:24px}
  .section-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:22px}
  h2{font-size:24px;font-weight:800;letter-spacing:-.7px;margin:0}
  .heading-dot{color:var(--rose-ink)}
  .section-heading p{color:var(--text-muted);font-size:12px;margin:9px 0 0}
  .primary{border:1px solid var(--primary-border);border-radius:14px;background:var(--primary);color:var(--ink);padding:12px 18px;font-size:12px;font-weight:800;transition:background .2s}
  .primary:hover{background:var(--primary-hover)}
  .add-button{display:flex;align-items:center;gap:9px;min-height:44px;flex-shrink:0;white-space:nowrap}
  .add-button>span{font-size:20px;line-height:.7;font-weight:700}
  .toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px}
  .tabs{display:flex;align-items:center;gap:4px;background:var(--surface-pink);padding:4px;border-radius:14px}
  .tabs button{background:none;border:0;padding:8px 12px;font-size:12px;white-space:nowrap;color:var(--text-muted);border-radius:10px;font-weight:700;min-height:36px}
  .tabs button.chosen{background:var(--pastel-pink);box-shadow:0 1px 3px var(--shadow-soft);color:var(--ink)}
  .tabs button>span{background:var(--surface);padding:2px 5px;border-radius:6px;font-size:9px;margin-left:4px}
  .list-tools{display:flex;gap:14px;align-items:center}
  .search{display:flex;align-items:center;gap:7px;color:var(--text-muted);background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:0 12px}
  .search svg{width:15px;fill:none;stroke:currentColor;stroke-width:1.2}
  .search input{border:0;background:none;font-size:12px;width:160px;outline-offset:3px;padding:8px 0;color:var(--ink);min-height:40px}
  .search input::placeholder{color:var(--text-muted)}
  .list-tools select{border:0;background:transparent;color:var(--text-muted);font-size:12px;padding:8px 2px;cursor:pointer;min-height:40px}
  .event-list{display:flex;flex-direction:column;gap:28px;margin-top:22px}
  .event-card{min-width:0}
  .event-top{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:44px;margin-bottom:6px}
  .event-identity{display:flex;gap:10px;align-items:baseline;min-width:0;flex-wrap:wrap}
  .event-emoji{flex-shrink:0;font-size:25px;line-height:1}
  .event-identity h3{font-size:20px;line-height:1.4;font-weight:800;letter-spacing:-.2px;margin:0;overflow-wrap:anywhere}
  .event-bottom{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-top:5px}
  .event-details{flex:1;min-width:0;font-size:11px;line-height:1.6;color:var(--text-muted)}
  .event-details summary{width:fit-content;max-width:100%;padding:4px 0;cursor:pointer;overflow-wrap:anywhere}
  .event-details p{margin:6px 0 0;overflow-wrap:anywhere}
  .event-countdown{text-align:right;display:flex;flex-direction:column;gap:3px;max-width:65%;padding-top:3px}
  .event-countdown strong{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.2px}
  .event-countdown>span{font-size:11px;color:var(--text-muted)}
  .edit-button{width:44px;height:44px;flex-shrink:0;display:grid;place-items:center;border:0;background:none;color:var(--text-muted);border-radius:10px}
  .edit-button:hover{background:var(--surface-pink);color:var(--rose-ink)}
  .edit-button svg{width:16px;stroke:currentColor;stroke-width:1.3}
  .progress-track{width:100%;height:44px;background:color-mix(in srgb,var(--border) 30%,var(--surface));border-radius:7px;overflow:hidden}
  .progress-fill{height:100%;min-width:0;background:var(--event-color);transition:width 1s linear}
  .is-complete{opacity:.75}
  .list-footer{display:flex;justify-content:space-between;align-items:center;color:var(--text-muted);font-size:10px;margin-top:23px}
  .completed-toggle{display:flex;gap:7px;align-items:center;cursor:pointer}
  .completed-toggle input{accent-color:var(--rose-ink);width:12px;height:12px;margin:0}
  .footer-separator{margin:0 10px;color:var(--text-muted)}
  .closing-note{display:flex;align-items:center;justify-content:center;gap:12px;padding:53px 0 47px;color:var(--text-muted)}
  .closing-note>span:first-child{color:var(--rose-ink);font-size:23px}
  .closing-note p{font-family:var(--font-rounded);font-size:13px;font-style:normal;margin:0}
  .note-line{width:34px;height:1px;background:var(--pastel-green)}
  .site-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;border-top:1px solid var(--border);padding:24px 0 29px;font-size:10px;color:var(--text-muted)}
  .site-footer>span{letter-spacing:.1px}

  .empty-state{text-align:center;padding:55px 20px;border:1px dashed var(--border);border-radius:22px;background:var(--surface)}
  .empty-emoji{font-size:34px}
  .empty-state h3{font-family:var(--font-rounded);font-size:25px;font-weight:700;margin:16px 0}
  .empty-state p{color:var(--text-muted);font-size:13px;line-height:1.8}
  .empty-state .primary{margin-top:12px}
  .text-button{display:block;margin:17px auto 0;border:0;background:none;color:var(--rose-ink);font-size:11px}
  .loading-state{min-height:220px;display:flex;gap:12px;align-items:center;justify-content:center;font-size:13px;color:var(--text-muted)}
  .loading-ring{height:20px;width:20px;border:2px solid var(--border);border-top-color:var(--rose-ink);border-radius:50%;animation:spin 1s linear infinite;border-color:var(--pastel-peach)}
  @keyframes spin{to{transform:rotate(360deg)}
  }
  .error-banner{padding:15px;border:1px solid var(--border);background:var(--danger-soft);color:var(--danger);font-size:13px;display:flex;align-items:center;justify-content:space-between;border-radius:7px;margin:16px 0 0;gap:15px;border-color:var(--danger-border)}
  .error-banner button{background:none;border:0;text-decoration:underline;color:inherit;white-space:nowrap}
  dialog{border:1px solid var(--border);border-radius:24px;color:var(--ink);background:var(--surface);padding:30px;width:min(540px,calc(100% - 30px));max-height:90dvh;box-shadow:0 20px 90px var(--shadow)}
  dialog::backdrop{background:var(--backdrop);backdrop-filter:blur(4px)}
  .dialog-heading{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
  .dialog-heading .eyebrow{font-size:8px;margin-bottom:10px;letter-spacing:1.6px}
  .dialog-heading h2{font-family:var(--font-rounded);font-size:26px;font-weight:700;letter-spacing:-.5px}
  .close-button{background:none;border:0;font-size:26px;line-height:1;color:var(--text-muted);padding:0 4px}
  .form-grid{display:grid;gap:14px}
  .name-row{grid-template-columns:65px 1fr}
  .form-grid label,.field-label{display:flex;flex-direction:column;gap:8px;font-size:11px;color:var(--text-muted)}
  .event-dialog input:not([type='color']),.event-dialog select{background:var(--surface-soft);border:1px solid var(--border);border-radius:11px;padding:11px 10px;color:var(--ink);min-width:0;width:100%;font-size:13px;border-color:var(--border-strong)}
  .event-dialog .emoji-input{text-align:center;font-size:20px!important;padding:6px!important}
  .emoji-picker{display:flex;gap:3px;flex-wrap:wrap;margin:11px 0 21px}
  .emoji-picker button{border:1px solid transparent;border-radius:4px;background:none;padding:3px;font-size:17px}
  .emoji-picker button.selected{border-color:var(--primary-border);background:var(--surface-pink)}
  .field-label{margin-top:16px}
  .repeat-row{grid-template-columns:1fr 90px;margin-top:16px}
  .repeat-row>label:only-child{grid-column:1/-1}
  .field-hint{font-size:10px;color:var(--text-muted);line-height:1.6;margin:9px 0 0}
  .color-field{border:0;padding:0;margin:21px 0 0}
  .color-field legend{font-size:11px;color:var(--text-muted);margin-bottom:12px}
  .color-picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .color-picker>button{width:25px;height:25px;border:1px solid color-mix(in srgb,var(--swatch) 65%,var(--ink));border-radius:50%;background:var(--swatch);color:var(--ink);font-size:14px;position:relative;font-weight:800}
  .color-picker>button.color-selected:before{content:'';position:absolute;inset:-4px;border:2px solid var(--rose-ink);border-radius:50%}
  .custom-color{position:relative;width:27px;height:27px;display:grid;place-items:center;background:var(--surface-soft);border:1px solid var(--border);border-radius:50%;font-size:17px;overflow:hidden;cursor:pointer}
  .custom-color input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
  .mini-preview{background:var(--surface-soft);border-radius:14px;padding:14px;margin-top:22px;font-size:11px;color:var(--text-muted)}
  .mini-preview>div{width:63%;height:8px;border-radius:999px;margin-top:11px;box-shadow:inset 0 0 0 1px var(--border-strong)}
  .dialog-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:25px}
  .dialog-footer>div{display:flex;gap:8px}
  .secondary{padding:11px 15px;border:1px solid var(--border);background:var(--surface);border-radius:12px;font-size:12px}
  .danger-button{background:none;border:0;padding:5px 0;font-size:10px;color:var(--danger)}
  .form-error{font-size:12px;color:var(--danger);background:var(--danger-soft);padding:11px;border-radius:5px;line-height:1.6}
  .delete-dialog h2{font-family:var(--font-rounded);font-weight:700;font-size:25px}
  .delete-dialog>p{font-size:13px;color:var(--text-muted);line-height:1.6;overflow-wrap:anywhere}
  .delete-dialog>div{display:flex;gap:10px;justify-content:flex-end;margin-top:25px}
  .delete-confirm{border:1px solid var(--border);background:var(--danger);color:white;font-size:12px;padding:11px 15px;border-radius:12px;border-color:var(--danger);font-weight:700}
  .toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);border:1px solid var(--border);border-radius:16px;box-shadow:0 6px 25px var(--shadow-soft);background:var(--surface);padding:15px 22px;font-size:12px;display:flex;align-items:center;gap:10px;max-width:calc(100% - 30px);z-index:20;border-color:var(--pastel-green)}
  .toast>span{color:var(--green-ink)}

  .family-button{border:1px solid var(--border);border-radius:12px;background:var(--pastel-green);padding:9px 14px;font-size:12px;color:var(--green-ink);border-color:var(--pastel-green);font-weight:700;min-height:40px}
  .family-button:hover{background:var(--pastel-lime)}

  @media(min-width:1500px){.app-shell{max-width:1220px}
  }
  @media(max-width:950px){.app-shell{padding:0 34px}
    .toolbar{gap:10px}
    .list-tools{gap:5px}
    .search input{width:85px}
  }

  @media(max-width:680px){
    .app-shell{padding:0 18px}
    .tile-grid{grid-template-columns:1fr;gap:10px}
    .feature-tile{flex-direction:row;text-align:left;padding:14px 16px;border-radius:22px;gap:14px}
    .tile-bubble{width:48px;height:48px;border-radius:16px;font-size:24px;flex-shrink:0}
    .tile-copy{flex:1;min-width:0}
    .feature-tile h2{font-size:18px}
    .tile-pill{flex-shrink:0;padding:5px 12px;font-size:11px}
    .brand-mark{width:28px;height:32px;font-size:17px}
    .eyebrow{font-size:8px;letter-spacing:1.7px;margin-bottom:12px}
    h2{font-size:19px;letter-spacing:-.6px}
    .toolbar{flex-wrap:wrap;gap:10px;margin-bottom:14px}
    .event-list{gap:24px;margin-top:18px}
    .event-emoji{font-size:23px}
    .event-identity h3{font-size:18px}
    .progress-track{height:40px}
    .list-footer{font-size:8px;gap:10px}
    .footer-separator{margin:0 6px}
    .completed-toggle{gap:5px;font-size:9px}
    .closing-note{gap:9px;padding:28px 0}
    .closing-note p{font-size:11px}
    .note-line{width:15px}
    .site-footer{font-size:9px;align-items:flex-start;padding:20px 0;gap:15px;line-height:1.7}
    .site-footer>span{max-width:145px}
    dialog{padding:23px 20px}
    .dialog-heading h2{font-size:24px}
    .dialog-footer{flex-wrap:wrap}
    .dialog-footer .primary{padding:11px 13px}
    .dialog-footer .secondary{padding:11px}
    .color-picker{gap:11px}
    .toast{font-size:11px;width:max-content;padding:13px 17px}
    .brand{font-size:18px;gap:8px}
    .header-right{gap:8px}
    .settings-button{padding:9px}
    .family-button{padding:9px 12px}
    .events-section{padding-top:22px}
    .section-heading{gap:12px;margin-bottom:18px}
    h1{font-size:27px;letter-spacing:-.7px}
    .mobile-break{display:block}
    .section-heading p{font-size:11px;margin-top:8px;max-width:none}
    .add-button{font-size:11px;padding:12px;gap:5px}
    .add-button>span{font-size:18px}
    .tabs{width:100%;flex:none;overflow-x:auto}
    .tabs button{flex:1;padding:7px 8px;font-size:11px;min-height:36px}
    .list-tools{width:100%;gap:12px;justify-content:space-between}
    .search{flex:1;min-width:0}
    .search input{width:100%;min-width:0;font-size:12px}
    .list-tools select{max-width:125px;font-size:11px}
  }

  @media(prefers-reduced-motion:reduce){.progress-fill,.feature-tile{transition:none}
  .loading-ring{animation:none}
  }

  @media(max-width:360px){
    .settings-button>span{display:none}
    .brand{font-size:16px;gap:6px}
    .family-button{font-size:11px;padding:9px 10px}
    h1{font-size:24px}
    .add-button{font-size:10px;padding:11px 9px}
  }

  .add-actions{display:flex;align-items:center;gap:10px}.event-kind{display:flex;gap:6px;padding:5px;background:var(--surface-pink);border-radius:8px;margin-top:22px}.event-kind button{flex:1;border:0;background:none;padding:10px;border-radius:5px;color:var(--text-muted);font-size:12px}.event-kind button.chosen{background:var(--surface);color:var(--ink);box-shadow:0 1px 4px #32452112}@media(max-width:600px){.add-actions{flex-direction:column-reverse;align-items:stretch;gap:7px}.add-actions .secondary{font-size:10px;padding:8px}}
</style>

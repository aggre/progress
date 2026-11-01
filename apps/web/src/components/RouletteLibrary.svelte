<script lang="ts">
  import { onMount } from 'svelte';
  import type { RouletteRecord, ScheduleRecord } from '@little/shared/api';
  import { validateRoulette, MAX_ROULETTE_OPTIONS } from '@little/shared/roulette';
  import { api } from '../lib/api';
  import RouletteWheel from './RouletteWheel.svelte';

  let { onstarted, onbusy }: { onstarted: (event: ScheduleRecord) => void; onbusy: (busy: boolean) => void } = $props();
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte replaces this reactive collection with each HTTP load or write.
  let roulettes = $state<readonly RouletteRecord[]>([]);
  let selected = $state<RouletteRecord | null>(null);
  let editing = $state<RouletteRecord | null>(null);
  let view = $state<'list' | 'edit' | 'spin'>('list');
  let title = $state('');
  let playMinutes = $state(30);
  let withAfterTask = $state(false);
  let afterTitle = $state('Clean up');
  let afterMinutes = $state(5);
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte owns this editable form collection.
  let choices = $state<readonly Readonly<{ id: number; value: string }>[]>([]);
  let nextChoiceId = 0;
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let confirmingDelete = $state(false);

  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Read family roulettes at the component's HTTP lifecycle boundary.
  async function load() {
    loading = true; error = '';
    // eslint-disable-next-line functional/no-try-statements -- Keep API failures visible and allow retry without discarding the current list.
    try { roulettes = (await api<Readonly<{ roulettes: readonly RouletteRecord[] }>>('/api/roulettes')).roulettes; }
    catch (e) { error = e instanceof Error ? e.message : 'Unable to load roulettes.'; }
    finally { loading = false; }
  }
  onMount(() => { void load(); });
  function edit(roulette: RouletteRecord | null) {
    editing = roulette; title = roulette?.title || ''; error = ''; confirmingDelete = false;
    choices = Array.from(roulette?.options || ['', '']).map((value, id): Readonly<{ id: number; value: string }> => ({ id, value }));
    playMinutes = roulette?.playMinutes ?? 30; withAfterTask = !!roulette?.afterTask;
    afterTitle = roulette?.afterTask?.title ?? 'Clean up'; afterMinutes = roulette?.afterTask?.minutes ?? 5;
    nextChoiceId = choices.length; view = 'edit';
  }
  function choose(roulette: RouletteRecord) { selected = roulette; view = 'spin'; error = ''; confirmingDelete = false; }
  function setChoice(id: number, value: string) { choices = choices.map(choice => choice.id === id ? { ...choice, value } : choice); }
  function busy(value: boolean) { saving = value; onbusy(value); }
  // eslint-disable-next-line functional/prefer-immutable-types -- Submit the native form and await the roulette API write.
  async function save(event: SubmitEvent) {
    event.preventDefault();
    // eslint-disable-next-line functional/no-conditional-statements -- Avoid duplicate HTTP writes from repeated form submissions.
    if (saving) return;
    const input = validateRoulette({ title, options: choices.map(choice => choice.value), playMinutes, afterTask: withAfterTask ? { title: afterTitle, minutes: afterMinutes } : null });
    // eslint-disable-next-line functional/no-conditional-statements -- Display validation feedback before beginning the browser save operation.
    if ('error' in input) { error = input.error; return; }
    busy(true); error = '';
    // eslint-disable-next-line functional/no-try-statements -- Preserve the user's draft on failure and always release the dialog's busy state.
    try {
      const { roulette } = await api<Readonly<{ roulette: RouletteRecord }>>(`/api/roulettes${editing ? '/' + editing.id : ''}`, editing ? 'PUT' : 'POST', input);
      roulettes = editing ? roulettes.map(item => item.id === roulette.id ? roulette : item) : [...roulettes, roulette];
      choose(roulette);
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to save your roulette.'; }
    finally { busy(false); }
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- Start the chosen activity through the API and return its persisted schedule to the dashboard.
  async function start(choiceIndex: number, requestId: string) {
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore duplicate clicks while the chosen result is being saved.
    if (!selected || saving) return;
    busy(true); error = '';
    // eslint-disable-next-line functional/no-try-statements -- Retain the wheel result and its request ID on failure so retry cannot duplicate a saved activity.
    try {
      const { event } = await api<Readonly<{ event: ScheduleRecord }>>(`/api/roulettes/${selected.id}/start`, 'POST', { choiceIndex, requestId, version: selected.updatedAt });
      onstarted(event);
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to start. Please try again.'; }
    finally { busy(false); }
  }
  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Delete the selected roulette after its inline confirmation.
  async function remove() {
    // eslint-disable-next-line functional/no-conditional-statements -- Require an owned selection and a confirmed, idle browser operation.
    if (!selected?.canEdit || !confirmingDelete || saving) return;
    busy(true); error = '';
    // eslint-disable-next-line functional/no-try-statements -- Keep the selection and retry controls when deletion fails.
    try {
      await api('/api/roulettes/' + selected.id, 'DELETE');
      roulettes = roulettes.filter(item => item.id !== selected?.id); selected = null; view = 'list'; confirmingDelete = false;
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to delete your roulette.'; }
    finally { busy(false); }
  }
</script>

<div class="roulette-library">
  <!-- eslint-disable functional/functional-parameters -- Native browser buttons update the current editor selection and dialog state. -->
  {#if view !== 'spin'}<p class="intro">A little inspiration for playtime. Save fun ideas and an optional task for afterward.</p>{/if}
  {#if loading}<p class="status" role="status">Gathering your family’s roulettes…</p>
  {:else if view === 'list'}
    <div class="list-heading"><h3>Family roulettes <span>{roulettes.length}</span></h3><button class="primary" type="button" onclick={() => edit(null)}>＋ New roulette</button></div>
    {#if roulettes.length}
      <ul class="roulette-list">{#each roulettes as roulette (roulette.id)}<li><button type="button" onclick={() => choose(roulette)}><span class="wheel-icon" aria-hidden="true">✳</span><span class="list-copy"><strong>{roulette.title}</strong><small>{roulette.options.length} choices · By {roulette.createdBy.username}</small></span><span class="arrow" aria-hidden="true">↗</span></button></li>{/each}</ul>
    {:else if !error}<div class="empty"><span aria-hidden="true">✳</span><h3>A little spin of possibility.</h3><p>Not sure what to do? Let the wheel choose.<br/>Make your first roulette with your own choices.</p><button type="button" class="secondary" onclick={() => edit(null)}>Create your first roulette</button></div>{/if}
    <button type="button" class="text-button" onclick={load}>Refresh family roulettes ↻</button>
  {:else if view === 'edit'}
    <form onsubmit={save}>
      <fieldset disabled={saving}>
        <legend>{editing ? 'Edit roulette' : 'Create a roulette'}</legend>
        <label class="name">Roulette name<input bind:value={title} required maxlength="80" placeholder="What shall we play?" /></label>
        <div class="choices-heading"><span>Choices</span><span>{choices.length} / {MAX_ROULETTE_OPTIONS}</span></div>
        <p class="hint">Add 2–20 choices. Each gets an equal slice of the wheel.</p>
        <!-- eslint-disable-next-line functional/prefer-immutable-types -- Read native input events and replace the current Svelte form collection when removing a row. -->
        <div class="choices">{#each choices as choice, index (choice.id)}<div><span class="choice-number" aria-hidden="true">{index + 1}</span><input aria-label={`Choice ${index + 1}`} value={choice.value} oninput={event => setChoice(choice.id, event.currentTarget.value)} required maxlength="60" placeholder={index === 0 ? 'Drawing' : index === 1 ? 'LEGO' : 'Another possibility'} /><button type="button" class="remove-choice" aria-label={`Remove choice ${index + 1}`} disabled={choices.length <= 2} onclick={() => choices = choices.filter(item => item.id !== choice.id)}>×</button></div>{/each}</div>
        <button type="button" class="text-button" disabled={choices.length >= MAX_ROULETTE_OPTIONS} onclick={() => { choices = [...choices, { id: nextChoiceId, value: '' }]; nextChoiceId += 1; }}>＋ Add a choice</button>
        <label class="name duration">Play time (minutes)<input type="number" bind:value={playMinutes} min="1" max="240" step="1" required /></label>
        <label class="after-toggle"><input type="checkbox" bind:checked={withAfterTask} /> Add a task afterward</label>
        {#if withAfterTask}<div class="after-fields"><label class="name">Afterward<input bind:value={afterTitle} required maxlength="60" placeholder="Clean up" /></label><label class="name">Minutes<input type="number" bind:value={afterMinutes} min="1" max="60" step="1" required /></label></div>{/if}
        <p class="hint">One start button adds the whole plan. Times are saved for every spin.</p>
        <p class="sharing-note">Shared with your family. Only you can edit or delete it.</p>
      </fieldset>
      <div class="form-actions"><button type="button" class="secondary" disabled={saving} onclick={() => { view = editing ? 'spin' : 'list'; error = ''; }}>Cancel</button><button class="primary" disabled={saving}>{saving ? 'Saving…' : 'Save & spin'}</button></div>
    </form>
  {:else if selected}
    <div class="spin-heading"><button type="button" class="text-button" disabled={saving} onclick={() => { view = 'list'; error = ''; }}>← Family roulettes</button>{#if selected.canEdit}<button type="button" class="text-button" disabled={saving} onclick={() => edit(selected)}>Edit roulette</button>{/if}</div>
    <h3 class="wheel-title">{selected.title}</h3><p class="byline">Shared by {selected.createdBy.username}</p>
    {#if confirmingDelete}<div class="delete-confirmation"><p>Delete “{selected.title}” for everyone in your family?</p><div><button type="button" class="secondary" disabled={saving} onclick={() => confirmingDelete = false}>Keep it</button><button type="button" class="danger" disabled={saving} onclick={remove}>{saving ? 'Deleting…' : 'Delete roulette'}</button></div></div>
    {:else}
      {#key selected}<RouletteWheel title={selected.title} options={selected.options} plan={selected} busy={saving} onstart={(index: number, requestId: string) => { void start(index, requestId); }} />{/key}
      {#if selected.canEdit}<button type="button" class="delete-link" disabled={saving} onclick={() => confirmingDelete = true}>Delete roulette</button>{/if}
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <!-- eslint-enable functional/functional-parameters -->
</div>

<style>
  .duration{margin-top:16px}.duration input{max-width:120px}.after-toggle{display:flex;align-items:center;gap:9px;margin:20px 0 15px;font-size:12px;color:#60764d}.after-toggle input{width:16px;height:16px;accent-color:#819866}.after-fields{display:grid;grid-template-columns:1fr 85px;gap:12px}

  .intro{font-size:12px;color:var(--text-muted);line-height:1.8;margin:18px 0 22px}.status{font-size:12px;color:var(--text-muted);padding:28px 0}.list-heading,.spin-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}h3{font-size:14px;font-weight:500;margin:0}.list-heading h3 span{font-size:10px;background:#edf1e2;padding:3px 7px;border-radius:4px;margin-left:5px}.primary,.secondary{border-radius:7px;font-size:11px;padding:11px 14px}.primary{border:1px solid var(--primary-border);background:var(--primary);color:var(--ink)}.secondary{border:1px solid var(--border);background:var(--surface)}.roulette-list{list-style:none;margin:15px 0;padding:0}.roulette-list li{border-bottom:1px solid #e6e9dd}.roulette-list button{width:100%;display:flex;align-items:center;gap:14px;border:0;background:none;padding:17px 2px;text-align:left}.roulette-list button:hover{background:#f1f4e9}.wheel-icon{font-size:29px;color:#8b9d6e}.list-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}.list-copy strong{font-size:14px;font-weight:500;overflow-wrap:anywhere}.list-copy small{font-size:10px;color:var(--text-muted);overflow-wrap:anywhere}.arrow{color:#8b9d6e}.empty{text-align:center;padding:32px 0 20px}.empty>span{display:block;font-size:48px;color:#9caf7d;margin-bottom:16px}.empty h3{font-family:var(--font-rounded);font-size:23px}.empty p{font-size:12px;line-height:1.8;color:#8a947b;margin:14px 0 20px}.text-button{background:none;border:0;color:#74895d;font-size:11px;padding:10px 0}.spin-heading{margin-top:14px}.wheel-title{text-align:center;font-family:var(--font-rounded);font-size:27px;margin:15px 0 7px;overflow-wrap:anywhere}.byline{text-align:center;font-size:10px;color:var(--text-muted);margin:0}fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-family:var(--font-rounded);font-size:23px;margin-bottom:22px}.name{display:flex;flex-direction:column;gap:9px;font-size:11px;color:var(--text-muted)}input{background:var(--surface-soft);border:1px solid var(--border);border-radius:7px;padding:12px;font-size:13px;color:var(--ink);min-width:0;box-sizing:border-box;width:100%}.choices-heading{display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:23px}.hint{font-size:10px;line-height:1.6;color:var(--text-muted);margin:8px 0 12px}.choices{display:flex;flex-direction:column;gap:9px}.choices>div{display:flex;align-items:center;gap:9px}.choice-number{font-size:10px;min-width:15px;color:#98a583}.remove-choice{background:none;border:0;padding:6px;font-size:23px;color:#9b8778}.sharing-note{font-size:10px;line-height:1.7;color:#829071;padding:12px;background:var(--surface-green);border-radius:6px;margin:12px 0 0}.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}.delete-link{display:block;border:0;background:none;color:var(--danger);font-size:10px;padding:8px 0;margin:20px 0 0}.delete-confirmation{font-size:12px;line-height:1.8;overflow-wrap:anywhere;margin-top:25px}.delete-confirmation>div{display:flex;justify-content:flex-end;gap:8px}.danger{border:1px solid var(--danger-border);background:var(--danger);color:white;border-radius:7px;padding:11px 14px;font-size:11px}.error{font-size:12px;line-height:1.6;color:var(--danger);background:var(--danger-soft);padding:11px;border-radius:5px}
</style>

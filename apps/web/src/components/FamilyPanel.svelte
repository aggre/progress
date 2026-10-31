<script lang="ts">
  import { onMount } from 'svelte';
  import type { Identity, Family, User } from '@little/shared/api';
  import { api } from '../lib/api';
  let { identity, onclose }: { identity: Identity; onclose: () => void } = $props();
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte binds the mutable native dialog element at the DOM boundary.
  let dialog: HTMLDialogElement;
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte owns this reactive family-member proxy; HTTP loads and additions replace its browser state.
  let members = $state<User[]>([]);
  let family = $state<Family | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let username = $state('');
  let error = $state('');
  let notice = $state('');
  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Load the current family through the API during the component lifecycle. This browser dialog or API operation returns its native completion Promise.
  async function load() {
    loading = true; error = '';
    // eslint-disable-next-line functional/no-try-statements -- Handle family API failures and always clear the browser loading state.
    try { ({ family, members } = await api<{ family: Family; members: User[] }>('/api/family')); }
    catch (e) { error = e instanceof Error ? e.message : 'Unable to load your family.'; }
    finally { loading = false; }
  }
  // eslint-disable-next-line functional/prefer-immutable-types -- The browser form handler consumes its native SubmitEvent and returns the API completion Promise.
  async function add(event: SubmitEvent) {
    event.preventDefault();
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore duplicate native form submissions while the current member creation request is in flight.
    if (saving) return;
    saving = true; error = ''; notice = '';
    // eslint-disable-next-line functional/no-try-statements -- Handle member creation API failures and always clear the browser saving state.
    try {
      const result = await api<Readonly<{ user: Readonly<User> }>>('/api/family/members', 'POST', { username: username.trim().toLowerCase() });
      members = [...members, result.user]; username = '';
      notice = `${result.user.username} is now in your family. They can sign in with their username and ask a family member to approve their QR code.`;
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to add this family member.'; }
    finally { saving = false; }
  }
  onMount(() => { dialog.showModal(); void load(); });
</script>
<!-- eslint-disable-next-line functional/prefer-immutable-types -- Handle the native browser cancel event to prevent dismissal while a member is being saved. -->
<dialog bind:this={dialog} onclose={onclose} oncancel={event => saving ? event.preventDefault() : undefined} aria-labelledby="family-title">
  <!-- eslint-disable-next-line functional/functional-parameters -- Close the native family dialog when its browser button is clicked. -->
  <div class="panel-top"><div><p class="eyebrow">THE PEOPLE YOU TRUST</p><h2 id="family-title">Your family.</h2></div><button class="close-button" aria-label="Close family" disabled={saving} onclick={() => dialog.close()}>×</button></div>
  <p class="family-name">{family?.name || identity.family.name}</p><p class="description">A small circle that lets each other in. Any family member can approve sign-ins or add someone new.</p>
  {#if loading}<p class="status" role="status">Gathering your family…</p>{:else}<ul class="member-list">{#each members as member (member.id)}<li><span class="member-avatar" aria-hidden="true">{member.username.slice(0, 1).toUpperCase()}</span><span class="member-name">{member.username}</span>{#if member.id===identity.user.id}<span class="you-label">You</span>{/if}</li>{/each}</ul>{/if}
  <form onsubmit={add}><label>Add a family member<input name="username" bind:value={username} placeholder="Their username" required minlength="3" maxlength="32" pattern={'[A-Za-z0-9_-]{3,32}'} autocomplete="off" autocapitalize="none" spellcheck="false" disabled={saving || loading} /></label><p class="hint">This creates an account in your family. Share the username with them; their first sign-in will need your approval.</p><button class="primary" disabled={saving || loading}>{saving ? 'Adding…' : 'Add to family'}</button></form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}{#if notice}<p class="notice" role="status">{notice}</p>{/if}
</dialog>
<style>
  dialog{box-sizing:border-box;width:min(480px,calc(100% - 30px));max-height:85dvh;padding:28px;border:1px solid var(--border);border-radius:24px;background:var(--surface);color:var(--ink);box-shadow:0 20px 90px var(--shadow)}
  dialog::backdrop{background:var(--backdrop);backdrop-filter:blur(4px)}
  .panel-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  .eyebrow{font-size:8px;letter-spacing:1.7px;color:var(--text-muted);margin:0 0 11px}
  h2{font-family:var(--font-rounded);font-weight:800;font-size:31px;letter-spacing:-1px;margin:0}
  .close-button{border:0;background:none;color:var(--text-muted);padding:0 3px;font-size:26px;line-height:1}
  .family-name{font-size:13px;font-weight:700;color:var(--green-ink);margin:21px 0 10px;overflow-wrap:anywhere}
  .description{font-size:12px;line-height:1.8;color:var(--text-muted);margin:0}
  .member-list{list-style:none;padding:0;margin:22px 0 27px}
  .member-list li{display:flex;align-items:center;gap:11px;padding:11px 0;border-bottom:1px solid var(--border);font-size:12px}
  .member-avatar{width:31px;height:31px;border:1px solid var(--border);border-radius:50%;display:grid;place-items:center;background:var(--pastel-peach);color:var(--ink);font-size:12px;border-color:var(--pastel-peach)}
  .member-name{overflow-wrap:anywhere;min-width:0}
  .you-label{margin-left:auto;font-size:9px;padding:4px 7px;background:var(--surface-green);color:var(--green-ink);border-radius:7px}
  .status{margin:25px 0;color:var(--text-muted);font-size:12px}
  form{border-top:1px solid var(--border);padding-top:21px}
  form label{font-size:11px;display:flex;flex-direction:column;gap:10px;color:var(--text-muted)}
  form input{background:var(--surface-soft);border:1px solid var(--border);border-radius:12px;padding:12px 13px;font-size:13px;color:var(--ink);width:100%;min-width:0;box-sizing:border-box;border-color:var(--border-strong)}
  .hint{font-size:10px;line-height:1.8;color:var(--text-muted);margin:10px 0 15px}
  .primary{font-size:11px;border:1px solid var(--primary-border);background:var(--primary);border-radius:14px;padding:12px 16px;color:var(--ink);width:100%;font-weight:800}
  .error,.notice{font-size:11px;line-height:1.8;padding:12px;border-radius:6px;margin:17px 0 0;overflow-wrap:anywhere}
  .error{background:var(--danger-soft);color:var(--danger)}
  .notice{background:var(--surface-green);color:var(--green-ink)}
  @media(max-width:500px){dialog{padding:24px 21px}
  h2{font-size:29px}
  }
</style>

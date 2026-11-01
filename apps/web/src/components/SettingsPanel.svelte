<script lang="ts">
  import { onMount } from 'svelte';
  import type { Identity } from '@little/shared/api';
  import NotificationSettings from './NotificationSettings.svelte';
  import InstallApp from './InstallApp.svelte';

  let { identity, eventCount, clockDate, clockTime, onclose, onexport, onlogout }: {
    identity: Identity;
    eventCount: number;
    clockDate: string;
    clockTime: string;
    onclose: () => void;
    onexport: () => void;
    onlogout: () => void;
  } = $props();
  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte binds the native dialog used for focus management and Escape dismissal.
  let dialog: HTMLDialogElement;
  let exported = $state(false);

  onMount(() => { dialog.showModal(); });
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="settings-title">
  <header class="panel-top">
    <div><p class="eyebrow">YOUR LITTLE SPACE</p><h2 id="settings-title">Settings<span>.</span></h2></div>
    <!-- eslint-disable-next-line functional/functional-parameters -- Close the native dialog and restore focus to its opening button. -->
    <button class="close-button" aria-label="Close settings" onclick={() => dialog.close()}>×</button>
  </header>
  <div class="account"><span class="avatar" aria-hidden="true">{identity.user.username.slice(0, 1).toUpperCase()}</span><div><strong>{identity.user.username}</strong><p>{identity.family.name}</p></div></div>

  <NotificationSettings userId={identity.user.id} />
  <InstallApp />

  <section class="account-actions" aria-label="Account actions">
    <!-- eslint-disable-next-line functional/functional-parameters -- Start the browser download and report completion inside the open dialog. -->
    <button disabled={!eventCount} onclick={() => { onexport(); exported = true; }}>Export events <span aria-hidden="true">↓</span></button>
    <button class="sign-out" onclick={onlogout}>Sign out</button>
  </section>
  {#if exported}<p class="export-notice" role="status">Your events have been exported.</p>{/if}
  <footer class="today"><span>Today in Tokyo</span><span>{clockDate} · <strong>{clockTime}</strong> JST</span></footer>
</dialog>

<style>
  dialog{width:min(600px,calc(100% - 32px));max-height:90dvh;margin:auto;padding:28px;border:1px solid var(--border);border-radius:24px;background:var(--surface);color:var(--ink);box-shadow:0 20px 90px var(--shadow);overscroll-behavior:contain}
  dialog::backdrop{background:var(--backdrop);backdrop-filter:blur(4px)}
  .panel-top{display:flex;align-items:center;justify-content:space-between;gap:16px}
  .eyebrow{font-size:9px;letter-spacing:1.7px;color:var(--text-muted);margin:0 0 6px}
  h2{font-size:30px;font-weight:800;letter-spacing:-.8px;margin:0}
  h2>span{color:var(--rose-ink)}
  .close-button{display:grid;place-items:center;width:40px;height:40px;border:1px solid var(--border);border-radius:12px;background:var(--surface-soft);font-size:26px;line-height:1;color:var(--text-secondary)}
  .account{display:flex;align-items:center;gap:12px;margin-top:22px}
  .avatar{display:grid;place-items:center;flex-shrink:0;width:38px;height:38px;border-radius:50%;background:var(--pastel-peach);font-size:14px;font-weight:700}
  .account strong{font-size:14px;overflow-wrap:anywhere}
  .account p{font-size:12px;color:var(--text-muted);margin:3px 0 0;overflow-wrap:anywhere}
  .account-actions{display:flex;justify-content:space-between;gap:12px;margin-top:24px;padding-top:20px;border-top:1px solid var(--border)}
  .account-actions button{display:flex;align-items:center;gap:14px;min-height:42px;border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:10px 14px;font-size:12px;font-weight:700}
  .account-actions button:hover{background:var(--surface-soft)}
  .account-actions .sign-out{color:var(--rose-ink)}
  .export-notice{font-size:12px;color:var(--green-ink);margin:14px 0 0}
  .today{display:flex;justify-content:space-between;flex-wrap:wrap;gap:5px 12px;margin-top:22px;font-size:10px;color:var(--text-muted)}
  .today strong{font-weight:600;font-variant-numeric:tabular-nums}
  @media(max-width:600px){dialog{padding:20px;max-height:calc(100dvh - 24px)}h2{font-size:27px}.today{flex-direction:column}}
</style>

<script lang="ts">
  import { onMount } from 'svelte';

  let visible = $state(false);
  let guidance = $state(false);
  let busy = $state(false);
  let message = $state('');
  let platform = $state<'ios' | 'android' | 'mac' | 'other'>('other');
  let active = false;

  onMount(() => {
    active = true;
    // eslint-disable-next-line functional/prefer-immutable-types -- Observe the native display mode as the browser switches into an installed app window.
    const displayMode = matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    platform = ios ? 'ios' : /Android/.test(navigator.userAgent) ? 'android'
      : /Mac/.test(navigator.platform) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent) ? 'mac' : 'other';
    // eslint-disable-next-line functional/functional-parameters -- Refresh installation visibility from current browser capabilities and display mode.
    const refresh = () => {
      const installed = displayMode.matches || navigator.standalone === true || window.littleInstall?.installed;
      visible = !installed && window.isSecureContext && (platform !== 'other' || !!window.littleInstall?.prompt || 'onbeforeinstallprompt' in window);
      void (installed && (guidance = false, message = ''));
    };
    refresh();
    window.addEventListener('little-install-change', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    displayMode.addEventListener('change', refresh);
    // eslint-disable-next-line functional/functional-parameters -- Stop browser listeners and invalidate pending prompt continuations when this view is removed.
    return () => {
      active = false;
      window.removeEventListener('little-install-change', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
      displayMode.removeEventListener('change', refresh);
    };
  });

  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Open the native installation prompt directly from the user's click, or reveal platform instructions.
  async function install() {
    // eslint-disable-next-line functional/no-conditional-statements -- A browser prompt can be consumed only once and must not open twice.
    if (busy) return;
    // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native single-use event while its user-choice promise is pending.
    const prompt = window.littleInstall?.prompt;
    message = '';
    // eslint-disable-next-line functional/no-conditional-statements -- Safari and browsers without a current native prompt require a manual menu action.
    if (!prompt) { guidance = !guidance; return; }
    window.littleInstall.prompt = null;
    busy = true;
    // eslint-disable-next-line functional/no-try-statements -- A dismissed or failed browser prompt leaves the manual installation instructions available.
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      void (active && visible && (guidance = choice.outcome !== 'accepted', message = choice.outcome === 'accepted' ? 'Finish installing in your browser, then open the app from its icon.' : 'Installation was cancelled. You can add the app later from your browser menu.'));
    } catch {
      void (active && visible && (guidance = true, message = 'The install prompt could not open. You can use your browser menu instead.'));
    } finally { void (active && (busy = false)); }
  }
</script>

{#if visible}
  <section class="install-card" aria-label="Install Little by little">
    <div class="install-row">
      <div class="install-copy"><span class="install-icon" aria-hidden="true">⌛</span><div><strong>Keep your moments close.</strong><p>Open Little by little from your Home Screen.</p></div></div>
      <button onclick={install} disabled={busy} aria-expanded={guidance || !!message} aria-controls="install-instructions">{busy ? 'Opening…' : 'Add to Home Screen'}<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 12 8-8M4 4h8v8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
    </div>
    <div class="install-help" id="install-instructions" hidden={!guidance && !message} aria-live="polite">
      {#if message}<p>{message}</p>{/if}
      {#if guidance}
        {#if platform === 'ios'}
          <ol><li>Open this page in Safari and tap <strong>Share</strong> (the square with an up arrow).</li><li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li><li>Open the new icon to sign in and enable notifications.</li></ol>
        {:else if platform === 'mac'}
          <p>In Safari, choose <strong>File → Add to Dock</strong>, then <strong>Add</strong>. Open the app from your Dock. This needs macOS Sonoma or later.</p>
        {:else if platform === 'android'}
          <p>Open your browser’s <strong>⋮ menu</strong>, choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>, then confirm. If the option is missing, open this page in Chrome.</p>
        {:else}
          <p>Use the <strong>install icon in the address bar</strong> or your browser’s <strong>Install app</strong> menu. If it is not available yet, keep this page open and try again shortly.</p>
        {/if}
      {/if}
    </div>
  </section>
{/if}

<style>
  .install-card{margin-top:20px;padding:16px 18px;border:1px solid var(--pastel-green);border-radius:18px;background:var(--surface-green);color:var(--ink)}.install-row{display:flex;align-items:center;justify-content:space-between;gap:18px}.install-copy{display:flex;align-items:center;gap:12px}.install-icon{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;background:var(--rainbow);border-radius:18px;font-size:20px}.install-copy strong{font-size:12px;font-weight:700}.install-copy p{margin:5px 0 0;font-size:11px;line-height:1.5;color:var(--text-muted)}button{border:1px solid var(--primary-border);border-radius:12px;padding:11px 13px;background:var(--primary);font-size:11px;white-space:nowrap;display:flex;align-items:center;justify-content:center;gap:10px}button:hover{background:var(--primary-hover)}.install-help{font-size:12px;line-height:1.8;color:var(--text-secondary)}.install-help:not([hidden]){margin-top:14px;padding-top:12px;border-top:1px solid var(--pastel-green)}.install-help p{margin:0}.install-help ol{margin:0;padding-left:20px}.install-help p+ol{margin-top:8px}.install-help strong{font-weight:600}@media(max-width:600px){.install-card{padding:14px;margin-top:16px}.install-row{align-items:stretch;flex-direction:column;gap:12px}.install-copy p{font-size:10px}.install-row button{align-self:flex-start;margin-left:48px}.install-help{font-size:11px}}
</style>

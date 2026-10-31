<script lang="ts">
  import { onMount } from 'svelte';
  import { api, BASE_PATH, getSession, STORAGE_NAMESPACE } from '../lib/api';
  import { currentPushSubscription, disablePush, enablePush, notificationPermission, pushKeyMatches, readPreferences, updatePushTime, writePreferences, type BrowserPermission, type PushConfiguration, type PushStatus } from '../lib/browser-notifications';
  import { defaultPreferences, parsePreferences, reminderTimes, type ReminderMinutes, type ReminderPreferences } from '../lib/reminders';

  let { userId }: { userId: string } = $props();
  const key = $derived(`${STORAGE_NAMESPACE}:push:${userId}`);
  let preferences = $state<ReminderPreferences>(defaultPreferences);
  let configuration = $state<PushConfiguration>({ configured: false, publicKey: null });
  let permission = $state<BrowserPermission>('unsupported');
  let ready = $state(false);
  let checking = $state(false);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let active = false;
  let generation = 0;
  const enabled = $derived(preferences.enabled && permission === 'granted');

  function save(next: ReminderPreferences) {
    preferences = next;
    void (!writePreferences(key, next) && (notice = 'This browser could not remember the selected time locally. Enabled notification settings remain saved on the server.'));
  }

  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Refresh server-authoritative push status on mount, focus, and changes from another tab.
  async function refresh() {
    // eslint-disable-next-line functional/no-conditional-statements -- Avoid racing a settings mutation or an earlier status request.
    if (!active || busy || checking) return;
    const token = getSession(), request = ++generation;
    permission = notificationPermission();
    // eslint-disable-next-line functional/no-conditional-statements -- Unsupported browsers cannot inspect push subscriptions and signed-out browsers cannot call the API.
    if (permission === 'unsupported' || !token) { ready = true; return; }
    checking = true;
    // eslint-disable-next-line functional/no-try-statements -- Keep status failures visible without replacing settings with a false success state.
    try {
      const config = await api<PushConfiguration>('/api/push/config', 'GET', undefined, token);
      // eslint-disable-next-line functional/prefer-immutable-types -- Inspect the browser subscription without prompting for permission.
      const subscription = await currentPushSubscription(BASE_PATH);
      const status: PushStatus = subscription ? await api<PushStatus>('/api/push/status', 'POST', { endpoint: subscription.endpoint }, token) : { subscribed: false, minutes: null };
      const currentKey = !subscription || !config.publicKey || pushKeyMatches(subscription, config.publicKey);
      void (active && request === generation && token === getSession() && (
        configuration = config,
        preferences = parsePreferences({ enabled: status.subscribed && currentKey, minutes: status.minutes ?? preferences.minutes }),
        void (!currentKey && (notice = 'Notification settings changed. Enable notifications again to reconnect this browser.')),
        error = ''
      ));
    } catch (cause) { void (active && request === generation && (error = cause instanceof Error ? cause.message : 'Unable to check push notifications.')); }
    finally { void (active && request === generation && (checking = false, ready = true)); }
  }

  onMount(() => {
    active = true;
    preferences = { ...readPreferences(key), enabled: false };
    void refresh();
    // eslint-disable-next-line functional/functional-parameters -- Browser focus refreshes server status after permission or subscription changes.
    const focus = () => { void refresh(); };
    // eslint-disable-next-line functional/prefer-immutable-types -- A native storage event from another tab triggers a server-authoritative status refresh.
    const storage = (event: StorageEvent) => { void ((event.key === key || event.key === null) && refresh()); };
    window.addEventListener('focus', focus);
    window.addEventListener('storage', storage);
    // eslint-disable-next-line functional/functional-parameters -- Cleanup invalidates pending requests and removes browser listeners.
    return () => { active = false; generation += 1; window.removeEventListener('focus', focus); window.removeEventListener('storage', storage); };
  });

  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Request permission only from the enable button, then register the browser push endpoint with the server.
  async function enable() {
    const token = getSession(), publicKey = configuration.publicKey;
    // eslint-disable-next-line functional/no-conditional-statements -- Enabling requires a server public key and a current authenticated browser.
    if (!token || !publicKey || busy || checking) return;
    busy = true; error = ''; notice = '';
    // eslint-disable-next-line functional/no-try-statements -- Permission, subscription, and API failures remain retryable.
    try {
      permission = notificationPermission();
      void (permission === 'default' && (permission = await Notification.requestPermission()));
      // eslint-disable-next-line functional/no-conditional-statements -- Ignore a permission response after logout or teardown.
      if (!active || token !== getSession()) return;
      // eslint-disable-next-line functional/no-conditional-statements -- Browsers allow subscription only after the user grants notification permission.
      if (permission !== 'granted') { notice = permission === 'default' ? 'Permission was not granted. Use Enable notifications to try again.' : ''; return; }
      await enablePush(BASE_PATH, publicKey, preferences.minutes, token, () => active);
      void (active && token === getSession() && (save({ ...preferences, enabled: true }), notice ||= 'Push notifications are on. You can close this tab.'));
    } catch (cause) { void (active && (error = cause instanceof Error ? cause.message : 'Unable to enable push notifications. Please try again.')); }
    finally { busy = false; }
  }

  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Stop server deliveries before reporting notifications as disabled.
  async function disable() {
    const token = getSession();
    // eslint-disable-next-line functional/no-conditional-statements -- Mutate only the current authenticated subscription.
    if (!token || busy || checking) return;
    busy = true; error = ''; notice = '';
    // eslint-disable-next-line functional/no-try-statements -- Preserve the on state if the server cannot confirm that deliveries stopped.
    try {
      const unsubscribed = await disablePush(BASE_PATH, token);
      void (active && token === getSession() && (save({ ...preferences, enabled: false }), notice = unsubscribed ? 'Push notifications are off.' : 'Server notifications are off. You can also revoke notification permission in your browser settings.'));
    } catch (cause) { void (active && (error = cause instanceof Error ? cause.message : 'Unable to turn off push notifications. Please try again.')); }
    finally { busy = false; }
  }

  // eslint-disable-next-line functional/prefer-immutable-types -- Update the server before committing the displayed reminder time.
  async function changeTime(minutes: ReminderMinutes) {
    const token = getSession();
    // eslint-disable-next-line functional/no-conditional-statements -- Disabled preferences can be stored locally without subscribing or prompting.
    if (!preferences.enabled) { notice = ''; save({ ...preferences, minutes }); return; }
    // eslint-disable-next-line functional/no-conditional-statements -- Require the current authenticated session before updating an active subscription.
    if (!token || busy || checking) return;
    busy = true; error = ''; notice = '';
    // eslint-disable-next-line functional/no-try-statements -- Keep the previous lead time if the API rejects the update.
    try {
      const updated = await updatePushTime(BASE_PATH, minutes, token, () => active);
      // eslint-disable-next-line functional/no-conditional-statements, functional/no-throw-statements -- A missing native subscription requires a new explicit opt-in.
      if (!updated) { save({ ...preferences, enabled: false }); throw new Error('This browser is no longer subscribed. Enable notifications again.'); }
      void (active && token === getSession() && save({ ...preferences, minutes }));
    } catch (cause) { void (active && (error = cause instanceof Error ? cause.message : 'Unable to update the reminder time.')); }
    finally { busy = false; }
  }

  // eslint-disable-next-line functional/functional-parameters, functional/prefer-immutable-types -- Test the complete server-to-browser Web Push delivery path.
  async function testNotification() {
    const token = getSession();
    // eslint-disable-next-line functional/no-conditional-statements -- Test only the current authenticated subscription.
    if (!token || busy || checking) return;
    busy = true; error = ''; notice = '';
    // eslint-disable-next-line functional/no-try-statements -- Report push-service failures without claiming local notifications are successful pushes.
    try {
      // eslint-disable-next-line functional/prefer-immutable-types -- The native subscription identifies this browser's push delivery endpoint.
      const subscription = await currentPushSubscription(BASE_PATH);
      // eslint-disable-next-line functional/no-conditional-statements, functional/no-throw-statements -- Expired subscriptions cannot receive a test push.
      if (!subscription) { save({ ...preferences, enabled: false }); throw new Error('This browser is no longer subscribed. Enable notifications again.'); }
      await api('/api/push/test', 'POST', { endpoint: subscription.endpoint }, token);
      void (active && token === getSession() && (notice = 'Test push sent. Delivery may take a moment; check your device notification settings if it does not appear.'));
    } catch (cause) { void (active && (error = cause instanceof Error ? cause.message : 'Unable to send a test push.')); }
    finally { busy = false; }
  }
</script>

<section class="reminders" aria-labelledby="reminders-heading">
  <div class="reminder-copy">
    <h2 id="reminders-heading"><span aria-hidden="true">🔔</span> Push notifications <span class:enabled>{enabled ? 'On' : 'Off'}</span></h2>
    <p>Get a reminder for each family event, even with this tab closed. Reminders run about once a minute; delivery may be delayed while your device is offline or asleep.</p>
    <p>Settings apply to this browser. Signing out stops notifications.</p>
  </div>
  <div class="reminder-controls">
    <!-- eslint-disable-next-line functional/prefer-immutable-types -- Reset the native select while its asynchronous server update is pending. -->
    <label>Remind me<select aria-label="Reminder time" value={String(preferences.minutes)} disabled={!ready || busy || checking} onchange={event => { const minutes = Number(event.currentTarget.value) as ReminderMinutes; event.currentTarget.value = String(preferences.minutes); void changeTime(minutes); }}>
      {#each Object.entries(reminderTimes) as [minutes, label] (minutes)}<option value={minutes}>{label} before</option>{/each}
    </select></label>
    {#if preferences.enabled}<button disabled={busy || checking} onclick={disable}>Turn off</button>{/if}
    {#if !enabled}
      <button class="enable-button" disabled={!ready || busy || checking || !configuration.configured || permission === 'denied' || permission === 'unsupported'} onclick={enable}>{busy ? 'Enabling…' : checking ? 'Checking…' : 'Enable notifications'}</button>
    {:else}
      <button disabled={busy || checking || !configuration.configured} onclick={testNotification}>{busy ? 'Please wait…' : 'Test notification'}</button>
    {/if}
  </div>
  <div class="reminder-status" aria-live="polite">
    {#if ready && permission === 'unsupported'}<p>Web Push is unavailable here. Use HTTPS in a supported browser. On iPhone or iPad, add this app to your Home Screen and open it there.</p>
    {:else if permission === 'denied'}<p>Notifications are blocked. Allow them in your browser’s site settings, then enable notifications here.</p>
    {:else if ready && !checking && !configuration.configured && !error}<p>Push notifications have not been set up on the server yet.</p>{/if}
    {#if error}<p role="alert">{error}</p><button class="retry-button" disabled={busy || checking} onclick={refresh}>Check again</button>{/if}
    {#if notice}<p>{notice}</p>{/if}
  </div>
</section>

<style>
  .reminders{display:flex;flex-wrap:wrap;align-items:center;gap:16px 24px;margin:24px 0 0;padding:18px 20px;border:1px solid var(--border);border-radius:18px;background:var(--surface-soft)}
  .reminder-copy{flex:1;min-width:220px}.reminder-copy h2{display:flex;align-items:center;gap:9px;margin:0 0 8px;font-size:13px;font-weight:700}.reminder-copy h2>span:first-child{font-size:19px;color:var(--rose-ink)}.reminder-copy h2>span:last-child{font-size:10px;background:var(--surface);padding:3px 7px;border-radius:12px;color:var(--text-secondary)}.reminder-copy h2>span.enabled{background:var(--pastel-green);color:var(--green-ink)}
  p{font-size:11px;line-height:1.6;color:var(--text-muted);margin:5px 0 0}.reminder-controls{display:flex;flex-wrap:wrap;align-items:flex-end;gap:9px}.reminder-controls label{display:flex;flex-direction:column;gap:6px;font-size:10px;color:var(--text-secondary)}button,select{border:1px solid var(--border-strong);border-radius:12px;background:var(--surface);color:var(--ink);padding:9px 11px;font-size:11px;min-height:36px}.enable-button{background:var(--primary)}button:disabled{cursor:default}.reminder-status{width:100%}.reminder-status:empty{display:none}.retry-button{margin-top:9px}
  @media(max-width:680px){.reminders{padding:16px;gap:15px}.reminder-controls{width:100%}.reminder-copy{min-width:0}.reminder-controls label{flex:1}.reminder-status p{font-size:10px}}
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteURL } from 'svelte/reactivity';
  import QRCode from 'qrcode';
  import type { Identity, LoginChallenge, LoginStatus, PendingApproval } from '@little/shared/api';
  import { api, ApiError, BASE_PATH, STORAGE_NAMESPACE, SESSION_EXPIRED_EVENT, clearSession, getSession, saveSession, sessionStorageKey } from '../lib/api';
  import Dashboard from './Dashboard.svelte';
  import FamilyPanel from './FamilyPanel.svelte';

  type SavedChallenge = Readonly<LoginChallenge & { username: string }>;
  type ApprovalIntent = Readonly<{ id: string; approvalToken: string }>;
  let identity = $state<Identity | null>(null);
  let checking = $state(true);
  let username = $state('');
  let pending = $state<SavedChallenge | null>(null);
  let qrImage = $state('');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let expired = $state(false);
  let now = $state(Date.now());
  let approval = $state<ApprovalIntent | null>(null);
  let approvalDetails = $state<PendingApproval | null>(null);
  let approvalLoading = $state(false);
  let approved = $state(false);
  let approvalError = $state('');
  let familyOpen = $state(false);
  // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native browser timer handle so login polling can be cancelled.
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollGeneration = 0;
  let failures = 0;
  const challengeKey = sessionStorageKey('pending-login');
  const approvalKey = sessionStorageKey('approval-intent');
  const secondsRemaining = $derived(pending ? Math.max(0, Math.ceil((pending.expiresAt - now) / 1000)) : 0);
  const minutesRemaining = $derived(`${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, '0')}`);
  const hasApproval = $derived(Boolean(approval));

  function storageRead<T>(key: string): T | null {
    // eslint-disable-next-line functional/no-try-statements -- Browser session storage may be unavailable or contain invalid persisted JSON.
    try { const value = sessionStorage.getItem(key); return value ? JSON.parse(value) as T : null; } catch { return null; }
  }
  function storageRemove(key: string) {
    // eslint-disable-next-line functional/no-try-statements -- Removing transient browser state remains safe when storage is unavailable.
    try { sessionStorage.removeItem(key); } catch { /* No stored value to remove. */ }
  }
  // eslint-disable-next-line functional/functional-parameters -- Timer cleanup uses the current browser timer handle.
  function stopPolling() { pollGeneration += 1; if (pollTimer) clearTimeout(pollTimer); pollTimer = undefined; }
  // eslint-disable-next-line functional/functional-parameters -- Clear the current browser login state, timer, and session storage.
  function clearPending() { stopPolling(); pending = null; qrImage = ''; expired = false; storageRemove(challengeKey); }
  function validSecret(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value); }
  function validId(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value); }
  function validChallenge(value: SavedChallenge | null): value is SavedChallenge {
    return !!value && validId(value.id) && validSecret(value.pollToken) && validSecret(value.sessionToken) && validSecret(value.approvalToken) && typeof value.username === 'string' && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) && typeof value.pollInterval === 'number' && value.pollInterval > 0 && typeof value.verificationCode === 'string';
  }
  // eslint-disable-next-line functional/functional-parameters -- Read the browser URL and tab storage, then update browser history.
  function readApprovalIntent() {
    const fragment = window.location.hash;
    if (fragment.startsWith('#approve=')) {
      // The approval capability never enters an HTTP request or a referrer.
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      const raw = fragment.slice('#approve='.length);
      const separator = raw.indexOf('.');
      const intent: ApprovalIntent = { id: raw.slice(0, separator), approvalToken: raw.slice(separator + 1) };
      if (separator > 0 && validId(intent.id) && validSecret(intent.approvalToken)) {
        approval = intent;
        // eslint-disable-next-line functional/no-try-statements -- Approval can continue in memory when browser session storage rejects a write.
        try { sessionStorage.setItem(approvalKey, JSON.stringify(intent)); } catch { /* Current tab can still approve. */ }
      } else { approvalError = 'This approval link is not valid.'; }
    } else {
      const stored = storageRead<ApprovalIntent>(approvalKey);
      if (stored && validId(stored.id) && validSecret(stored.approvalToken)) approval = stored;
    }
  }
  // eslint-disable-next-line functional/functional-parameters -- Load the identity for the current browser session through the API.
  async function loadIdentity() {
    const token = getSession();
    if (!token) { identity = null; checking = false; return; }
    // eslint-disable-next-line functional/no-try-statements -- Handle identity API failures and always clear the browser session-check state.
    try {
      const verified = await api<Readonly<{user:Readonly<Identity['user']>;family:Identity['family']}>>('/api/me', 'GET', undefined, token);
      if (getSession() !== token) return;
      identity = verified;
      error = '';
      if (approval) await inspectApproval();
    } catch (e) {
      identity = null;
      if (e instanceof ApiError && e.status === 401) notice = 'Your session has ended. Ask your family to approve a new sign-in.';
      else error = e instanceof Error ? e.message : 'Unable to check your session.';
    } finally { checking = false; }
  }
  async function makeQr(challenge: LoginChallenge) {
    // eslint-disable-next-line functional/prefer-immutable-types -- Configure the approval fragment on the browser URL before encoding it as a QR image.
    const url = new SvelteURL(BASE_PATH, location.origin);
    url.hash = `approve=${challenge.id}.${challenge.approvalToken}`;
    qrImage = await QRCode.toDataURL(url.toString(), { width: 276, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#344333', light: '#fffefa' } });
  }
  async function poll(generation: number) {
    const challenge = pending;
    if (!challenge || generation !== pollGeneration) return;
    now = Date.now();
    if (challenge.expiresAt <= now) { expired = true; stopPolling(); storageRemove(challengeKey); return; }
    // eslint-disable-next-line functional/no-try-statements -- Handle polling API failures so the browser can report the error and schedule a retry.
    try {
      const result = await api<LoginStatus>(`/api/auth/challenges/${challenge.id}/poll`, 'POST', { pollToken: challenge.pollToken }, null);
      if (generation !== pollGeneration) return;
      failures = 0;
      error = '';
      if (result.status === 'approved') {
        const verified = await api<Readonly<{user:Readonly<Identity['user']>;family:Identity['family']}>>('/api/me', 'GET', undefined, challenge.sessionToken);
        if (generation !== pollGeneration) return;
        saveSession(challenge.sessionToken);
        clearPending();
        identity = verified;
        notice = '';
        if (approval) await inspectApproval();
        return;
      }
      if (result.status === 'expired') { expired = true; stopPolling(); storageRemove(challengeKey); return; }
    } catch (e) {
      if (generation !== pollGeneration) return;
      failures += 1;
      if (e instanceof ApiError && [400, 404, 410].includes(e.status)) { expired = true; stopPolling(); storageRemove(challengeKey); return; }
      error = e instanceof Error ? e.message : 'Unable to check approval. Retrying…';
    }
    if (generation === pollGeneration) pollTimer = setTimeout(() => { void poll(generation); }, Math.max(3000, challenge.pollInterval, Math.min(30000, failures * 5000)));
  }
  // eslint-disable-next-line functional/functional-parameters -- Schedule the next browser timer for the current login attempt.
  function startPolling() {
    stopPolling(); failures = 0;
    const generation = pollGeneration;
    pollTimer = setTimeout(() => { void poll(generation); }, Math.max(3000, pending?.pollInterval || 3000));
  }
  async function startLogin(event: SubmitEvent) {
    event.preventDefault(); if (busy) return;
    busy = true; error = ''; notice = ''; clearPending();
    // eslint-disable-next-line functional/no-try-statements -- Handle challenge API and QR generation failures and always clear the browser busy state.
    try {
      const normalized = username.trim().toLowerCase();
      const challenge = await api<LoginChallenge>('/api/auth/challenges', 'POST', { username: normalized }, null);
      pending = { ...challenge, username: normalized };
      await makeQr(challenge);
      // eslint-disable-next-line functional/no-try-statements -- Login can continue in this tab when browser session storage rejects a write.
      try { sessionStorage.setItem(challengeKey, JSON.stringify(pending)); } catch { /* Continue in this tab if browser storage is unavailable. */ }
      now = Date.now(); startPolling();
    } catch (e) { clearPending(); error = e instanceof Error ? e.message : 'Unable to start sign-in.'; }
    finally { busy = false; }
  }
  // eslint-disable-next-line functional/functional-parameters -- Inspect the current QR approval request through the API.
  async function inspectApproval() {
    if (!approval || !identity) return;
    approvalLoading = true; approvalError = ''; approvalDetails = null;
    // eslint-disable-next-line functional/no-try-statements -- Handle approval inspection API failures and always clear the browser loading state.
    try { approvalDetails = await api<PendingApproval>(`/api/auth/challenges/${approval.id}/inspect`, 'POST', { approvalToken: approval.approvalToken }); }
    catch (e) { approvalError = e instanceof Error ? e.message : 'Unable to check this sign-in request.'; }
    finally { approvalLoading = false; }
  }
  // eslint-disable-next-line functional/functional-parameters -- Submit the current approval to the API and clear its tab storage.
  async function approve() {
    if (!approval || !approvalDetails || busy) return;
    busy = true; approvalError = '';
    // eslint-disable-next-line functional/no-try-statements -- Handle approval API failures and always clear the browser busy state.
    try {
      await api(`/api/auth/challenges/${approval.id}/approve`, 'POST', { approvalToken: approval.approvalToken });
      approved = true; storageRemove(approvalKey);
    } catch (e) { approvalError = e instanceof Error ? e.message : 'Unable to approve. Please try again.'; }
    finally { busy = false; }
  }
  // eslint-disable-next-line functional/functional-parameters -- Close the current browser approval view and clear its tab storage.
  function leaveApproval() { approval = null; approvalDetails = null; approvalError = ''; approved = false; storageRemove(approvalKey); }
  // eslint-disable-next-line functional/functional-parameters -- Revoke the current API session and clear browser storage and timers.
  async function logout() {
    // eslint-disable-next-line functional/no-try-statements -- Complete local browser sign-out even when the session revocation API fails.
    try { await api('/api/auth/logout', 'POST', {}); }
    catch { /* Local sign-out still removes this device's access. */ }
    clearSession(); identity = null; familyOpen = false; clearPending(); notice = 'You’re signed out.';
  }
  onMount(() => {
    readApprovalIntent();
    const stored = storageRead<SavedChallenge>(challengeKey);
    if (validChallenge(stored) && stored.expiresAt > Date.now()) {
      pending = stored; username = stored.username;
      void makeQr(stored).then(startPolling).catch(() => { clearPending(); error = 'Unable to restore the sign-in request. Please try again.'; });
    } else storageRemove(challengeKey);
    void loadIdentity();
    // eslint-disable-next-line functional/prefer-immutable-types -- Retain the native interval handle so component cleanup can cancel it.
    const timer = setInterval(() => { now = Date.now(); if (pending && pending.expiresAt <= now) { expired = true; stopPolling(); storageRemove(challengeKey); } }, 1000);
    // eslint-disable-next-line functional/functional-parameters -- Handle the browser session-expiration event by clearing its signed-in view.
    const sessionExpired = () => { identity = null; familyOpen = false; notice = 'Your session has ended. Ask your family to approve a new sign-in.'; };
    // eslint-disable-next-line functional/prefer-immutable-types -- Read the native browser StorageEvent to synchronize sign-in state between tabs.
    const storageChanged = (event: StorageEvent) => {
      if (event.key === `${STORAGE_NAMESPACE}:session`) { identity = null; checking = true; void loadIdentity(); }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, sessionExpired);
    window.addEventListener('storage', storageChanged);
    // eslint-disable-next-line functional/functional-parameters -- Component cleanup cancels browser polling and removes window listeners.
    return () => { stopPolling(); clearInterval(timer); window.removeEventListener(SESSION_EXPIRED_EVENT, sessionExpired); window.removeEventListener('storage', storageChanged); };
  });
</script>

<svelte:head><title>Little by little — {identity ? approval ? 'Approve sign-in' : 'Your time, in perspective' : 'Sign in'}</title></svelte:head>

{#if checking}
  <main class="checking" aria-live="polite"><span class="brand-symbol" aria-hidden="true">⌛</span><p>One little moment…</p></main>
{:else if identity && !hasApproval}
  <!-- eslint-disable-next-line functional/functional-parameters -- Browser button callbacks sign out or open the family dialog for this session. -->
  <Dashboard {identity} onlogout={() => { void logout(); }} onfamily={() => { familyOpen = true; }} />
  {#if familyOpen}
    <!-- eslint-disable-next-line functional/functional-parameters -- Handle the family dialog close event in the browser view. -->
    <FamilyPanel {identity} onclose={() => { familyOpen = false; }} />
  {/if}
{:else}
  <div class="auth-shell">
    <header class="auth-topbar"><a class="brand" href={BASE_PATH}><span class="brand-symbol" aria-hidden="true">⌛</span><span>little by little<span class="brand-dot">.</span></span></a><span class="quiet-label">AT YOUR OWN PACE</span></header>
    <main class="auth-main">
      {#if identity && approval}
        <section class="auth-card" aria-labelledby="approval-heading">
          <p class="eyebrow">A LITTLE TRUST</p>
          {#if approved}
            <span class="success-symbol" aria-hidden="true">✓</span><h1 id="approval-heading">You’re all set.</h1><p class="description">The other device is now signed in.<br/>You can close this tab or return to your moments.</p><button class="primary full-width" onclick={leaveApproval}>Back to my moments</button>
          {:else}
            <h1 id="approval-heading">Let someone in.</h1><p class="description">Approve a sign-in for someone in your family.</p>
            {#if approvalLoading}<p class="status-line" role="status">Checking this request…</p>{/if}
            {#if approvalDetails}
              <div class="approval-person"><span class="member-icon">{approvalDetails.username.slice(0, 1).toUpperCase()}</span><div><span class="field-caption">SIGNING IN AS</span><strong>{approvalDetails.username}</strong></div></div>
              <div class="verification"><span>Matching code</span><strong>{approvalDetails.verificationCode}</strong></div>
              <p class="approval-warning">Compare this code with the other device. Only approve a sign-in you or your family member started.</p>
              <button class="primary full-width" disabled={busy || approvalDetails.expiresAt <= now} onclick={approve}>{busy ? 'Approving…' : approvalDetails.expiresAt <= now ? 'This request has expired' : 'Approve sign-in'}</button>
            {/if}
            {#if approvalError}<p class="error-message" role="alert">{approvalError}</p><button class="text-button" onclick={inspectApproval}>Check again</button>{/if}
            <button class="secondary full-width" disabled={busy} onclick={leaveApproval}>Back to my moments</button>
          {/if}
        </section>
      {:else}
        <section class="auth-card" aria-labelledby="login-heading">
          <p class="eyebrow">YOUR OWN LITTLE SPACE</p>
          <h1 id="login-heading">Welcome <em>back.</em></h1>
          {#if approval}<div class="scan-notice">Sign in on a device your family already knows to approve this request.</div>{/if}
          {#if pending}
            <p class="description">Signing in as <strong class="username-text">{pending.username}</strong>.<br/>Ask someone in your family to scan this code.</p>
            <div class="qr-wrap" class:qr-expired={expired}>{#if qrImage}<img src={qrImage} alt="QR code for a signed-in family member to approve this sign-in" width="276" height="276" />{:else}<p>Preparing your code…</p>{/if}</div>
            <div class="verification"><span>Matching code</span><strong>{pending.verificationCode}</strong></div>
            <div class="waiting-line" role="status"><span class:expired-dot={expired} class="live-dot"></span>{expired ? 'This code has expired.' : `Waiting for your family · ${minutesRemaining}`}</div>
            {#if !expired}<p class="small-description">This page will update automatically after approval.</p>{/if}
            <details class="request-details"><summary>Request details</summary><p>For a first sign-in, share this request ID and matching code with your system administrator.</p><label>Request ID<input readonly value={pending.id} aria-label="Login request ID" /></label></details>
      <!-- eslint-disable-next-line functional/functional-parameters -- Cancel or restart the browser sign-in flow and clear its pending state. -->
            <button class="secondary full-width" disabled={busy} onclick={() => { clearPending(); error = ''; }}>{expired ? 'Try again' : 'Use another username'}</button>
          {:else}
            <p class="description">A familiar face is your key.<br/>Enter your username to ask your family to let you in.</p>
            <form onsubmit={startLogin}><label class="username-label">Username<input name="username" bind:value={username} required minlength="3" maxlength="32" pattern={'[A-Za-z0-9_-]{3,32}'} autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Your username" disabled={busy} /></label><button class="primary full-width" disabled={busy}>{busy ? 'Preparing your code…' : 'Continue with a QR code'}<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></form>
            <p class="small-description signup-note">This space is for existing family members.<br/>Account registration is currently unavailable.</p>
          {/if}
          {#if notice}<p class="notice-message" role="status">{notice}</p>{/if}
          {#if error}<p class="error-message" role="alert">{error}</p>{/if}
          {#if approvalError}<p class="error-message" role="alert">{approvalError}</p>{/if}
          <div class="auth-footnote"><span aria-hidden="true">✳</span><p>A little trust goes a long way.</p></div>
        </section>
      {/if}
    </main>
    <footer class="auth-footer"><span>little by little<span class="brand-dot">.</span></span><span>No passwords. Just family.</span></footer>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f8f8f2;color:#343a32;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}:global(button),:global(input){font:inherit}:global(button){cursor:pointer;color:inherit}:global(button:disabled){cursor:wait;opacity:.55}:global(button:focus-visible),:global(a:focus-visible),:global(input:focus-visible),:global(summary:focus-visible){outline:3px solid #74966c;outline-offset:4px}:global(a){color:inherit}.auth-shell{max-width:1120px;margin:auto;padding:0 48px}.auth-topbar{height:104px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dedfd4}.brand{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:700;letter-spacing:-.8px;text-decoration:none}.brand-symbol{display:grid;place-items:center;width:34px;height:38px;background:#e7edcc;border-radius:11px;font-size:21px;transform:rotate(-7deg)}.brand-dot{color:#7f9665}.quiet-label{font-size:9px;letter-spacing:1.8px;color:#8a927c}.auth-main{display:flex;align-items:center;justify-content:center;min-height:calc(100dvh - 180px);padding:62px 0}.auth-card{max-width:420px;width:100%;text-align:center}.eyebrow{font-size:9px;letter-spacing:2px;font-weight:600;color:#879174;margin:0 0 22px}h1{font-family:Georgia,'Times New Roman',serif;font-size:48px;line-height:1.12;letter-spacing:-2px;font-weight:400;margin:0 0 22px}h1 em{font-weight:400;color:#85956f}.description{font-size:13px;color:#7c856f;line-height:1.85;margin:0 0 29px}.description strong{font-weight:500;color:#57634b}.username-label{display:flex;flex-direction:column;text-align:left;gap:10px;font-size:11px;color:#6c775d}.username-label input{background:#fffefa;border:1px solid #d8dfcb;border-radius:8px;padding:14px 15px;font-size:14px;color:#35452c;width:100%}.username-label input::placeholder{color:#a1a692}.primary{border:1px solid #d5dfa9;border-radius:8px;background:#e2ebba;color:#434f30;padding:14px 17px;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:17px}.primary:hover{background:#d8e5a9}.full-width{width:100%}.username-label+.primary{margin-top:14px}.secondary{padding:12px 16px;border:1px solid #dce1d0;background:#fffefa;border-radius:7px;font-size:11px;margin-top:14px}.secondary:hover{background:#f0f3e8}.small-description{font-size:10px;color:#939b86;line-height:1.8;margin:13px 0 0}.signup-note{margin-top:24px}.auth-footnote{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:37px;padding-top:26px;border-top:1px solid #e0e3d5}.auth-footnote>span{font-size:24px;color:#94a875}.auth-footnote>p{font-family:Georgia,serif;font-size:12px;font-style:italic;color:#929b81;margin:0}.auth-footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #dedfd4;padding:22px 0 27px;font-size:10px;color:#929b82}.auth-footer>span:last-child{font-family:Georgia,serif;font-style:italic}.checking{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:15px}.checking>p{font-family:Georgia,serif;color:#899779;font-size:14px;font-style:italic}.qr-wrap{width:276px;height:276px;margin:0 auto 15px;background:#fffefa;border:1px solid #e0e4d7;border-radius:13px;display:grid;place-items:center;overflow:hidden}.qr-wrap img{max-width:100%;height:auto;display:block}.qr-expired{opacity:.25;filter:grayscale(1)}.verification{display:flex;align-items:center;justify-content:space-between;gap:15px;max-width:276px;margin:0 auto;padding:13px 0;border-bottom:1px solid #e1e5d7;color:#8a947a;font-size:10px}.verification strong{font-size:19px;letter-spacing:3px;font-variant-numeric:tabular-nums;color:#576648;font-weight:500}.waiting-line{display:flex;align-items:center;justify-content:center;gap:8px;font-size:11px;color:#7a8968;margin-top:20px;font-variant-numeric:tabular-nums}.live-dot{background:#91a875;width:6px;height:6px;display:inline-block;border-radius:50%}.live-dot.expired-dot{background:#b78468}.request-details{font-size:10px;color:#929b83;margin-top:22px;text-align:left;background:#f0f2e8;border-radius:7px;padding:12px 14px;line-height:1.7}.request-details summary{cursor:pointer}.request-details p{margin:10px 0}.request-details label{display:flex;flex-direction:column;gap:7px}.request-details input{background:#fffefa;border:1px solid #d9dfcc;padding:8px;font-size:10px;border-radius:5px;color:#69775a;width:100%}.error-message,.notice-message,.scan-notice{border-radius:7px;padding:12px 14px;font-size:11px;line-height:1.7;margin:18px 0 0;overflow-wrap:anywhere}.error-message{background:#faeee7;color:#9d5e4b;border:1px solid #ebd4c9}.notice-message,.scan-notice{background:#eef2e3;color:#788967;border:1px solid #dce4cc}.scan-notice{margin:0 0 22px}.approval-person{border:1px solid #dce3ce;background:#f1f4e8;display:flex;align-items:center;gap:14px;padding:20px;text-align:left;border-radius:10px;margin:0 0 16px}.member-icon{background:#e1e9cc;width:43px;height:43px;border-radius:50%;display:grid;place-items:center;font-size:18px;color:#718654}.approval-person>div{display:flex;flex-direction:column;gap:8px}.field-caption{font-size:8px;letter-spacing:1.4px;color:#8b9679}.approval-person strong{font-size:16px;font-weight:500;color:#526541;overflow-wrap:anywhere}.approval-warning{font-size:12px;line-height:1.8;color:#7f8b70;margin:23px 0}.status-line{font-size:12px;color:#879776;margin:25px 0}.text-button{border:0;background:none;color:#788e5f;font-size:11px;margin-top:14px}.success-symbol{display:grid;place-items:center;font-size:32px;width:62px;height:62px;margin:0 auto 24px;border:1px solid #d4dfba;color:#80995e;background:#e8eedb;border-radius:50%}.username-text{overflow-wrap:anywhere}
  @media(max-width:600px){.auth-shell{padding:0 23px}.auth-topbar{height:80px}.brand{font-size:19px;gap:8px}.brand-symbol{width:29px;height:33px;font-size:18px}.quiet-label{display:none}.auth-main{padding:42px 0;min-height:calc(100dvh - 154px)}.auth-card{max-width:360px}h1{font-size:43px;letter-spacing:-1.8px}.description{font-size:12px}.auth-footer{font-size:9px;padding:20px 0 24px}.auth-footnote{margin-top:30px;padding-top:22px}.qr-wrap{width:250px;height:250px}.qr-wrap img{width:250px;height:250px}.eyebrow{font-size:8px}.verification{max-width:250px}}
</style>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { clamp } from 'ramda';
  import {
    mascotXpProgress,
    SPRING_FEELS,
    stepSpringValue,
    type MascotMood,
    type SpringFeel,
    type SpringState,
  } from '@little/shared/mascot';

  let {
    xp,
    fatigue,
    energy,
    hour,
    mood,
    headline,
    streak,
    napping,
    springFeel,
    doneCount,
    totalCount,
    effortPoints,
    celebrateNonce,
    celebrateMessage,
    restNonce,
    busy,
    onbreather,
    ontogglenap,
    onchangefeel,
  }: {
    xp: number;
    fatigue: number;
    energy: number;
    hour: number;
    mood: MascotMood;
    headline: string;
    streak: number;
    napping: boolean;
    springFeel: SpringFeel;
    doneCount: number;
    totalCount: number;
    effortPoints: number;
    celebrateNonce: number;
    celebrateMessage: string;
    restNonce: number;
    busy: boolean;
    onbreather: () => void;
    ontogglenap: () => void;
    onchangefeel: (feel: SpringFeel) => void;
  } = $props();

  interface ParticleState {
    readonly id: number;
    readonly kind: 'heart' | 'star' | 'zzz';
    readonly fill: string;
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
    readonly life: number;
    readonly maxLife: number;
    readonly rot: number;
    readonly spin: number;
    readonly scale: number;
    readonly transform: string;
    readonly opacity: string;
  }

  interface PetalRender {
    readonly rx: string;
    readonly ry: string;
    readonly transform: string;
    readonly visible: boolean;
  }

  const uid = $props.id();
  const clipEyeId = `clip-eye-${uid}`;
  const petalGradId = `petal-grad-${uid}`;
  const sproutGradId = `sprout-grad-${uid}`;
  const haloGradId = `halo-grad-${uid}`;

  // eslint-disable-next-line functional/prefer-immutable-types -- Svelte binds the native container element to measure pointer coordinates and capture drags.
  let touchAreaEl: HTMLDivElement;

  let bubbleText = $state('');
  let bubbleVisible = $state(false);
  // eslint-disable-next-line functional/prefer-immutable-types -- Native browser timeout handle for speech bubble dismissal.
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;

  let rootTransform = $state('translate(160, 128)');
  let shadowRx = $state('64');
  let shadowCx = $state('160');
  let shadowOpacity = $state('0.16');
  let radiantOpacity = $state('0');
  let haloTransform = $state('');
  let crownTransform = $state('');
  let sproutLTransform = $state('');
  let sproutRTransform = $state('');
  let leafLTransform = $state('');
  let leafRTransform = $state('');
  let faceTransform = $state('translate(0, -4)');
  let cheekOpacity = $state('0.55');
  let pupilTransform = $state('translate(0, 1.5)');
  let eyelidD = $state('M -22 -28 H 22 V -26 Q 0 -22 -22 -26 Z');
  let sleepLidOpacity = $state('0');
  let happyEyeActive = $state(false);
  let mouthD = $state('M -9 24 Q 0 33 9 24');
  let mouthFill = $state('none');
  let budD = $state('');
  let petalShapes = $state<Readonly<ArrayLike<PetalRender>>>([
    { rx: '27', ry: '31', transform: '', visible: true },
    { rx: '27', ry: '31', transform: '', visible: true },
    { rx: '27', ry: '31', transform: '', visible: true },
    { rx: '27', ry: '31', transform: '', visible: true },
    { rx: '27', ry: '31', transform: '', visible: true },
  ]);
  let lashPaths = $state<Readonly<ArrayLike<string>>>(['', '', '', '', '']);
  let particles = $state<Readonly<ArrayLike<ParticleState>>>([]);

  const xpInfo = $derived(mascotXpProgress(xp));
  const stage = $derived(xpInfo.stage);
  const isEvening = $derived(hour >= 17 && hour < 20 && !napping);
  const isNight = $derived(hour >= 20 || hour < 4 || napping);
  const energyColor = $derived(
    napping || fatigue >= 78 ? 'var(--pastel-lavender)'
      : fatigue >= 52 ? 'var(--pastel-apricot)'
      : fatigue >= 28 ? 'var(--pastel-pink)'
      : 'var(--pastel-green)',
  );
  const greetingText = $derived(
    hour < 4 || hour >= 20 ? 'Bedtime soon'
      : hour < 12 ? 'Good morning'
      : hour < 17 ? 'Sunny afternoon'
      : 'Cozy evening',
  );

  const lashOffsets: Readonly<ArrayLike<number>> = [-11, -5.5, 0, 5.5, 11];
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const springInit = (x = 0): SpringState => ({ x, v: 0, target: x });

  // Flat animation rig state updated at 60/120fps without mutable container types
  let posX: SpringState = springInit(0);
  let posY: SpringState = springInit(0);
  let stretch: SpringState = springInit(0);
  let tilt: SpringState = springInit(0);
  let gazeX: SpringState = springInit(0);
  let gazeY: SpringState = springInit(0);
  let eyelid: SpringState = springInit(0);
  let happyEye: SpringState = springInit(0);
  let yawnOpen: SpringState = springInit(0);
  let growthScale: SpringState = springInit(1);
  let petalAngles: Readonly<ArrayLike<SpringState>> = [
    springInit(-90), springInit(-18), springInit(54), springInit(126), springInit(198),
  ];
  let petalStretches: Readonly<ArrayLike<SpringState>> = [
    springInit(0), springInit(0), springInit(0), springInit(0), springInit(0),
  ];

  let blinkTimer = 2.2;
  let blinking = false;
  let blinkPhase = 0;
  let yawnTimer = 5.5;
  let yawning = false;
  let yawnPhase = 0;
  let celebrateTimer = 0;
  let petTimer = 0;
  let pokeTimer = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let petDistance = 0;
  let lastMoveX = 0;
  let lastMoveY = 0;
  let animTime = 0;
  let zzzTimer = 0;
  let reducedMotion = false;
  let nextParticleId = 1;

  const showBubble = (text: string, ms = 1800) => {
    bubbleText = text;
    bubbleVisible = true;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { bubbleVisible = false; }, ms);
  };

  const spawnParticle = (kind: ParticleState['kind'], x: number, y: number) => {
    // eslint-disable-next-line functional/no-conditional-statements -- Cap simultaneous SVG particle count for steady 60fps rendering.
    if (particles.length > 24) return;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
    const speed = kind === 'zzz' ? 22 : 45 + Math.random() * 55;
    const item: ParticleState = {
      id: nextParticleId,
      kind,
      fill: kind === 'star' ? (Math.random() > 0.5 ? '#f9e4af' : '#d2e7b9') : '#f4b8b1',
      x,
      y,
      vx: kind === 'zzz' ? 12 + Math.random() * 10 : Math.cos(angle) * speed,
      vy: kind === 'zzz' ? -26 : Math.sin(angle) * speed - (kind === 'star' ? 35 : 10),
      life: 0,
      maxLife: kind === 'zzz' ? 1.7 : 1.05 + Math.random() * 0.4,
      rot: (Math.random() - 0.5) * 35,
      spin: (Math.random() - 0.5) * 120,
      scale: kind === 'zzz' ? 0.85 : 0.7 + Math.random() * 0.5,
      transform: `translate(${x.toFixed(1)}, ${y.toFixed(1)})`,
      opacity: '1',
    };
    nextParticleId += 1;
    particles = [...Array.from(particles), item];
  };

  const advanceParticle = (p: ParticleState, dt: number): ParticleState | null => {
    const life = p.life + dt;
    // eslint-disable-next-line functional/no-conditional-statements -- Drop expired particles from the reactive pool.
    if (life >= p.maxLife) return null;
    const x = p.x + p.vx * dt + (p.kind === 'zzz' ? Math.sin(life * 4.5) * 12 * dt : 0);
    const y = p.y + p.vy * dt;
    const vy = p.vy + (p.kind === 'star' ? 95 * dt : 0);
    const rot = p.rot + p.spin * dt;
    const t = life / p.maxLife;
    const alpha = t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.8);
    const sc = p.scale * (t < 0.25 ? lerp(0.4, 1.15, t / 0.25) : lerp(1.15, 0.85, (t - 0.25) / 0.75));
    return {
      ...p,
      x,
      y,
      vy,
      life,
      rot,
      transform: `translate(${x.toFixed(1)}, ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${sc.toFixed(2)})`,
      opacity: alpha.toFixed(2),
    };
  };

  const stepParticles = (dt: number) => {
    // eslint-disable-next-line functional/no-conditional-statements -- Skip particle allocation when no particles are active.
    if (!particles.length) return;
    particles = Array.from(particles)
      .map((p): ParticleState | null => advanceParticle(p, dt))
      .filter((p): p is ParticleState => p !== null);
  };

  const triggerCelebrateMotion = (evolved: boolean, message: string) => {
    celebrateTimer = evolved ? 1.45 : 0.95;
    stretch = { ...stretch, v: stretch.v + 5.4 };
    posY = { ...posY, v: posY.v - 220 };
    tilt = { ...tilt, v: tilt.v + (Math.random() > 0.5 ? 1 : -1) * 160 };
    petalStretches = Array.from(petalStretches).map((sp): SpringState => ({ ...sp, v: sp.v + 2.6 }));
    petalAngles = Array.from(petalAngles).map((sp, i): SpringState => ({ ...sp, v: sp.v + (i % 2 === 0 ? 1 : -1) * 90 }));
    const count = evolved ? 14 : 8;
    Array.from({ length: count }).forEach(() => {
      spawnParticle('star', 160 + (Math.random() - 0.5) * 80, 115 + (Math.random() - 0.5) * 40);
    });
    void (evolved && (growthScale = { x: 0.68, v: 6.2, target: 1 }));
    showBubble(message, evolved ? 2600 : 1900);
  };

  // eslint-disable-next-line functional/functional-parameters -- Triggered directly by pointer tap completion inside the animation rig.
  const triggerPoke = () => {
    pokeTimer = 0.35;
    stretch = { ...stretch, x: -0.32, v: 3.8 };
    posY = { ...posY, x: posY.x + 10 };
    tilt = { ...tilt, v: tilt.v + (Math.random() - 0.5) * 140 };
    petalStretches = Array.from(petalStretches).map((sp): SpringState => ({ ...sp, v: sp.v + 1.9 }));
    petalAngles = Array.from(petalAngles).map((sp): SpringState => ({ ...sp, v: sp.v + (Math.random() - 0.5) * 110 }));
    void (
      napping ? (showBubble('Mmm... cozy nap...', 1500), spawnParticle('zzz', 195, 78))
        : fatigue > 72 ? (showBubble('Mmm... sleepy squish...', 1500), spawnParticle('zzz', 195, 78))
        : fatigue > 45 ? showBubble('Phew! Doing great today!', 1500)
        : (showBubble('Hehe, that tickles!', 1500), spawnParticle('star', 160 + (Math.random() - 0.5) * 50, 75))
    );
  };

  // eslint-disable-next-line functional/functional-parameters -- Triggered directly by hover or touch rubbing inside the animation rig.
  const triggerPet = () => {
    petTimer = 1.25;
    stretch = { ...stretch, v: stretch.v + 1.6 };
    tilt = { ...tilt, v: tilt.v + Math.sin(animTime * 4) * 55 };
    spawnParticle('heart', 160 + (Math.random() - 0.5) * 60, 72);
    spawnParticle('heart', 160 + (Math.random() - 0.5) * 60, 82);
    showBubble(fatigue > 65 ? 'Cozy head pats~ 💕' : 'Yay! Best friends! 💕', 1600);
  };

  let prevStageNum = untrack(() => stage.stage);
  let lastCelebrateNonce = untrack(() => celebrateNonce);
  let lastRestNonce = untrack(() => restNonce);

  $effect(() => {
    const currentStage = stage.stage;
    const evolved = currentStage > prevStageNum;
    prevStageNum = currentStage;
    const msg = celebrateMessage;
    // eslint-disable-next-line functional/no-conditional-statements -- Trigger one-shot celebration impulse when the parent increments celebrateNonce.
    if (celebrateNonce > lastCelebrateNonce) {
      lastCelebrateNonce = celebrateNonce;
      untrack(() => triggerCelebrateMotion(evolved, evolved ? `Evolved to Stage ${currentStage}! 🎉` : msg || 'Goal complete! 🌟'));
    }
  });

  $effect(() => {
    // eslint-disable-next-line functional/no-conditional-statements -- Trigger one-shot refresh impulse when the parent increments restNonce.
    if (restNonce > lastRestNonce) {
      lastRestNonce = restNonce;
      untrack(() => {
        petTimer = 1.0;
        stretch = { ...stretch, v: stretch.v + 2.2 };
        spawnParticle('heart', 148, 78);
        spawnParticle('star', 175, 76);
        showBubble('Ahhh, refreshed! 🍵', 1800);
      });
    }
  });

  // eslint-disable-next-line functional/prefer-immutable-types -- Convert native pointer event coordinates to SVG viewBox space.
  const localSvgCoords = (evt: PointerEvent): Readonly<{ x: number; y: number }> => {
    const rect: Readonly<DOMRectReadOnly> = touchAreaEl.getBoundingClientRect();
    const nx = ((evt.clientX - rect.left) / Math.max(1, rect.width)) * 320 - 160;
    const ny = ((evt.clientY - rect.top) / Math.max(1, rect.height)) * 230 - 124;
    return { x: nx, y: ny };
  };

  // eslint-disable-next-line functional/prefer-immutable-types -- Capture native pointer start for squish drag interaction.
  const onPointerDown = (evt: PointerEvent) => {
    const pt = localSvgCoords(evt);
    pointerActive = true;
    pointerX = pt.x;
    pointerY = pt.y;
    dragging = true;
    dragStartX = pt.x - posX.x;
    dragStartY = pt.y - posY.x;
    lastMoveX = pt.x;
    lastMoveY = pt.y;
    petDistance = 0;
    touchAreaEl.setPointerCapture(evt.pointerId);
  };

  // eslint-disable-next-line functional/prefer-immutable-types -- Track native pointer movement for gaze tracking, petting, and dragging.
  const onPointerMove = (evt: PointerEvent) => {
    const pt = localSvgCoords(evt);
    pointerActive = true;
    pointerX = pt.x;
    pointerY = pt.y;
    const dist = Math.hypot(pt.x - lastMoveX, pt.y - lastMoveY);
    lastMoveX = pt.x;
    lastMoveY = pt.y;

    void (dragging ? (
      posX = { ...posX, target: clamp(-48, 48, pt.x - dragStartX) },
      posY = { ...posY, target: clamp(-38, 34, pt.y - dragStartY) },
      stretch = { ...stretch, target: clamp(-0.22, 0.25, -clamp(-38, 34, pt.y - dragStartY) * 0.005) },
      tilt = { ...tilt, target: clamp(-20, 20, clamp(-48, 48, pt.x - dragStartX) * 0.35) },
      petDistance += dist
    ) : Math.hypot(pt.x, pt.y) < 65 && (
      petDistance += dist,
      petDistance > 160 && (petDistance = 0, triggerPet())
    ));
  };

  // eslint-disable-next-line functional/prefer-immutable-types -- Release native pointer capture and trigger poke/pet reaction on lift.
  const onPointerEnd = (evt: PointerEvent) => {
    // eslint-disable-next-line functional/no-conditional-statements -- Ignore releases when no pointer drag is active.
    if (!dragging) return;
    dragging = false;
    void (touchAreaEl.hasPointerCapture(evt.pointerId) && touchAreaEl.releasePointerCapture(evt.pointerId));
    void (petDistance < 14 ? triggerPoke() : petDistance > 150 && triggerPet());
  };

  // eslint-disable-next-line functional/prefer-immutable-types -- Reset hover gaze when pointer leaves the mascot canvas.
  const onPointerLeave = (_evt: PointerEvent) => {
    void _evt;
    void (!dragging && (pointerActive = false));
  };

  onMount(() => {
    // eslint-disable-next-line functional/prefer-immutable-types -- Track OS reduced-motion preference dynamically.
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = media.matches;
    // eslint-disable-next-line functional/prefer-immutable-types -- React to OS reduced-motion media query updates.
    const onMotionChange = (_evt: MediaQueryListEvent) => { void _evt; reducedMotion = media.matches; };
    media.addEventListener('change', onMotionChange);

    let lastTs = performance.now();
    let frameId = 0;

    const frame = (ts: number) => {
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;
      animTime += dt;

      const fNorm = clamp(0, 1, fatigue / 100);
      const stageNum = stage.stage;
      const feel = SPRING_FEELS[springFeel];
      const motionMul = reducedMotion ? 0.2 : 1;

      void (!napping && (
        blinkTimer -= dt,
        blinkTimer <= 0 && !blinking && (blinking = true, blinkPhase = 0),
        blinking && (
          blinkPhase += dt * lerp(5.8, 3.2, fNorm),
          blinkPhase >= 1 && (blinking = false, blinkTimer = lerp(2.8, 1.4, fNorm) + Math.random() * 2.3)
        )
      ));

      void (fatigue > 58 && !yawning && !dragging && celebrateTimer <= 0 && (
        yawnTimer -= dt,
        yawnTimer <= 0 && (yawning = true, yawnPhase = 0, yawnTimer = lerp(11, 4.8, (fatigue - 58) / 42) + Math.random() * 3)
      ));
      void (yawning && (
        yawnPhase += dt * 0.45,
        yawnPhase >= 1 && (yawning = false, yawnPhase = 0)
      ));

      void ((napping || fatigue >= 76) && (
        zzzTimer -= dt,
        zzzTimer <= 0 && (spawnParticle('zzz', 196, 78 + fNorm * 14), zzzTimer = napping ? 0.75 : lerp(2.4, 1.1, (fatigue - 76) / 24))
      ));

      celebrateTimer = Math.max(0, celebrateTimer - dt);
      petTimer = Math.max(0, petTimer - dt);
      pokeTimer = Math.max(0, pokeTimer - dt);

      const breathFreq = lerp(2.7, 1.35, fNorm);
      const breathWave = Math.sin(animTime * breathFreq);
      const bounceWave = Math.abs(Math.sin(animTime * lerp(3.4, 1.1, fNorm)));
      const fatigueSagY = (napping ? 20 : lerp(0, 16, Math.pow(fNorm, 1.3))) * motionMul;
      const fatigueSquash = napping ? -0.11 : lerp(0, -0.09, fNorm);
      const idleHopY = napping || dragging ? 0 : -bounceWave * lerp(9, 1.2, fNorm) * motionMul;
      const yawnEnv = yawning ? Math.sin(yawnPhase * Math.PI) : 0;

      void (!dragging && (
        posX = { ...posX, target: Math.sin(animTime * lerp(1.5, 0.7, fNorm)) * lerp(3.5, 1.2, fNorm) * motionMul },
        posY = { ...posY, target: fatigueSagY + idleHopY - (celebrateTimer > 0 ? Math.sin(celebrateTimer * 7) * 16 : 0) },
        tilt = {
          ...tilt,
          target: napping
            ? 8 + Math.sin(animTime * 1.1) * 2
            : Math.sin(animTime * lerp(1.9, 0.85, fNorm)) * lerp(4.2, 6.5, fNorm) * motionMul
              + (pointerActive ? clamp(-10, 10, pointerX * 0.08) : 0),
        }
      ));

      stretch = {
        ...stretch,
        target: fatigueSquash + breathWave * lerp(0.032, 0.05, fNorm) * motionMul + yawnEnv * 0.09,
      };
      growthScale = { ...growthScale, target: 1 };

      gazeX = {
        ...gazeX,
        target: pointerActive && !napping
          ? clamp(-6.2, 6.2, pointerX * 0.065)
          : Math.sin(animTime * 0.8) * lerp(3.5, 1.2, fNorm),
      };
      gazeY = {
        ...gazeY,
        target: pointerActive && !napping
          ? clamp(-5.0, 5.5, pointerY * 0.065 + fNorm * 2.2)
          : lerp(-0.5, 3.2, fNorm) + Math.cos(animTime * 0.55) * 1.2,
      };

      const blinkVal = !blinking ? 0
        : blinkPhase < 0.35 ? blinkPhase / 0.35
        : 1 - (blinkPhase - 0.35) / 0.65;
      const fatigueDroop = napping ? 1 : clamp(0, 0.72, Math.pow(fNorm, 1.45) * 0.72);
      eyelid = { ...eyelid, target: Math.max(blinkVal, fatigueDroop, yawnEnv * 0.78) };
      happyEye = { ...happyEye, target: (petTimer > 0 || celebrateTimer > 0.3) && !napping ? 1 : 0 };
      yawnOpen = { ...yawnOpen, target: yawnEnv };

      const stK = dragging ? feel.k * 1.6 : feel.k;
      const stD = dragging ? feel.d * 1.2 : feel.d;
      posX = stepSpringValue(posX, stK, stD, dt);
      posY = stepSpringValue(posY, stK, stD, dt);
      stretch = stepSpringValue(stretch, feel.k, feel.d, dt);
      tilt = stepSpringValue(tilt, feel.k * 0.85, feel.d, dt);
      gazeX = stepSpringValue(gazeX, 160, 18, dt);
      gazeY = stepSpringValue(gazeY, 160, 18, dt);
      eyelid = stepSpringValue(eyelid, 280, 22, dt);
      happyEye = stepSpringValue(happyEye, 220, 18, dt);
      yawnOpen = stepSpringValue(yawnOpen, 180, 16, dt);
      growthScale = stepSpringValue(growthScale, 200, 14, dt);

      const basePetalAngles: Readonly<ArrayLike<number>> = stageNum === 2 ? [-135, -45, 45, 135, 198] : [-90, -18, 54, 126, 198];
      const petalDist = stageNum === 2 ? 33 : stageNum === 3 ? 40 : 42;
      const petalRx = stageNum === 2 ? 23 : stageNum === 3 ? 27 : 29;
      const petalRy = stageNum === 2 ? 25 : stageNum === 3 ? 31 : 33;

      const updatedAngles: Readonly<ArrayLike<SpringState>> = [0, 1, 2, 3, 4].map((i): SpringState => {
        const base = basePetalAngles[i] ?? -90;
        const droopSign = stageNum === 2
          ? (i === 1 || i === 2 ? 1 : -1)
          : i === 0 ? (Math.sin(animTime * 1.1) > 0 ? 1 : -1)
          : i === 1 || i === 2 ? 1 : -1;
        const droopDeg = droopSign * fNorm * (i === 0 && stageNum !== 2 ? 7 : 14);
        const swayDeg = Math.sin(animTime * lerp(2.4, 1.2, fNorm) + i * 1.15) * lerp(3.5, 1.8, fNorm) * motionMul;
        const velDrag = clamp(-18, 18, -posX.v * 0.025 + posY.v * 0.015 * droopSign);
        const cur = petalAngles[i] ?? springInit(base);
        return stepSpringValue({ ...cur, target: base + droopDeg + swayDeg + velDrag }, feel.petalK, feel.petalD, dt);
      });
      const updatedStretches: Readonly<ArrayLike<SpringState>> = [0, 1, 2, 3, 4].map((i): SpringState => {
        const cur = petalStretches[i] ?? springInit(0);
        return stepSpringValue({ ...cur, target: breathWave * 0.04 * motionMul - fNorm * 0.04 }, feel.petalK, feel.petalD, dt);
      });
      petalAngles = updatedAngles;
      petalStretches = updatedStretches;

      petalShapes = [0, 1, 2, 3, 4].map((i): PetalRender => {
        const ang = updatedAngles[i] ?? springInit(-90);
        const str = updatedStretches[i] ?? springInit(0);
        const rad = ang.x * Math.PI / 180;
        const dist = petalDist * (1 + str.x * 0.7);
        const cx = Math.cos(rad) * dist;
        const cy = Math.sin(rad) * dist;
        return {
          rx: (petalRx * (1 - str.x * 0.45)).toFixed(2),
          ry: (petalRy * (1 + str.x * 0.65)).toFixed(2),
          transform: `translate(${cx.toFixed(2)}, ${cy.toFixed(2)}) rotate(${(ang.x + 90).toFixed(2)})`,
          visible: stageNum >= 2 && (stageNum !== 2 || i < 4),
        };
      });

      const s = clamp(-0.35, 0.4, stretch.x);
      const scaleY = (1 + s) * growthScale.x;
      const scaleX = (1 / (1 + s * 0.82)) * growthScale.x;
      const skewX = clamp(-12, 12, -posX.v * 0.018);

      rootTransform = `translate(${(160 + posX.x).toFixed(2)}, ${(128 + posY.x).toFixed(2)}) rotate(${tilt.x.toFixed(2)}) skewX(${skewX.toFixed(2)}) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;

      const lift = Math.max(0, -posY.x);
      shadowRx = (64 * clamp(0.65, 1.32, (1 - lift * 0.008) * (1 + Math.max(0, -s) * 0.6))).toFixed(1);
      shadowOpacity = clamp(0.06, 0.24, 0.16 - lift * 0.002 + fNorm * 0.04).toFixed(2);
      shadowCx = (160 + posX.x * 0.6).toFixed(1);

      const w = 48 + Math.max(0, -s) * 14;
      const h = 43 + s * 10;
      budD = `M 0 ${-h} C ${w * 0.72} ${-h} ${w} ${-h * 0.1} ${w * 0.88} ${h * 0.58} C ${w * 0.75} ${h} ${-w * 0.75} ${h} ${-w * 0.88} ${h * 0.58} C ${-w} ${-h * 0.1} ${-w * 0.72} ${-h} 0 ${-h} Z`;

      const droop = fNorm * 14 + Math.sin(animTime * 2.2) * 5;
      sproutLTransform = `rotate(${(-droop).toFixed(1)} 0 -43)`;
      sproutRTransform = `rotate(${droop.toFixed(1)} 0 -43)`;
      const lSway = Math.sin(animTime * 2) * 5 + fNorm * 10;
      leafLTransform = `rotate(${(-lSway).toFixed(1)} -20 30)`;
      leafRTransform = `rotate(${lSway.toFixed(1)} 20 30)`;

      radiantOpacity = stageNum === 4 ? (0.42 + Math.sin(animTime * 2) * 0.14).toFixed(2) : '0';
      haloTransform = `rotate(${(animTime * 8).toFixed(2)})`;
      crownTransform = `translate(0, ${(Math.sin(animTime * 2.6) * 2.2).toFixed(2)})`;

      faceTransform = `translate(${(gazeX.x * 0.55).toFixed(2)}, ${(-4 + gazeY.x * 0.35 + fNorm * 3.5).toFixed(2)})`;
      cheekOpacity = clamp(0.38, 0.85, 0.45 + fNorm * 0.22 + (petTimer > 0 ? 0.32 : 0)).toFixed(2);
      happyEyeActive = clamp(0, 1, happyEye.x) > 0.55;
      pupilTransform = `translate(${gazeX.x.toFixed(2)}, ${(1.5 + gazeY.x).toFixed(2)})`;

      const lidClose = clamp(0, 1, eyelid.x);
      const lidY = lerp(-26, 26, lidClose);
      const lidCurve = lerp(4, 2, lidClose);
      eyelidD = `M -22 -28 H 22 V ${lidY.toFixed(2)} Q 0 ${(lidY + lidCurve).toFixed(2)} -22 ${lidY.toFixed(2)} Z`;
      sleepLidOpacity = clamp(0, 1, (lidClose - 0.78) / 0.18).toFixed(2);

      lashPaths = Array.from(lashOffsets).map((lx) => {
        const x1 = lx * 0.85;
        const rimY = -22.2 * Math.sqrt(Math.max(0.12, 1 - Math.pow(x1 / 18, 2)));
        const activeLidY = lidClose > 0.78 ? 6.5 : Math.min(14, lidY);
        const y1 = Math.max(rimY, activeLidY);
        const x2 = lx * 1.18;
        const arch = Math.cos((lx / 14) * 1.1) * -2.5;
        const lashDeltaY = lerp(-(7.5 + arch), 5.5, clamp(0, 1, (lidClose - 0.25) / 0.65));
        const y2 = y1 + lashDeltaY;
        return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${((x1 + x2) / 2).toFixed(1)} ${(y2 - 1).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      });

      const yw = clamp(0, 1, yawnOpen.x);
      void (
        yw > 0.14 ? (
          mouthD = `M ${-(5.5 + yw * 4.5)} 25 A ${(5.5 + yw * 4.5).toFixed(1)} ${(3 + yw * 10).toFixed(1)} 0 1 0 ${(5.5 + yw * 4.5)} 25 A ${(5.5 + yw * 4.5).toFixed(1)} ${(3 + yw * 10).toFixed(1)} 0 1 0 ${-(5.5 + yw * 4.5)} 25 Z`,
          mouthFill = '#665c55'
        ) : pokeTimer > 0.08 ? (
          mouthD = 'M -4.5 26 A 4.5 4.5 0 1 0 4.5 26 A 4.5 4.5 0 1 0 -4.5 26 Z',
          mouthFill = '#665c55'
        ) : celebrateTimer > 0.2 || petTimer > 0.2 ? (
          mouthD = 'M -9.5 22 Q 0 24 9.5 22 C 8.5 34.5 -8.5 34.5 -9.5 22 Z',
          mouthFill = '#b86d6f'
        ) : napping ? (
          mouthD = 'M -5 25 Q 0 28 5 25',
          mouthFill = 'none'
        ) : (
          mouthD = `M ${-lerp(9, 6.5, fNorm)} 24 Q 0 ${lerp(33, 25.5, fNorm).toFixed(1)} ${lerp(9, 6.5, fNorm)} 24`,
          mouthFill = 'none'
        )
      );

      stepParticles(dt);
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    // eslint-disable-next-line functional/functional-parameters -- Component teardown cancels animation frame, toast timer, and media query listener.
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(bubbleTimer);
      media.removeEventListener('change', onMotionChange);
    };
  });
</script>

<!-- eslint-disable functional/functional-parameters -- Interactive buttons notify parent state handlers on click. -->
<section class="petal-stage" class:is-evening={isEvening} class:is-night={isNight} aria-label="Petal companion">
  <div class="sky-ambient" aria-hidden="true">
    <div class="sky-sun"></div>
    <div class="sky-stars">
      <span class="star s1">✦</span>
      <span class="star s2">✦</span>
      <span class="star s3">●</span>
    </div>
  </div>

  <div class="stage-header">
    <div class="stage-greeting">
      <p class="greeting-time">{greetingText}</p>
      <h2 class="mascot-headline">{headline}</h2>
    </div>
    <div class="stage-badges">
      <span class="stage-pill">
        <span aria-hidden="true">{stage.emoji}</span>
        <span>Stage {stage.stage} · {stage.name}</span>
      </span>
      <span class="streak-pill" title="Daily streak">
        <span aria-hidden="true">🔥</span>
        <span>{streak}d</span>
      </span>
    </div>
  </div>

  <div
    bind:this={touchAreaEl}
    class="mascot-canvas"
    role="application"
    aria-label="Interactive Petal mascot. Tap, rub, or drag to play."
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
    onpointerleave={onPointerLeave}
  >
    <span class="touch-hint">Poke, rub, or drag me!</span>
    <svg viewBox="0 0 320 230" class="petal-svg" role="img" aria-label={`Petal at stage ${stage.stage}, ${energy} percent energy`}>
      <defs>
        <clipPath id={clipEyeId}>
          <ellipse cx="0" cy="0" rx="17.5" ry="22.5" />
        </clipPath>
        <radialGradient id={petalGradId} cx="42%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#fbe1dd" />
          <stop offset="65%" stop-color="#f4b8b1" />
          <stop offset="100%" stop-color="#e7a49c" />
        </radialGradient>
        <radialGradient id={sproutGradId} cx="42%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#fbe3df" />
          <stop offset="100%" stop-color="#f4b8b1" />
        </radialGradient>
        <radialGradient id={haloGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fefbc0" stop-opacity="0.7" />
          <stop offset="70%" stop-color="#f9e4af" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#f9e4af" stop-opacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx={shadowCx} cy="198" rx={shadowRx} ry="12" fill="#755747" opacity={shadowOpacity} />
      <circle cx="160" cy="122" r="95" fill={`url(#${haloGradId})`} opacity={radiantOpacity} />

      <g transform={rootTransform}>
        {#if stage.stage === 2}
          <path d="M -28 24 C -62 12 -74 34 -54 48 C -38 54 -22 42 -20 30 Z" fill="#d2e7b9" stroke="#493f3c" stroke-width="3.5" stroke-linejoin="round" transform={leafLTransform} />
          <path d="M 28 24 C 62 12 74 34 54 48 C 38 54 22 42 20 30 Z" fill="#d2e7b9" stroke="#493f3c" stroke-width="3.5" stroke-linejoin="round" transform={leafRTransform} />
        {/if}

        {#if stage.stage === 4}
          <g opacity="0.92" transform={haloTransform}>
            {#each [0, 1, 2, 3, 4] as idx (idx)}
              {@const rad = (-90 + 36 + idx * 72) * Math.PI / 180}
              <circle cx={(Math.cos(rad) * 57).toFixed(1)} cy={(Math.sin(rad) * 57).toFixed(1)} r="24" fill="#f9e4af" stroke="#493f3c" stroke-width="3" />
            {/each}
          </g>
        {/if}

        <g>
          {#if stage.stage === 1}
            <path d={budD} fill="#493f3c" stroke="#493f3c" stroke-width="10" stroke-linejoin="round" />
          {:else}
            <circle cx="0" cy="0" r="44" fill="#493f3c" stroke="#493f3c" stroke-width="10" />
            {#each Array.from(petalShapes) as p, i (i)}
              {#if p.visible}
                <ellipse cx="0" cy="0" rx={p.rx} ry={p.ry} transform={p.transform} fill="#493f3c" stroke="#493f3c" stroke-width="10" />
              {/if}
            {/each}
          {/if}
        </g>

        <g>
          {#if stage.stage === 1}
            <path d={budD} fill={`url(#${sproutGradId})`} />
          {:else}
            <circle cx="0" cy="0" r="44" fill={`url(#${petalGradId})`} />
            {#each Array.from(petalShapes) as p, i (i)}
              {#if p.visible}
                <ellipse cx="0" cy="0" rx={p.rx} ry={p.ry} transform={p.transform} fill={`url(#${petalGradId})`} />
              {/if}
            {/each}
          {/if}
          <ellipse cx="-16" cy="-34" rx="14" ry="7" fill="#FFFFFF" opacity="0.2" transform="rotate(-20 -16 -34)" />
        </g>

        {#if stage.stage === 1}
          <path d="M 0 -43 C -8 -72 -34 -76 -36 -56 C -36 -40 -12 -38 0 -43 Z" fill="#d2e7b9" stroke="#493f3c" stroke-width="3.5" stroke-linejoin="round" transform={sproutLTransform} />
          <path d="M 0 -43 C 8 -72 34 -76 36 -56 C 36 -40 12 -38 0 -43 Z" fill="#e2f0cb" stroke="#493f3c" stroke-width="3.5" stroke-linejoin="round" transform={sproutRTransform} />
        {/if}

        {#if stage.stage === 4}
          <path d="M -16 -72 L -20 -90 L -7 -80 L 0 -96 L 7 -80 L 20 -90 L 16 -72 Z" fill="#f9e4af" stroke="#493f3c" stroke-width="3.2" stroke-linejoin="round" transform={crownTransform} />
        {/if}

        <ellipse cx="-35" cy="17" rx="10" ry="6" fill="#e79d9a" opacity={cheekOpacity} />
        <ellipse cx="35" cy="17" rx="10" ry="6" fill="#e79d9a" opacity={cheekOpacity} />

        <g transform={faceTransform}>
          {#each [-20.5, 20.5] as eyeX (eyeX)}
            <g transform={`translate(${eyeX}, -2)`}>
              {#if happyEyeActive}
                <path d="M -13 4 Q 0 -10 13 4" fill="none" stroke="#493f3c" stroke-width="3.8" stroke-linecap="round" />
              {:else}
                <ellipse cx="0" cy="0" rx="18" ry="23" fill="#FFFFFF" stroke="#493f3c" stroke-width="3.6" />
                <g clip-path={`url(#${clipEyeId})`}>
                  <g transform={pupilTransform}>
                    <ellipse cx="0" cy="0" rx="11.5" ry="15" fill="#493f3c" />
                    <circle cx="-4" cy="-5.2" r="3.8" fill="#FFFFFF" />
                    <circle cx="4.2" cy="4.6" r="1.8" fill="#FFFFFF" opacity="0.82" />
                  </g>
                  <path d={eyelidD} fill="#f0b1a9" stroke="#493f3c" stroke-width="3.2" stroke-linecap="round" />
                  <path d="M -15 4 Q 0 11 15 4" fill="none" stroke="#493f3c" stroke-width="3.2" stroke-linecap="round" opacity={sleepLidOpacity} />
                </g>
                <ellipse cx="0" cy="0" rx="18" ry="23" fill="none" stroke="#493f3c" stroke-width="3.6" />
                <g stroke="#493f3c" stroke-width="2.4" stroke-linecap="round" fill="none">
                  {#each Array.from(lashPaths) as lp, li (li)}
                    <path d={lp} />
                  {/each}
                </g>
              {/if}
            </g>
          {/each}
          <path d={mouthD} fill={mouthFill} stroke="#493f3c" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      </g>

      <!-- Declarative Svelte particle pool (zero direct DOM manipulation) -->
      <g>
        {#each Array.from(particles) as p (p.id)}
          <g transform={p.transform} opacity={p.opacity}>
            {#if p.kind === 'heart'}
              <path d="M0,3 C-4,-2 -9,2 -5,7 L0,12 L5,7 C9,2 4,-2 0,3 Z" fill="#f4b8b1" stroke="#493f3c" stroke-width="1.5" />
            {:else if p.kind === 'star'}
              <path d="M0,-8 L2.2,-2.2 L8,0 L2.2,2.2 L0,8 L-2.2,2.2 L-8,0 L-2.2,-2.2 Z" fill={p.fill} stroke="#493f3c" stroke-width="1.3" />
            {:else}
              <text x="0" y="0" font-size="15" font-weight="800" fill="#8c81a6" stroke="#FFFFFF" stroke-width="2.5" paint-order="stroke">z</text>
            {/if}
          </g>
        {/each}
      </g>
    </svg>

    <div class="speech-bubble" class:visible={bubbleVisible} aria-live="polite">{bubbleText}</div>
  </div>

  <div class="stage-meters">
    <div class="meter-card">
      <div class="meter-row">
        <span>🌱 Growth</span>
        <strong>{xpInfo.isMax ? `${xpInfo.current} XP · MAX` : `${xpInfo.current} / ${xpInfo.target}`}</strong>
      </div>
      <div class="meter-track"><div class="meter-fill growth-fill" style={`width:${xpInfo.percent}%`}></div></div>
    </div>

    <div class="meter-card">
      <div class="meter-row">
        <span>{fatigue >= 70 ? '🌙 Energy' : '⚡ Energy'}</span>
        <strong>{energy}%</strong>
      </div>
      <div class="meter-track"><div class="meter-fill" style={`width:${Math.max(4, energy)}%; background:${energyColor}`}></div></div>
    </div>
  </div>

  <div class="stage-footer">
    <p class="fatigue-note">
      {mood === 'napping' ? 'Cozy nap in progress' : `${doneCount} / ${totalCount} goals today · Effort ${effortPoints} pts`}
    </p>
    <div class="stage-actions">
      <div class="feel-pills" role="group" aria-label="Animation bounce feel">
        {#each Object.entries(SPRING_FEELS) as [key, preset] (key)}
          <button
            type="button"
            class="feel-chip"
            class:chosen={springFeel === key}
            disabled={busy}
            onclick={() => onchangefeel(key as SpringFeel)}
          >{preset.label}</button>
        {/each}
      </div>
      <button type="button" class="rest-pill" disabled={busy} onclick={onbreather}>🍵 Breather</button>
      <button type="button" class="rest-pill" class:is-napping={napping} disabled={busy} onclick={ontogglenap}>
        {napping ? '☀️ Wake up' : '💤 Nap'}
      </button>
    </div>
  </div>
</section>
<!-- eslint-enable functional/functional-parameters -->

<style>
  .petal-stage {
    position: relative;
    overflow: hidden;
    border-radius: 30px;
    border: 2px solid color-mix(in srgb, var(--pastel-pink) 55%, var(--border));
    background: linear-gradient(180deg, var(--canvas) 0%, var(--surface-pink) 100%);
    padding: 16px 18px 14px;
    box-shadow: 0 12px 28px var(--shadow-soft);
    user-select: none;
    transition: background 0.6s ease;
  }
  .petal-stage.is-evening {
    background: linear-gradient(180deg, #fff6ec 0%, #fceee4 100%);
  }
  .petal-stage.is-night {
    background: linear-gradient(180deg, var(--surface-lavender) 0%, var(--surface-pink) 100%);
  }
  .sky-ambient {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .sky-sun {
    position: absolute;
    top: -28px;
    right: -28px;
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--pastel-lemon) 0%, color-mix(in srgb, var(--pastel-lemon) 0%, transparent) 72%);
    opacity: 0.65;
    transition: opacity 0.6s ease;
  }
  .is-evening .sky-sun { opacity: 0.35; }
  .is-night .sky-sun { opacity: 0; }
  .sky-stars {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.6s ease;
  }
  .is-evening .sky-stars { opacity: 0.3; }
  .is-night .sky-stars { opacity: 1; }
  .star { position: absolute; font-size: 12px; color: var(--pastel-apricot); }
  .s1 { top: 18px; left: 26px; }
  .s2 { top: 34px; right: 44px; font-size: 10px; }
  .s3 { top: 60px; left: 56px; font-size: 9px; color: var(--pastel-lavender); }

  .stage-header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .greeting-time {
    margin: 0;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.9px;
    color: var(--text-muted);
  }
  .mascot-headline {
    margin: 2px 0 0;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.5px;
    line-height: 1.25;
  }
  .stage-badges {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stage-pill, .streak-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(73, 63, 60, 0.1);
  }
  .streak-pill {
    background: var(--surface-pink);
    color: var(--rose-ink);
    border-color: var(--pastel-pink);
    font-variant-numeric: tabular-nums;
  }

  .mascot-canvas {
    position: relative;
    z-index: 2;
    height: 215px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    touch-action: none;
  }
  .mascot-canvas:active { cursor: grabbing; }
  .touch-hint {
    position: absolute;
    top: 6px;
    right: 0;
    font-size: 10px;
    font-weight: 800;
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.7);
    padding: 3px 9px;
    border-radius: 999px;
    pointer-events: none;
  }
  .petal-svg {
    width: 100%;
    height: 100%;
    max-width: 340px;
    overflow: visible;
  }
  .speech-bubble {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translate(-50%, 6px);
    opacity: 0;
    pointer-events: none;
    padding: 5px 13px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(73, 63, 60, 0.12);
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
    box-shadow: 0 4px 12px var(--shadow-soft);
    transition: opacity 0.22s ease, transform 0.22s ease;
  }
  .speech-bubble.visible {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  .stage-meters {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 2px;
  }
  .meter-card {
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(73, 63, 60, 0.08);
    border-radius: 16px;
    padding: 8px 12px;
  }
  .meter-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    font-weight: 800;
    color: var(--text-secondary);
    margin-bottom: 5px;
  }
  .meter-row strong {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .meter-track {
    height: 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 35%, var(--surface));
    overflow: hidden;
  }
  .meter-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.4s ease, background-color 0.4s ease;
  }
  .growth-fill {
    background: var(--pastel-green);
  }

  .stage-footer {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .fatigue-note {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
  }
  .stage-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .feel-pills {
    display: inline-flex;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(73, 63, 60, 0.1);
    border-radius: 999px;
    padding: 2px;
    gap: 2px;
  }
  .feel-chip {
    border: 0;
    background: none;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    color: var(--text-muted);
  }
  .feel-chip.chosen {
    background: var(--surface);
    color: var(--rose-ink);
    box-shadow: 0 1px 3px var(--shadow-soft);
  }
  .rest-pill {
    border: 1px solid rgba(73, 63, 60, 0.14);
    background: var(--surface);
    padding: 5px 11px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    transition: transform 0.12s ease;
  }
  .rest-pill:hover:not(:disabled) { transform: translateY(-1px); }
  .rest-pill.is-napping {
    background: var(--surface-lavender);
    border-color: var(--pastel-lavender);
    color: var(--lavender-ink);
  }

  @media (max-width: 600px) {
    .petal-stage { padding: 14px 14px 12px; border-radius: 26px; }
    .mascot-headline { font-size: 18px; }
    .mascot-canvas { height: 192px; }
    .touch-hint { display: none; }
    .stage-footer { flex-direction: column; align-items: stretch; }
    .stage-actions { justify-content: space-between; }
  }
  @media (prefers-reduced-motion: reduce) {
    .petal-stage, .sky-sun, .sky-stars, .meter-fill, .speech-bubble { transition: none; }
  }
</style>

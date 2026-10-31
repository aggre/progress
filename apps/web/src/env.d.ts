import 'astro/client';

/* eslint-disable functional/type-declaration-immutability, functional/no-mixed-types, functional/prefer-immutable-types -- Extend native browser types with the single-use installation event, its completion Promise, and shared mutable prompt state. */
declare global {
  interface BrowserInstallPrompt extends Event {
    readonly prompt: () => Promise<void>;
    readonly userChoice: Promise<Readonly<{ outcome: 'accepted' | 'dismissed' }>>;
  }
  interface Window {
    readonly littleInstall: { prompt: BrowserInstallPrompt | null; installed: boolean };
  }
  interface Navigator {
    readonly standalone?: boolean;
  }
}
/* eslint-enable functional/type-declaration-immutability, functional/no-mixed-types, functional/prefer-immutable-types */

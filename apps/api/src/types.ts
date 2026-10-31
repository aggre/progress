import type { Identity } from '@little/shared/api';
// eslint-disable-next-line functional/type-declaration-immutability -- Cloudflare injects the native mutable D1 handle as a Worker binding.
export type ApiBindings = Pick<Env,'DB'> & Partial<Pick<Env,'VAPID_PUBLIC_KEY'|'VAPID_PRIVATE_KEY'|'VAPID_SUBJECT'>> & { FRONTEND_ORIGIN: string; APP_BASE_URL: string };
// eslint-disable-next-line functional/type-declaration-immutability -- Hono carries the native Worker bindings and per-request context variables in its environment contract.
export interface AppEnv { Bindings: ApiBindings; Variables: { identity: Identity; sessionHash: string } }

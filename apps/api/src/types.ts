import type { Identity } from '@little/shared/api';
export type ApiBindings = Pick<Env,'DB'> & { FRONTEND_ORIGIN: string; APP_BASE_URL: string };
export interface AppEnv { Bindings: ApiBindings; Variables: { identity: Identity; sessionHash: string } }

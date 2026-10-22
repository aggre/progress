import type { ScheduleEvent } from './events';

export interface User { id: string; username: string; familyId: string; }
export interface Family { readonly id: string; readonly name: string; }
export interface Identity { user: User; family: Family; }
export interface ScheduleRecord extends ScheduleEvent {
  createdBy: Pick<User, 'id' | 'username'>;
  canEdit: boolean;
}
export interface LoginChallenge {
  readonly id: string;
  readonly pollToken: string;
  readonly sessionToken: string;
  readonly approvalToken: string;
  readonly expiresAt: number; // Unix milliseconds.
  readonly pollInterval: number; // Milliseconds, minimum interval.
  readonly verificationCode: string;
}
export interface PendingApproval { readonly username: string; readonly verificationCode: string; readonly expiresAt: number; }
export type LoginStatus = Readonly<{ status: 'pending' | 'approved' | 'expired' }>;
// Public: POST /api/auth/challenges { username } -> LoginChallenge.
// POST /api/auth/challenges/:id/poll { pollToken } -> LoginStatus.
// Authenticated: POST /api/auth/challenges/:id/inspect { approvalToken } -> PendingApproval.
// POST /api/auth/challenges/:id/approve { approvalToken } -> { status: 'approved' }.
// The QR URL fragment is #approve=<id>.<approvalToken>; never include poll/session tokens.
// Bearer sessionToken activates only after family approval or operator bootstrap.
// GET /api/me -> Identity; POST /api/auth/logout -> { ok: true }.
// GET /api/family -> { family: Family, members: User[] }.
// POST /api/family/members { username } -> { user: User }.
// Schedules use /api/schedules and /api/schedules/:id.
// Family members can read each other's schedules; only the creator can edit or delete.

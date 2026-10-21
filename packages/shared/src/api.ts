import type { ScheduleEvent } from './events';

export interface User { id: string; username: string; familyId: string; }
export interface Family { id: string; name: string; }
export interface Identity { user: User; family: Family; }
export interface ScheduleRecord extends ScheduleEvent {
  createdBy: Pick<User, 'id' | 'username'>;
  canEdit: boolean;
}
export interface LoginChallenge {
  id: string;
  pollToken: string;
  sessionToken: string;
  approvalToken: string;
  expiresAt: number; // Unix milliseconds.
  pollInterval: number; // Milliseconds, minimum interval.
  verificationCode: string;
}
export interface PendingApproval { username: string; verificationCode: string; expiresAt: number; }
export type LoginStatus = { status: 'pending' | 'approved' | 'expired' };
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

'use server';

import { redirect } from 'next/navigation';
import { accessTtlMs, config } from '@/config';
import { checkEmail, seatCapDay, verifyToken } from '@/invite/link';
import { ensureSingletonsRunning, requestSeat, workflowIdForEmail } from '@/temporal/client';

export interface InviteFormState {
  status: 'idle' | 'error';
  message?: string;
}

export async function requestAccess(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const token = String(formData.get('k') ?? '');
  if (!verifyToken(token)) {
    return {
      status: 'error',
      message: 'That link is not valid. Ask your instructor for the workshop link.',
    };
  }

  const check = checkEmail(String(formData.get('email') ?? ''));
  if (!check.ok) {
    const messages: Record<typeof check.reason, string> = {
      malformed: "That doesn't look like an email address.",
      'domain-blocked':
        'That email domain is blocked for this workshop. Please use your work email address.',
      'domain-not-allowed': 'That email domain is not on the allow list for this workshop.',
      'no-domains-configured':
        'No email domains are configured, so nobody can be invited. Grab your instructor — ' +
        'PORTAL_ALLOWED_EMAIL_DOMAINS needs a value (use * to allow any domain).',
    };
    return { status: 'error', message: messages[check.reason] };
  }

  const cfg = config();

  // The registry may not have been started yet if the web process came up first.
  await ensureSingletonsRunning();

  const decision = await requestSeat({
    email: check.email,
    workflowId: workflowIdForEmail(check.email),
    day: seatCapDay(),
    ttlMs: accessTtlMs(),
    seatCap: cfg.PORTAL_DAILY_SEAT_CAP,
  });

  if (!decision.granted) {
    return {
      status: 'error',
      message:
        decision.reason === 'seat-cap-reached'
          ? `Today's seat limit (${cfg.PORTAL_DAILY_SEAT_CAP}) has been reached. Grab your instructor.`
          : `Could not start your invitation: ${decision.detail ?? 'unknown error'}`,
    };
  }

  // redirect() signals via an exception — it must not sit inside a try/catch.
  redirect(
    `/session/1?k=${encodeURIComponent(token)}&e=${encodeURIComponent(check.email)}` +
      `&granted=${decision.alreadyHadAccess ? 'existing' : 'new'}`,
  );
}

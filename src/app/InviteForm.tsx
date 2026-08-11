'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { requestAccess, type InviteFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>
      {pending ? 'Requesting…' : 'Request access'}
    </button>
  );
}

export function InviteForm({
  token,
  allowedDomains,
  blockedDomains,
}: {
  token: string;
  allowedDomains: string[];
  blockedDomains: string[];
}) {
  const [state, action] = useActionState<InviteFormState, FormData>(requestAccess, {
    status: 'idle',
  });

  return (
    <form action={action} className="card p-6 sm:p-7">
      <input type="hidden" name="k" value={token} />

      <label htmlFor="email" className="label mb-2 block">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="input"
      />

      {allowedDomains.length > 0 && !allowedDomains.includes('*') && (
        <p className="mt-2 text-xs text-content-subtle">
          Limited to {allowedDomains.map((d) => `@${d}`).join(', ')}.
        </p>
      )}

      {blockedDomains.length > 0 && (
        <p className="mt-2 text-xs text-content-subtle">
          {blockedDomains.map((d) => `@${d}`).join(', ')} cannot be used — choose a different email.
        </p>
      )}

      {state.status === 'error' && (
        <p className="mt-4 rounded-lg border border-danger-border/30 bg-danger/[0.08] px-3.5 py-2.5 text-sm text-danger">
          {state.message}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Submit />
        <p className="text-xs leading-5 text-content-subtle">
          Temporal Cloud emails the invitation directly — check your inbox, including spam.
        </p>
      </div>
    </form>
  );
}

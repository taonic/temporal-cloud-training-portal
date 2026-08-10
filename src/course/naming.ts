/**
 * Per-student resource names, derived from the email so they are stable across
 * page loads and predictable for the grader — and so the sweeper's prefix
 * convention holds for everything a lab creates, not just namespaces.
 */

/** Cloud namespace names are capped at 39 characters. */
const NAMESPACE_MAX = 39;

export function studentSlug(email: string): string {
  const local = email.split('@')[0] ?? 'student';
  return (
    local
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'student'
  );
}

export function labNamespaceName(email: string, prefix: string): string {
  return `${prefix}${studentSlug(email)}`.slice(0, NAMESPACE_MAX);
}

export function labServiceAccountName(email: string, prefix: string): string {
  return `${prefix}${studentSlug(email)}-worker`;
}

export function labGroupName(email: string, prefix: string): string {
  return `${prefix}${studentSlug(email)}-operators`;
}

/**
 * Task queue and deployment names are the same for everyone: each student has
 * their own namespace, so there is nothing to collide with, and identical names
 * mean the commands on the page are identical to the ones in `labs/worker`.
 */
export const LAB_TASK_QUEUE = 'training-starter';
export const LAB_DEPLOYMENT_NAME = 'training-workers';
export const LAB_BUILD_ID_V1 = '1.0';
export const LAB_BUILD_ID_V2 = '2.0';

export function labMetricsAccountName(email: string, prefix: string): string {
  return `${prefix}${studentSlug(email)}-metrics`;
}

/** Custom role names allow letters, numbers, hyphens and underscores, max 64. */
export function labCustomRoleName(email: string, prefix: string): string {
  return `${prefix}${studentSlug(email)}-worker-role`.slice(0, 64);
}

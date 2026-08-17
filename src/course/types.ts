import type {
  CloudApiKey,
  CloudAuditLogRecord,
  CloudConnectivityRule,
  CloudCustomRole,
  CloudNamespace,
  CloudServiceAccount,
  CloudUser,
  CloudUserGroup,
} from '@/cloud/types';
import type { NamespaceReader } from '@/cloud/dataplane';
import type { SnippetLang } from '@/lib/highlight';

export type CheckpointStatus = 'pass' | 'fail' | 'blocked';

export interface CheckpointDef {
  id: string;
  title: string;
  detail: string;
  /**
   * True when the Cloud Ops API exposes no evidence for the claim and the
   * checkpoint trusts the student. Always surfaced in the UI — a grader that
   * implies it verified something it did not is worse than one that admits it.
   */
  selfAttested?: boolean;
  /**
   * Stretch goals. Excluded from the verified count so a student who skipped
   * one doesn't read as having failed the session.
   */
  optional?: boolean;
}

export interface CheckpointResult extends CheckpointDef {
  selfAttested: boolean;
  optional: boolean;
  status: CheckpointStatus;
  /** What the grader actually observed, so a red check is diagnosable. */
  observed?: string;
}

/**
 * Handed to each session's `grade`. Every account read is memoised, so a
 * session may ask for the same collection from several checkpoints without
 * paying for it twice.
 */
export interface GradeContext {
  email: string;
  /** Per-student resource names, derived from the email. */
  namespaceName: string;
  serviceAccountName: string;
  /** Session 5's metrics scraper — a second service account, in the opposite shape. */
  metricsAccountName: string;
  groupName: string;
  customRoleName: string;
  requiredRegion: string;

  namespaces(): Promise<CloudNamespace[]>;
  /** The student's own lab namespace, if it exists yet. */
  labNamespace(): Promise<CloudNamespace | undefined>;
  cloudUser(): Promise<CloudUser | undefined>;
  apiKeys(): Promise<CloudApiKey[]>;
  serviceAccounts(): Promise<CloudServiceAccount[]>;
  userGroups(): Promise<CloudUserGroup[]>;
  customRoles(): Promise<CloudCustomRole[]>;
  connectivityRules(): Promise<CloudConnectivityRule[]>;
  /**
   * The account Audit Log over the student's access window — the only read that
   * answers a question about the past rather than about current state. Empty if
   * the account cannot serve it.
   */
  auditLogs(): Promise<{ records: CloudAuditLogRecord[]; truncated: boolean }>;
  /**
   * Read-only access to the student's own namespace, for the facts the control
   * plane cannot see. Undefined when the namespace does not exist yet or was
   * created without API key authentication.
   */
  dataPlane(): Promise<NamespaceReader | undefined>;

  /** Build a result for one of this session's checkpoint ids. */
  mk(id: string, status: CheckpointStatus, observed?: string): CheckpointResult;
  /** Sugar for the common pass/fail shape. */
  check(id: string, ok: boolean, onPass: string, onFail: string): CheckpointResult;
  /** Marks every checkpoint in the session blocked — used when a prerequisite is missing. */
  blockedAll(reason: string): CheckpointResult[];
}

export interface SnippetContext {
  namespaceName: string;
  /** `<namespace>.<account>` — what every CLI flag and namespace_accesses key wants. */
  namespaceId: string;
  accountId: string;
  serviceAccountName: string;
  /** Session 5's metrics scraper — a second service account, in the opposite shape. */
  metricsAccountName: string;
  groupName: string;
  customRoleName: string;
  region: string;
}

/**
 * One command in a "use it" section.
 *
 * These are deliberately ungraded. Nothing a student types into their own
 * terminal is visible to the Cloud Ops API, and the alternative — the portal
 * minting itself namespace credentials across the training account just to
 * watch — costs far more than it teaches. So each step states what should
 * happen and the student checks their own output.
 */
export interface UseStep {
  label: string;
  command: string;
  /** What they should see. For the deny cases, the error IS the lesson. */
  expect: string;
  /**
   * Short badge text for a step the rest of the workshop depends on, e.g.
   * "required by Sessions 3-7".
   *
   * This section is labelled *not graded*, which is honest and also an
   * invitation to skip it — and one step in Session 2 writes the credential
   * every later session's Worker runs on. A step with a downstream dependency
   * has to look different from a step that is there to be interesting.
   */
  required?: string;
}

/**
 * One step of the Lab itself, for labs whose artifact is a sequence of actions
 * rather than a file you paste whole.
 *
 * `grades` names the checkpoint the step satisfies, and the page renders it as a
 * badge. That linkage exists because the alternative already bit us: Lab 3's
 * `set-current-version` — the only action that satisfies `current-version-moved`
 * — sat in "Use what you built", a section the page labels *not graded*. A
 * student could finish the Lab exactly as written and still fail the exit check.
 * Naming the checkpoint on the step makes that drift visible instead of silent,
 * and `assertLabCommandsGradeRealCheckpoints` fails the build if the id is wrong.
 */
export interface LabStep {
  label: string;
  /** Omitted for steps that are a decision rather than a command. */
  command?: string;
  /** What they should see, so they know to move on. */
  expect?: string;
  /** Checkpoint id this step satisfies. */
  grades?: string;
  /**
   * Renders the session's `snippet` inside this step rather than after the whole
   * list. Set it on the step that asks for the file: a student following step 6
   * should not have to scroll past steps 7 and 8 to find the configuration
   * step 6 is talking about. At most one step per session claims it.
   */
  snippet?: boolean;
  /**
   * Where to go and watch what this step did — deep-linked into the student's
   * own namespace. Prose cannot carry it: `RichText` renders no anchors.
   */
  link?: { label: string; url: string };
}

export interface UseSection {
  intro: string;
  steps: UseStep[];
  /** Optional extra credit for people who finish the lab early. */
  stretch?: {
    title: string;
    body: string;
    command?: string;
    /**
     * Where to go and look at what just happened. Deep-linked into the
     * student's own namespace — `RichText` renders no anchors, so a URL in
     * `body` would be unclickable prose, and the Cloud UI's namespace switcher
     * is a poor substitute for landing on the right page.
     */
    link?: { label: string; url: string };
  };
}

/**
 * A tool this session needs that earlier sessions did not. Listed only where it
 * is NEW — repeating "install Terraform" on every page trains people to skip
 * the box, and the one session that adds something then goes unread.
 */
export interface Prerequisite {
  name: string;
  /** One line: what this session does with it. */
  why: string;
  /** A one-liner where one exists. Shown in a copyable pane. */
  install?: string;
  docs?: string;
}

/**
 * Documentation worth having open during the lab, grouped by source. Kept on the
 * session rather than buried in prose so a student who gets stuck has somewhere
 * obvious to look that is not the instructor.
 */
export interface Reference {
  label: string;
  url: string;
  /** Why you would open this one — keeps the list scannable. */
  note?: string;
}

export interface ReferenceGroup {
  source: string;
  links: Reference[];
  /**
   * 'lab' renders the group directly under the lab's code block, where the
   * argument you are looking up is on screen. 'page' (the default) collects it
   * into the Reference section at the foot of the page.
   */
  placement?: 'lab' | 'page';
}

export interface SessionDef {
  number: number;
  title: string;
  /** What the student walks away with. */
  outcome: string;
  /** Verbatim from course.md. */
  exitCheck: string;
  labTitle: string;
  labMinutes: number;
  /**
   * Tools this session needs that no earlier session did. The function form gets
   * the student's own names, for a prerequisite that has to quote one.
   *
   * Setup a session's own lab performs — `workshop-creds`, `workshop-check` —
   * does not belong here. Session 1 carried both in this block *and* in its
   * steps, and a student who reads an instruction twice reads it once.
   */
  prerequisites?: Prerequisite[] | ((ctx: SnippetContext) => Prerequisite[]);
  /** Docs to keep open during the lab. */
  references?: ReferenceGroup[];
  /** Shown above the steps when there is something they must know first. */
  note?: string;
  /**
   * A link rendered inside the `note` box. Needed because `RichText` carries no
   * anchors, and the one thing a student must do before anything else on the
   * page works — open the sandbox — is a URL.
   */
  noteLink?: { label: string; url: string };
  /** Prose instructions. Static, so it cannot carry personalised values. */
  labSteps?: string[];
  /**
   * Structured, personalised steps — used instead of `labSteps` where the lab
   * IS the commands. Labs 1, 2 and 4 hand over a single file to paste and are
   * better served by `labSteps` plus `snippet`.
   */
  labCommands?: (ctx: SnippetContext) => LabStep[];
  snippet?: (ctx: SnippetContext) => string;
  /**
   * Language the lab snippet is coloured as. Terraform for every session but
   * the proxy one, whose snippet is `labs/proxy/config.yaml`.
   */
  snippetLang?: SnippetLang;
  /** Exercise what the lab created, rather than only proving it exists. */
  use?: (ctx: SnippetContext) => UseSection;
  checkpoints: CheckpointDef[];
  grade(ctx: GradeContext): Promise<CheckpointResult[]>;
}

export interface GradeResult {
  session: number;
  email: string;
  expectedNamespace: string;
  requiredRegion: string;
  checkedAtMs: number;
  results: CheckpointResult[];
  passed: number;
  objectivePassed: number;
  objectiveTotal: number;
  total: number;
}

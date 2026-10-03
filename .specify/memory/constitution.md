<!--
Sync Impact Report (temporary; remove before commit)
- Version change: (template, unfilled) -> 1.0.0
- Ratified: 2026-10-02 (initial adoption; previous file contained only template placeholders)
- Modified principles: none (all placeholders instantiated for the first time)
  - [PRINCIPLE_1_NAME] -> I. Conversational Concierge
  - [PRINCIPLE_2_NAME] -> II. Grounded in Company Truth
  - [PRINCIPLE_3_NAME] -> III. One Source of Truth, Always Linked
  - [PRINCIPLE_4_NAME] -> IV. Complete and Actionable Task Records
  - [PRINCIPLE_5_NAME] -> V. Freshness, Provenance, and Honest Uncertainty
- Added sections: Knowledge Sources & Indexing; Security, Privacy & Access Boundaries;
  Development Workflow & Quality Gates
- Removed sections: none
- Deferred items / TODOs: none
-->

# New Hire Concierge Constitution

## Core Principles

### I. Conversational Concierge

The product is a conversation, not a portal. A new hire or their manager asks in their own
words and receives an answer in their own words. Every capability MUST be reachable through
natural conversation; no feature may exist only as a form, filter, or dashboard control.

- Questions are answered directly, in order, with the answer first and the detail after.
- Follow-up questions, refinements, and "what do I do next" continue the same thread; the
  system MUST hold conversational context rather than restarting on every turn.
- The same capabilities serve both the new hire and their manager; the system MUST detect and
  support both perspectives in one conversation instead of splitting into separate products.
- The system MUST proactively surface the next relevant obligation when the new hire asks about
  one task, rather than waiting to be asked about the rest.

Rationale: the failure being solved is that orientation knowledge is scattered and undiscoverable.
A conversation removes the requirement for the new hire to know what to search for.

### II. Grounded in Company Truth

Every factual claim about the company MUST be derived from ingested company sources (HR system
of record, IT ticketing, benefits portal, policy wiki, Slack buddy assignment, calendar). The
concierge MUST NOT invent, generalize, or "reasonably assume" policy content.

- Answers MUST distinguish verified source content from inference; inference MUST be labeled as
  such.
- Policy questions MUST cite the source document or system record the answer came from.
- If sources conflict, the system MUST surface the conflict rather than silently picking one.
- If no source covers a question, the system MUST say so plainly and route to a human owner. It
  MUST NOT fabricate a plausible answer to appear complete.
- Source content is authoritatively owned by the system of record; the concierge reads and
  summarizes, and MUST NOT become a competing source of truth.

Rationale: a new hire trusting an invented policy is worse than a new hire knowing nothing,
because a plausible wrong answer is acted upon.

### III. One Source of Truth, Always Linked

Tasks, policies, people, and meetings MUST have exactly one canonical record in the concierge's
knowledge model. No obligation may exist only as prose in a conversation transcript.

- Every task in a conversation resolves to a persisted, addressable task record with a stable
  identifier.
- Generated onboarding plans, checklists, and summaries are views over canonical records, never
  independent copies that drift.
- Every claim about an obligation MUST be linkable back to its canonical record or source
  document; summaries MUST carry the link.
- Duplicated or conflicting representations of the same entity MUST be reconciled at ingestion,
  not left for the user to encounter twice.

Rationale: scattered state is the original problem. Adding a fourth copy of a checklist inside a
chat log reintroduces it.

### IV. Complete and Actionable Task Records

A task that a new hire can see MUST be actionable without asking a follow-up question. Partial
task context is treated as a defect.

- Every task record MUST carry: title, owning team, assignee, due date or explicit "no deadline",
  current status, the originating source, and prerequisites/dependencies.
- Every task MUST have an unambiguous next action for the person viewing it.
- Blocked tasks MUST state what is blocking them and who can unblock it.
- Unassigned, ambiguous, or missing-deadline tasks MUST be flagged as such in the record rather
  than defaulted to a guessed value.
- Status MUST reflect the system of record's state; the concierge MUST NOT silently advance a
  task's status on its own initiative.

Rationale: the new hire's failure mode is not knowing what is required, not knowing how to do it.

### V. Freshness, Provenance, and Honest Uncertainty

Onboarding information goes stale as policies change and as a cohort moves through its first two
weeks. The concierge MUST make staleness visible instead of presenting old state as current.

- Every ingested fact and derived record MUST carry a source and a last-verified timestamp.
- Records past their defined freshness window MUST be surfaced with an explicit staleness
  warning and a re-verification prompt before being presented as current.
- The system MUST state its confidence and the limits of its evidence when answers are
  incomplete, partial, or inferred.
- Answer quality MUST degrade to "unknown, here is the owner to ask" rather than to a guess.
- Breaks in ingestion (stale sync, failed connector) MUST be visible to operators and MUST
  suppress confident answering over the affected scope.

Rationale: a concierge that is confidently out of date destroys the trust that makes it usable.

## Knowledge Sources & Ingestion

- Each connector MUST declare its authority: which entity types it owns (tasks, policies,
  people, meetings, benefits) and whether it is read-only or writable.
- No two live connectors may own the same entity type for the same tenant. Ownership conflicts
  MUST fail loudly at configuration time.
- Normalization is mandatory at ingestion: every source record maps to a single canonical
  schema, preserving the source identifier for provenance.
- Access to a source is scoped by the requesting user's identity. Ingestion MUST NOT widen any
  user's visibility beyond what they could see in the source system themselves.
- Historical and superseded policy versions MUST be retained and versioned; answers MUST reflect
  the version effective at the relevant date for the person's cohort.

## Security, Privacy & Access Boundaries

- Least privilege is mandatory. The concierge's credentials MUST be scoped to the minimum set of
  systems and fields required, and MUST use read-only access unless a write path is explicitly
  required and reviewed.
- A person MUST NEVER receive data they could not access in the underlying source system.
  Conversational access control MUST be enforced server-side, not by filtering generated text.
- Personally identifiable information (compensation, health, benefits elections, government
  identifiers) MUST NOT be returned in conversation, stored in conversation history, or included
  in derived summaries. Refer to a secure system or a named human owner instead.
- Conversation transcripts are retained only as long as required for the service, are
  access-controlled, and are never used as a training source without explicit consent.
- Every answer and every state change MUST be written to an audit log sufficient to reconstruct
  who was told what and when.
- Prompt-injection resistance is mandatory: ingested source content is untrusted data and MUST
  NOT be able to alter the system prompt, tools, or access scope.

## Development Workflow & Quality Gates

- Specification precedes implementation; tasks are traced to user stories and to at least one
  constitution principle.
- Every change MUST state which principle it serves and MUST be rejected if it cannot.
- Required automated test coverage: conversation answer correctness against ground-truth policy
  content, refusal correctness when sources are absent, access-control enforcement per role,
  source-attribute fidelity (no fabricated citations), and staleness-warning behavior.
- A change to a canonical schema, ingestion mapping, or connector ownership model MUST be treated
  as a backward-incompatible change and require a migration plan.
- Evaluation against a held-out set of real onboarding questions is a release gate. Regressions
  in grounded-answer accuracy, citation fidelity, or unauthorized-disclosure rate block release.
- No feature may ship that leaves the new hire with an obligation that has no canonical record.

## Governance

- This constitution supersedes conflicting product decisions, roadmap entries, and informal team
  practice. Where this document and any other artifact disagree, this document wins until it is
  amended.
- Amendments MUST be proposed through the constitution workflow, MUST include a written rationale
  and a migration impact statement, and MUST bump the version per the policy below. Amendments
  that add or redefine a principle MUST NOT be merged without an explicit reviewer of record.
- Versioning follows semantic versioning:
  - MAJOR: removing a principle, or redefining one in a backward-incompatible way.
  - MINOR: adding a principle or section, or materially expanding existing obligations.
  - PATCH: clarifications, wording, and non-semantic refinements.
- Compliance is reviewed at every specification and implementation checkpoint. A review MUST state
  which principles apply and MUST record justified exceptions explicitly; undeclared violations
  are blockers.
- Any exception MUST be time-boxed, MUST name an accountable owner, and MUST have an expiry date
  recorded here or in the specification that requests it.
- Security and privacy obligations are not waivable by ordinary feature tradeoff.

**Version**: 1.0.0 | **Ratified**: 2026-10-02 | **Last Amended**: 2026-10-02
# Feature Specification: People Operations Portal

**Feature Branch**: `001-people-ops-portal`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "A new hire's first two weeks involve a dozen scattered things — IT setup tickets, benefits paperwork, policy documents buried in a wiki, a buddy assigned somewhere in Slack, a calendar full of orientation meetings nobody reminds them about. Build a concierge that a new hire (or their manager) can actually talk to, that knows the company's real policies and where things stand." Plus: responsive, mobile-ready React website; recommend database architecture and stack.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Monitor Onboarding Progress (Priority: P1)

An HR lead opens the portal and sees every new hire, how far through their onboarding each one
is, and which specific items are still outstanding. They can drill into a single employee, see
exactly what is done and what is not, and advance the employee's stage when work is confirmed
complete.

**Why this priority**: This is the core operational need. Onboarding stalls silently — nobody
complains, the person just quietly underperforms for weeks. Visibility into where each hire stands
is the single highest-value capability, and every other module depends on the same employee data.

**Independent Test**: Load the tracker with existing employee records, confirm each row shows
progress and outstanding items, open one employee, and update its stage. Delivers immediate
operational visibility.

**Acceptance Scenarios**:

1. **Given** employees exist with varying onboarding progress, **When** an HR lead views the
   tracker, **Then** each employee shows a progress percentage, a completion count, and a list of
   outstanding items.
2. **Given** an employee with outstanding items, **When** the HR lead views that employee's detail,
   **Then** completed items and outstanding items are shown as separate, distinct lists.
3. **Given** an employee's stage may be advanced, **When** the HR lead confirms a stage update,
   **Then** the progress shown afterward reflects the authoritative post-update state rather than an
   assumed one.
4. **Given** an employee whose stage may NOT be advanced, **When** the employee detail is viewed,
   **Then** the update control is unavailable and the reason is visible.
5. **Given** an employee record that exists in the roster but has no corresponding onboarding
   record, **When** the tracker loads, **Then** that employee is visibly flagged as a data mismatch
   for HR rather than shown as empty progress or as an error.

---

### User Story 2 - Ask Policy Questions and Get Sourced Answers (Priority: P2)

A new hire searches for a company policy — leave, benefits enrollment, remote work — and receives an
answer attributed to the source document it came from. When no policy covers the question, they are
told so plainly and given a path to a human.

**Why this priority**: Policy confusion is the most common early friction, and an answer without
provenance is worse than no answer, because a plausible wrong policy gets acted on. This delivers
direct value and is independently shippable.

**Independent Test**: Ask a covered question and receive an attributed answer; ask an uncovered
question and receive an explicit "not covered" response with a human contact path.

**Acceptance Scenarios**:

1. **Given** a policy question with documented coverage, **When** the new hire searches,
   **Then** an answer is displayed along with the source document it came from.
2. **Given** a policy question with no documented coverage, **When** the new hire searches,
   **Then** the response explicitly states no policy covers the question and provides a route to
   People Operations.
3. **Given** a search that returns no usable answer content, **When** the result is displayed,
   **Then** the employee sees an explicit "no policy covers this" message, never a blank or
   perpetually-loading panel.
4. **Given** any answer displayed, **When** the employee reads it, **Then** the source it was
   derived from is visible.

---

### User Story 3 - Audit and Trigger Welcome Sequences (Priority: P3)

An HR lead reviews which new hires have already received their welcome message and can trigger
the welcome sequence for one that has not.

**Why this priority**: Useful and self-contained, but lower urgency than progress visibility and
policy answers. It also has the smallest surface.

**Independent Test**: View the welcome status list, trigger welcome for an employee who has not
received it, and confirm the outcome is reported accurately.

**Acceptance Scenarios**:

1. **Given** an employee who has already received a welcome message, **When** the HR lead views
   their status, **Then** it is shown as already complete, not as a failure.
2. **Given** an employee who has not received a welcome message, **When** the HR lead triggers the
   welcome sequence, **Then** the outcome is reported as sent.
3. **Given** a welcome trigger that cannot complete, **When** the HR lead views the result,
   **Then** the employee being acted on is identified and the failure is reported plainly.

---

### User Story 4 - Provision a New Hire (Priority: P4)

An HR lead enters a new hire's details and triggers the provisioning process that creates their
record and sends initial communications.

**Why this priority**: Necessary for the portal to be used, but it is the only action that creates
an employee record and it cannot be safely exercised without confirmed input requirements. It is
sequenced last for that reason.

**Independent Test**: Submit a new hire's details and confirm a record is created and identified
back to the user.

**Acceptance Scenarios**:

1. **Given** complete, valid new hire details, **When** the HR lead submits the form, **Then** one
   new hire record is created and its identifier is shown.
2. **Given** incomplete or invalid details, **When** the HR lead submits, **Then** the problem is
   shown against the specific field and no record is created.
3. **Given** a submission is in progress, **When** the HR lead submits again, **Then** no second
   record is created.

---

### User Story 5 - Use the Portal on a Phone (Priority: P5)

A new hire checking their onboarding progress on a phone during their first week can read their
progress, outstanding tasks, and policy answers on a phone screen without horizontal scrolling or
lost controls.

**Why this priority**: A new hire's first-week questions happen on a phone. But the core value is
delivered on desktop first, and responsive behavior is a property applied across all stories rather
than a separate feature.

**Independent Test**: Complete every P1–P4 journey at mobile width and confirm all controls remain
reachable and legible.

**Acceptance Scenarios**:

1. **Given** a phone-sized screen, **When** any primary screen is viewed, **Then** all content and
   controls are reachable without horizontal scrolling.
2. **Given** a phone-sized screen, **When** a data table is viewed, **Then** the information
   remains understandable rather than being clipped or truncated unreadably.
3. **Given** a phone-sized screen, **When** any primary action is performed, **Then** it can be
   completed with touch-sized targets.

---

### Edge Cases

- An employee record exists in the roster but the onboarding system returns no matching record.
- The onboarding system returns a completion percentage that disagrees with its own completed-item
  list.
- A policy question is successfully answered but with empty answer content.
- A policy question is answered with content stating the source lacks sufficient information.
- A welcome trigger is repeated for an employee who has already been processed.
- The underlying data source returns a partial record with missing or malformed fields.
- Identifiers or cohort values appear as text in one record and numbers in another.
- One record among many is test or placeholder data that should not appear to employees.
- A record has no assigned deadline or owner.
- The data source is temporarily unreachable or returning stale content.
- An employee views the portal while their own progress record does not yet exist.
- A user attempts to reach a function their role does not permit.

## Requirements *(mandatory)*

### Functional Requirements

**Grounding and provenance**

- **FR-001**: System MUST present every answer about company policy with the source document it
  was derived from.
- **FR-002**: System MUST NOT present a company policy answer that has no supporting source.
- **FR-003**: System MUST explicitly report when no policy covers a question, in wording
  distinguishable from both a system failure and an unanswered search.
- **FR-004**: System MUST route the employee to a named human contact when a question is not
  covered by policy.
- **FR-005**: System MUST NOT silently substitute a fabricated or inferred policy answer where no
  source exists.

**Progress and task state**

- **FR-006**: System MUST show, for each employee, a completion percentage, a count of completed
  items, a total item count, and explicit lists of completed and outstanding items.
- **FR-007**: System MUST distinguish three separate outcomes when requesting progress — a
  successful record, no matching record, and an invalid or failed request — and MUST NOT render
  them identically.
- **FR-008**: System MUST show each employee's current onboarding stage and status.
- **FR-009**: System MUST allow an authorized user to advance an employee's onboarding stage only
  when that action is permitted, and MUST show the reason when it is not.
- **FR-010**: System MUST display the authoritative post-update state after a stage change rather
  than an optimistically assumed state.
- **FR-011**: System MUST flag, for staff, any employee whose roster record and onboarding record
  disagree, rather than silently presenting empty progress.
- **FR-012**: System MUST NOT display placeholder or malformed records as if they were real
  employees.

**Provisioning**

- **FR-013**: System MUST validate new hire details before submission and MUST show the specific
  problem against the specific field.
- **FR-014**: System MUST prevent a single submission from creating more than one employee record.
- **FR-015**: System MUST return the created employee's identifier to the user on success.
- **FR-016**: System MUST NOT expose the employee identifier as user input, since it is generated
  by the system.

**Welcome sequences**

- **FR-017**: System MUST show welcome status per employee and MUST present an already-processed
  welcome as a successful, expected outcome rather than an error.
- **FR-018**: System MUST identify which employee a failed welcome action affected.

**Asynchronous behavior and honesty**

- **FR-019**: Every data-bearing surface MUST provide distinct, designed treatment for loading,
  empty, error, and success states; no surface may present an indefinite blank or spinner-only
  state.
- **FR-020**: System MUST surface the freshness of displayed data so no figure is presented as
  live when it is not.
- **FR-021**: System MUST preserve valid rows when one row fails, so a single failure never blanks
  a list.
- **FR-022**: System MUST NOT retry requests that failed due to invalid input.

**Access and privacy**

- **FR-023**: System MUST restrict each user to functions and employee records their role
  permits, enforced independently of what the interface displays.
- **FR-024**: System MUST NOT expose sensitive personal information — compensation, health,
  benefits elections, or government identifiers — in any interface surface, conversation, or
  derived summary.
- **FR-025**: System MUST record who was given which information, and when, in a form sufficient
  to reconstruct it.
- **FR-026**: System MUST minimize the personal information it stores and retains.

**Responsive behavior**

- **FR-027**: System MUST remain fully usable at phone, tablet, and desktop widths without
  horizontal scrolling or clipped information.
- **FR-028**: System MUST provide touch-sized interactive targets on touch devices.

**Accessibility**

- **FR-029**: System MUST convey status through text or iconography in addition to color.
- **FR-030**: System MUST meet WCAG 2.1 AA contrast for text and meaningful UI components.

### Key Entities

- **Employee**: A new hire being onboarded. Attributes: system-assigned identifier, name, role,
  start date, cohort grouping, work email, total expected items, and onboarding state. The
  identifier is generated by the system, not supplied by the user.
- **Onboarding Item**: A single unit of onboarding work with a name and a completion state.
  Belongs to an employee. The set of items differs per employee, so the total is an attribute of
  the employee rather than a fixed constant.
- **Onboarding Progress Record**: The computed state for one employee — completion percentage,
  completed and outstanding item lists, current stage, whether a stage update is permitted, and
  whether a stage update was requested.
- **Policy Document**: An authoritative HR document that answers policy questions. Has a
  stable identifier used for attribution.
- **Policy Answer**: A response to a policy question, with its answer text and the policy document
  it derives from. An answer with no supporting content is a distinct state, not an empty answer.
- **Welcome Sequence Record**: The state of a new hire's welcome communication — whether it has
  been sent and when.
- **User**: A person using the portal. Has a role that determines permitted functions and visible
  employees.
- **Data Source Connection**: The external system holding authoritative employee data. Has a
  defined ownership scope and a last-verified time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An HR lead can determine the status of any new hire's onboarding within 10 seconds
  of opening the tracker.
- **SC-002**: 100% of policy answers shown to an employee display the source they came from.
- **SC-003**: 100% of questions with no policy coverage produce an explicit "not covered" response
  with a human contact path, with zero blank or indefinitely-loading result panels.
- **SC-004**: 100% of onboarding requests that return no matching record are visibly flagged for
  staff review, rather than displayed as zero progress.
- **SC-005**: 95% of returning new hires can locate their own outstanding tasks and find the
  policy answer relevant to their question without assistance.
- **SC-006**: The portal is fully operable at 360px width with no horizontal scrolling, for every
  primary journey.
- **SC-007**: 100% of completed provisioning submissions create exactly one employee record, with
  zero duplicates observed in testing.
- **SC-008**: Every loading, empty, and error state has been reviewed and confirmed to convey a
  distinct, deliberate message.
- **SC-009**: Support requests about "where do I find X during onboarding" decline measurably
  after launch.
- **SC-010**: Zero instances of personally sensitive information appearing in any interface,
  derived summary, or stored record outside its authorized system.

## Assumptions

- The existing automation workflows and the existing spreadsheet remain in place and are not
  rebuilt. The portal is a front-end layer over them.
- The spreadsheet remains the authoritative record of employee data. This feature does not
  introduce a separate system of record; it introduces no competing authoritative store.
- All writes continue to flow through the existing automation layer, which holds the credentials.
  The portal never holds write credentials to the source data.
- The employee roster is small — tens to low hundreds of employees, not thousands.
- Employees are provisioned by an HR administrator, not self-service.
- The portal is used on corporate networks and standard office connectivity; offline operation is
  not required.
- Authentication is provided by the organization's existing identity provider, using standard
  role-based access.
- The source data currently contains a small amount of placeholder and malformed test data, which
  is filtered from employee-facing views and flagged to staff.
- Some onboarding data fields are currently not populated by the source system. Where data is
  absent, the portal shows that it is absent rather than substituting a default.
- Responsive behavior across phone, tablet, and desktop is in scope; native mobile applications are
  out of scope.
- Predictive analytics, conversational policy chat, and automated milestone notifications are out
  of scope for this release and are candidates for a later phase.
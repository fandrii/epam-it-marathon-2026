---
name: backend-api-implementation
description: Implement backend API homework and feature requests in an existing repository. Use when asked to add REST endpoints, business logic, authorization, validation, persistence, response DTOs, or tests. Inspect the project first and follow its existing architecture and conventions.
---

# Backend API Implementation Skill

## Goal

Implement backend API requirements in the **existing project**, rather than generating a separate demo application. Work incrementally, preserve the project's architecture, and explain important decisions in beginner-friendly language when asked.

## 1. Start by understanding the repository

Before editing code:

1. Inspect the repository structure and identify:
   - backend framework and language;
   - API controllers/routes;
   - services/use cases;
   - entities/models and database/repositories;
   - DTOs/request/response models;
   - authentication and authorization mechanisms;
   - existing exception handling and validation;
   - tests and test commands.
2. Read nearby, similar endpoints and follow their patterns.
3. Find the actual domain model and relationships. Do not assume property names, database structure, status values, or repository methods.
4. Check project instructions such as `README`, `AGENTS.md`, `.github/copilot-instructions.md`, and existing agent/skill guidance.
5. Summarize the implementation plan and list any requirement that cannot be mapped confidently to the current code.

Do not start coding until the repository has been inspected.

## 2. Rules for implementation

- Reuse existing entities, services, repositories, DTO conventions, and dependency injection.
- Keep controllers thin. Put business rules in the appropriate service/use-case layer.
- Use asynchronous database/API operations if that is the project's convention.
- Enforce authorization on the server for every protected endpoint. Never rely only on frontend checks.
- Verify that the authenticated user is the **Owner of the relevant reservation/group reservation**, using the project's existing identity and ownership model.
- Validate identifiers, request bodies, and domain state.
- Return the HTTP status codes required by the task, using the project's standard error response format.
- Avoid duplicate business logic. Extract reusable logic when appropriate.
- Do not add packages or change infrastructure unless necessary. Explain why before making a significant dependency or architecture change.
- Do not invent database fields, status enum members, routes, or API contracts. Search for the real definitions first.
- Do not weaken security, remove existing behavior, or silently change unrelated code.
- Do not claim that code works unless it has been built or tested.

## 3. Convert requirements into an implementation checklist

For each endpoint, identify:

- HTTP method and route;
- who is allowed to call it;
- input parameters and request body;
- data that must be loaded;
- business rules and edge cases;
- persistence changes;
- response shape;
- success and error status codes;
- tests needed.

Keep the externally visible API contract faithful to the task. Use the project's naming and serialization conventions where they do not conflict with the specified contract.

## 4. Group pre-order example: business rules to preserve

Use this section when implementing the group pre-order homework described by the user. Treat the task specification as the source of truth, and inspect the repository to discover how its concepts are represented.

### Level 1 — Read group participants' sessions

`GET /guest/groups/{groupReservationId}/sessions`

The Owner should receive a snapshot containing:

- each participant/session ID;
- participant type and name;
- selected dishes and quantities;
- dish ID, name, and price;
- each participant's total;
- whether the session was submitted;
- the total across all participants.

Calculation rules:

- A participant total is the sum of `dish.price * quantity` for that participant.
- The group total is the sum of participant totals.
- Do not count a session or items twice.
- Preserve the required response structure unless the existing API contract explicitly defines a compatible wrapper.

### Level 2 — Owner session ID and consolidated submit

`GET /reservations/{reservationId}/guest-session-id`

Return the Owner's guest-session ID for that reservation:

```json
{
  "guestSessionId": "owner-session-123"
}
```

`POST /group-reservations/{groupReservationId}/submit`

Request:

```json
{
  "reservationId": "reservation-123"
}
```

Submit behavior:

1. Verify the caller is the Owner.
2. Verify the reservation and group reservation exist and are related as required by the domain model.
3. Find only guest sessions whose state means **submitted**.
4. If there are no submitted sessions, return `400`.
5. Collect all dish quantities from those sessions.
6. If there are no dishes in the submitted sessions, return `400`.
7. Group identical dishes by `dishId` and sum their quantities.
8. Find the relevant order. If it does not exist, return `400`.
9. Add/update the consolidated order items without duplicating existing items unintentionally.
10. Change the order status to `SubmittedByCustomer`.
11. Change the group reservation status to `Submitted`.
12. Persist the related changes consistently, using a transaction if supported and appropriate.
13. Return the consolidated list in the required format:

```json
[
  { "dishId": "dish1", "quantity": 3 },
  { "dishId": "dish2", "quantity": 2 }
]
```

Do not assume the exact enum names or persistence model. Find them in the codebase.

### Level 3 — Remove a guest session

`DELETE /guest/groups/{groupReservationId}/sessions/{guestSessionId}`

Behavior:

1. Verify the caller is the Owner of this group reservation.
2. Find the guest session.
3. If the session does not exist, return `404`.
4. If the session exists but does not belong to this group reservation, return `400`.
5. Remove the session using the project's established deletion/relationship rules.
6. Rebuild and return the updated group snapshot, including participants and the new group total.

Do not delete an Owner session when the requirement only permits deleting a guest session. Check whether the domain uses soft delete, relationship removal, or physical deletion before choosing an approach.

### Required error behavior

- Non-Owner caller: use the project's established unauthorized/forbidden behavior; do not allow the operation.
- Missing reservation or group reservation: `404`.
- No submitted guest sessions during submit: `400`.
- No dishes in submitted sessions: `400`.
- Missing order during submit: `400`.
- Guest session missing during deletion: `404`.
- Guest session belongs to another group reservation: `400`.

If the project has a standard error envelope, preserve it while returning the required HTTP status.

## 5. Testing requirements

Add or update tests using the test framework already present in the repository.

At minimum, cover:

### Read sessions
- Owner can read the group snapshot.
- Non-Owner cannot read it.
- Missing group reservation returns `404`.
- Participant totals and group total are calculated correctly.
- Empty group returns the correct empty snapshot.

### Get Owner session ID
- Owner receives the correct session ID.
- Non-Owner is rejected.
- Missing reservation returns `404`.
- Missing Owner session is handled consistently with existing project conventions.

### Submit consolidated order
- Only submitted guest sessions are included.
- Identical `dishId` values are merged and quantities summed.
- Unsubmitted sessions are ignored.
- No submitted sessions returns `400`.
- No dishes returns `400`.
- Missing order returns `400`.
- Order status becomes `SubmittedByCustomer`.
- Group reservation status becomes `Submitted`.
- Repeated submission does not accidentally duplicate order items.

### Delete guest session
- Owner can delete a guest session.
- Non-Owner is rejected.
- Missing session returns `404`.
- Session from another group returns `400`.
- Owner session cannot be deleted as a guest session.
- Response contains the updated participant list and total.

Use test fixtures/factories already in the project. Avoid tests that depend on production data or real cloud resources.

## 6. Recommended workflow

Implement one level at a time:

1. **Plan:** inspect code and map requirements to existing classes.
2. **Level 1:** implement read endpoint, DTOs, authorization, calculations, and tests.
3. Run focused tests and build.
4. **Level 2:** implement Owner session lookup and consolidated submit, then tests.
5. Run focused tests and build.
6. **Level 3:** implement deletion and updated snapshot, then tests.
7. Run the full relevant test suite and build.
8. Review the diff for unrelated changes, security issues, missing validation, and accidental generated files.
9. Report exactly what changed, which tests/build commands ran, and any remaining limitations.

If a level fails, fix it before moving to the next level unless the user explicitly asks otherwise.

## 7. How to work with the user

- The user is learning software development. Explain unfamiliar concepts in simple Ukrainian when explanation is requested.
- Prefer small, reviewable changes over rewriting many files at once.
- Before a destructive operation, schema migration, infrastructure change, or broad refactor, explain the impact and ask for confirmation.
- If a requirement conflicts with the current code or is ambiguous, show the conflict and ask one focused question rather than guessing.
- Do not expose secrets, tokens, connection strings, or personal data in logs or generated documentation.
- Never run deployment, cloud resource deletion, database reset, or destructive migration commands unless the user explicitly asks.
- Do not mark a task complete merely because files were edited. Verify with tests/build where possible.

## 8. Final report format

When implementation is finished, report:

1. **Implemented:** endpoints and behavior added.
2. **Files changed:** file paths and a short explanation.
3. **Authorization and validation:** how Owner access and error cases are handled.
4. **Tests:** commands executed and pass/fail results.
5. **Not verified / remaining:** anything that could not be tested or any unresolved assumption.

Be precise. Separate verified results from assumptions.

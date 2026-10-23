# Patient journey wireframes · iteration 02

## Design hypothesis

The default website now opens on the visit greeting. The SMS illustration represents the phone's Messages app and can be selected in the design studio; it is not an extra page the patient should visit after tapping a real text. `/patient` is the separate working API-connected MVP; see `MVP_WORKFLOW.md`.

A patient who struggles with app setup can complete a medication review when the clinic introduces it, the phone opens directly into a known task, each step has one clear primary action, and uncertainty has an accessible help path. This remains a hypothesis until tested with representative patients.

Design starting points: 20px patient body text, 60px primary actions, high contrast, visible keyboard focus, explicit labels, optional read-aloud, and upload/manual alternatives. These choices are not a claim of WCAG conformance or usability validation. The design studio's small annotations are not part of the proposed patient interface.

## Screens and branches

| Screen | Patient decision | Next path |
| --- | --- | --- |
| Clinic text | Open the appointment-specific invitation | Simulated verification; valid-session scenario skips the code |
| Private access | Enter the example code 123456 | Personalized greeting; wrong-code recovery; resend concept |
| Clinic invitation | Start the clinic-requested task | Capture |
| One bottle | Camera, existing photo, or type | Manual entry for real selected photos; fictional example goes to review |
| Medication review | Check name, strength, directions, and actual use | Confirm; change routine; report no longer taking; correct identity; unsure |
| Routine editing | Record existing amount and schedule | Review again before confirmation |
| Manual entry | Enter known details | Review; preserve uncertainty through help |
| Add another | More medicines or finished | Capture; whole-list review |
| Whole-list review | Inspect every added entry | Edit/reconfirm; share only when all confirmed |
| Named recipient | Review what will be shared and with whom | Simulated sharing; return to list |
| Receipt | See completion and delivery distinction | View the example snapshot |
| Return visit | Recheck previously reported medicines | Individual review; add a changed/new medicine |
| Camera recovery | Choose another method | Existing photo; type; retry; help |
| Old link | Ask for a fresh invitation | Generic reissue demonstration without patient details |
| Fresh-link recovery | Return to the newest clinic message | Example SMS; help |
| Help | Office or family assistance preference | Pause, preserving unconfirmed items |
| Safe stopping | Continue with a helper | Return to draft list |

## Important boundaries

- This is a design study, with React state only. Nothing is uploaded or sent by the wireframe. Refresh clears demo progress.
- Personal selected pictures remain object URLs in memory; no recognition is performed. The actual application's upload/OCR is separate.
- Example medication values are fictional test fixtures, not treatment instructions. Half-tablet editing illustrates recording reported use, not deciding whether splitting is appropriate.
- Editing a listed medication makes it unconfirmed immediately, even before leaving the edit flow. A user who backs out must still review it again.
- A help request does not send a message. A caregiver selector does not grant proxy access. Receipt screens do not claim clinical review or real clinic delivery.
- The return-visit scenario marks prior entries as needing review. It never bulk confirms an old list.
- Return-visit confirmation advances to the next unreviewed medicine, then the whole-list check. Unchanged labels do not need new photos.
- Texts, code entry, active sessions, and link renewal are simulated. The hardcoded demo code must never be used by a real authentication service. Personal greeting/visit details are fictional, and a valid production patient session is required before revealing them.
- The exact immutable backend snapshot, actual delivery record, durable draft/resume, and authorized proxy account remain requirements for production.

## Proposed usability session

Recruit 8–12 patients, including people who needed help getting started with Kardia. Use fictional labels and the participant's own phone. Observe the first attempt without coaching; then give a consistent assisted introduction and test a repeat attempt.

Tasks: open the clinic invitation; photograph one bottle; report an existing half-tablet routine; add a supplement; correct a wrong strength; mark an unclear medicine uncertain; recover from camera trouble; identify the receiving clinic; and review the existing list at a later visit.

Record unaided completion, prompts needed, time, incorrect confirmations, reading/touch problems, and clinic staff time. Agree success criteria before testing. Early sessions expose usability problems; they do not establish clinical accuracy or safety.

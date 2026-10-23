# MedCarry: patient access from appointment texts

## Product decision

The default patient experience should be a visit-specific mobile web check opened from a practice-branded text. Installing an app, creating a username, naming a list, finding the clinic, and managing a password should not be patient tasks. Clinic-assisted enrollment establishes the patient record and the approved way to contact that person.

The current Site remains an owner-private prototype. `/wireframes` demonstrates the experience with fictional data. Its code field and active-session switch are presentation controls, not authentication. No SMS provider, scheduler, patient enrollment, separate patient access service, passkey, or clinic delivery is implemented by this iteration. Do not publish patient records by removing the existing Site's owner-private access.

## Patient journey

1. The clinic checks the patient's number, communication preferences, shared-phone situation, and any authorized helper during enrollment.
2. A reminder links to a generic pre-visit landing page. The message contains no medicine names or clinical details. Even the sender can reveal a care relationship, so agree the sender and message content with the practice and patient.
3. With a still-valid, appropriately scoped authenticated patient session, the web app can continue to the visit check. Merely recognizing a browser, possessing a link, or knowing a date of birth does not authorize access. A previously enrolled passkey may allow familiar device unlock when reauthentication is needed.
4. Without an appropriate session, complete a supported identity check before showing patient name, visit details, or medication records. The wireframe demonstrates a single six-digit code field with `autocomplete="one-time-code"`; autofill support must be tested on actual phones. SMS is one possible restricted fallback, not automatically an adequate assurance level for every deployment.
5. The patient sees a short greeting, the relevant visit, and one Start action. Review existing medicines individually. Auto-advance after each confirmation. Photograph only new or changed labels. Allow manual input and an unsure/help path.
6. The patient reviews the completed list and the named clinic, then chooses to share. Persist an immutable snapshot and show delivery separately from clinical review.

Sample reminder copy: “Innovation Cardiology: Please complete your pre-visit check. Tap the link below to start.” Use a branded HTTPS destination. Messaging preferences, STOP handling, confidential communications, deliverability, and applicable messaging rules must be implemented for the chosen service.

## Invitation and session design

An appointment invitation is not a permanent credential. Keep invitation lifetime separate from the short authentication challenge and authenticated session lifetime. A reminder sent two days early should not become useless because an authentication code expires minutes later; generate a short-lived challenge when the patient deliberately starts access.

- Generate an opaque, high-entropy random invitation. Bind it server-side to the tenant, intended patient/authorized proxy, appointment, allowed action, expiry, and revocation state. Store a digest rather than the usable token. Do not put patient identifiers, medication data, or a reusable session credential in the URL.
- An unauthenticated GET must be safe for SMS preview scanners. It must not return PHI, authenticate the visitor, consume the invitation, confirm medicine use, or trigger a burst of messages. Start any challenge through a deliberate, protected action with rate limits. Remove the invitation from the address bar when it has been exchanged successfully. Exclude secrets from request logs, analytics, error reports, referrers, and external resources.
- Validate all authentication on the server. A code typed into a React component, a local-storage flag, a patient ID in the request, a known browser fingerprint, or DOB alone is not proof of identity.
- An SMS link plus a code sent to the same number are not independent authentication factors. They can limit simple link forwarding but do not solve shared phones, SIM swap, interception, reassigned numbers, phishing, or a compromised SMS account. Select required assurance with the practice's security team. Support enrolled passkeys/existing patient identity or staff-assisted access where appropriate.
- Challenge issuance and verification need short expiry, one-time acceptance, replay rejection, bounded retries and sends, generic responses, and atomic consumption. Reissuing a code must not reset failed-attempt limits. Consider SIM/number changes and other risk signals before using SMS. Never allow the public invite to change its destination number.
- Exchange successful verification for a rotated, restricted server-managed session in Secure, HttpOnly, appropriately SameSite cookies. Enforce origin/CSRF protections, no-store responses, tenant/patient/appointment authorization, revocation, and current-revision checks on every protected request, including photo reads.
- A remembered browser may reduce friction only while a legitimate session or registered authenticator remains valid. A persistent flag alone is insufficient. Support logout, lost-phone revocation, shared-device restrictions, reauthentication, and recovery that does not disclose whether a patient exists.
- Proxy access requires a separately identified helper with explicit scope, authorization, expiry, revocation, and audit records. Forwarding a patient's text does not create proxy access.

## Proposed server records and boundaries

| Record | Purpose |
| --- | --- |
| Patient/tenant membership | Stable mapping to the verified patient or authorized helper |
| Contact and communication preference | Verified destination, verification history, opt-out, confidential-contact restrictions |
| Appointment | External ID, tenant, patient, start time/timezone, revision, active/cancelled status |
| Invitation | Hashed token, patient/tenant/visit binding, allowed actions, expiry and revocation |
| Authentication challenge | Digest, expiration, attempts, send limits, consumption and risk context |
| Patient session | Server-authenticated principal, scope, issued/expiry times and revocation |
| Reminder outbox | Idempotency key, appointment revision, scheduled time, provider status, retry state |
| Review/snapshot/delivery | Current medication revisions, explicit confirmations, immutable disclosure and recipient acknowledgment |

Keep the existing medication domain validation. Do not impersonate a patient's identity by feeding a different user ID into the owner-authenticated API. Introduce an authorized principal/tenant model with migration and isolation tests before real patient access. Keep staff/admin and patient privileges distinct.

## Reminder behavior

Start by evaluating the clinic's existing appointment reminder channel and scheduling feed. A proposed pilot cadence is one request about 48 hours before the visit and one follow-up only if unfinished; these timings are product assumptions to test, not requirements or deployed jobs.

The scheduler should reconcile appointment create/update/cancel events and current timezone. Use an outbox and an idempotency key that includes appointment revision and reminder type. Before sending, recheck appointment status, completion, communication preference, and destination eligibility. Suppress completed, cancelled, superseded, opted-out, or invalid-contact reminders. Verify provider webhooks and distinguish queued, sent, delivered, failed, opened, submitted, and clinically reviewed. Do not mark submission based on a link preview or message delivery receipt.

## Minimum implementation checks

- Wrong-patient/tenant/appointment access and source-photo reads are rejected.
- A forwarded invitation without an appropriate session or verification reveals no PHI.
- Expired, revoked, replaced, replayed, and concurrently redeemed credentials fail safely.
- SMS preview GETs cause no verification, consumption, disclosure, confirmation, or automatic message sends.
- Resend and guessing limits persist across challenge replacement and distributed requests.
- Phone-number changes require independently verified recovery. A family helper cannot silently become the patient.
- Medication edits invalidate current confirmation; sharing atomically checks the exact current list and creates an immutable snapshot.
- Provider failures, duplicate jobs/webhooks, cancellation, rescheduling, timezone changes, completion, and opt-out suppress inappropriate reminders.
- A session timeout preserves drafts server-side and returns the user to an understandable recovery step after reauthentication.

## Primary references

- HHS appointment reminders: https://www.hhs.gov/hipaa/for-professionals/faq/are-appointment-reminders-allowed-under-hipaa-without-authorization/index.html
- HHS limiting disclosures in patient messages and confidential contact requests: https://www.hhs.gov/hipaa/for-professionals/faq/may-health-care-providers-leave-messages/index.html
- NIST SP 800-63B-4, out-of-band authentication and restricted PSTN use: https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP token handling guidance (written for password recovery; applicable patterns require adaptation to invitation access): https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- OWASP session management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

These sources inform the design; this prototype is not a compliance certification or a validated patient authentication deployment. Real use needs the practice's approved identity, hosting, messaging, privacy/security arrangements, vendor contracts, and operational workflow.

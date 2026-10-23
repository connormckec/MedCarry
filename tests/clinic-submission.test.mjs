import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanSubmitClinic,
  buildChangeSummary,
  canSubmitClinic,
  appointmentCalendarDate,
  deliveryLabel,
  parseAprimaStatus,
  patientReceiptCopy,
  PATIENT_SEND_CTA,
  STAFF_INBOX_INTRO,
  ClinicSubmissionError,
} from '../lib/clinic-submission.ts';
import { emptyMedication } from '../lib/medication.ts';

const confirmed = (over = {}) => ({
  id: crypto.randomUUID(),
  profileId: 'p',
  sourceIds: [],
  revision: 1,
  confirmedRevision: 1,
  confirmedAt: '2026-10-22T00:00:00Z',
  createdAt: '2026-10-22T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
  ...emptyMedication(),
  productName: 'Example',
  strength: '5 mg',
  actualDose: '1',
  frequency: 'daily',
  ...over,
});

test('empty-list attestation is explicit and blocks mixed lists', () => {
  assert.equal(canSubmitClinic([], true), true);
  assert.equal(canSubmitClinic([], false), false);
  assert.equal(canSubmitClinic([confirmed()], true), false);
  assert.throws(() => assertCanSubmitClinic([], false), ClinicSubmissionError);
  assert.throws(() => assertCanSubmitClinic([confirmed()], true), ClinicSubmissionError);
  assert.doesNotThrow(() => assertCanSubmitClinic([confirmed()], false));
});

test('change summary groups added, stopped, uncertain, and duplicates', () => {
  const summary = buildChangeSummary(
    [
      confirmed({ productName: 'Eliquis', source: 'manual', status: 'taking' }),
      confirmed({ productName: 'Old', source: 'note', status: 'stopped', actualDose: '', frequency: 'unknown' }),
      confirmed({ productName: 'Aspirin', source: 'photo', strengthUnknown: true, actualUseUnknown: true }),
    ],
    [{ id: 'f1', flagType: 'possible_duplicate', explanation: 'Same clinical product', status: 'open', medicationAId: 'a', medicationBId: 'b' }],
  );
  assert.equal(summary.counts.added, 2);
  assert.equal(summary.counts.stopped, 1);
  assert.ok(summary.counts.uncertain >= 1);
  assert.equal(summary.counts.duplicate, 1);
  assert.match(summary.uncertain[0].reasons.join(' '), /Strength|use/i);
});

test('delivery label reserves Received for durable ack only', () => {
  assert.equal(deliveryLabel('pending'), 'Submitted — waiting for clinic receipt');
  assert.equal(deliveryLabel('received'), 'Received by the clinic');
  assert.equal(parseAprimaStatus('entered_manually'), 'entered_manually');
  assert.throws(() => parseAprimaStatus('write_back'), ClinicSubmissionError);
});

test('patient portal copy never frames email/SMS/OS share as clinic delivery', () => {
  assert.match(PATIENT_SEND_CTA, /secure clinic portal/i);
  assert.doesNotMatch(PATIENT_SEND_CTA, /email|text|share sheet|SMS/i);
  assert.match(STAFF_INBOX_INTRO, /portal inbox/i);
  assert.match(STAFF_INBOX_INTRO, /Not email delivery/i);
  const pending = patientReceiptCopy('pending');
  assert.match(pending.headline, /secure clinic portal/i);
  assert.match(pending.portalNote, /not clinic delivery/i);
  assert.doesNotMatch(pending.headline, /Received by the clinic/);
  const received = patientReceiptCopy('received');
  assert.equal(received.headline, 'Received by the clinic.');
  assert.match(received.portalNote, /staff portal inbox/i);
  assert.match(received.portalNote, /Do not text, email, or use your phone/i);
});

test('appointment calendar date uses appointment timezone', () => {
  assert.equal(appointmentCalendarDate('2026-11-03T14:30:00-05:00', 'America/New_York'), '2026-11-03');
});

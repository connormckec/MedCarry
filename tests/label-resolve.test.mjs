import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editDistance,
  proposeCategory,
  resolveLabelDraft,
  segmentLabelLines,
} from '../lib/label-resolve.ts';

test('segments pharmacy noise away from product and directions', () => {
  const segs = segmentLabelLines('DEMO PHARMACY\nQty: 90\nMETOPROLOL TARTRATE 25 MG TABLETS\nTake 1 tablet by mouth twice daily.\nRefills: 2');
  assert.equal(segs.find((s) => /METOPROLOL/i.test(s.line))?.segment, 'product');
  assert.equal(segs.find((s) => /Take 1/i.test(s.line))?.segment, 'directions');
  assert.ok(segs.some((s) => s.segment === 'pharmacy_noise'));
});

test('edit distance catches common OCR letter slips', () => {
  assert.ok(editDistance('tartrte', 'tartrate') <= 2);
  assert.ok(editDistance('metoprolol', 'metoprolol') === 0);
});

test('misspelled metoprolol tartrate corrects into the draft name', () => {
  const r = resolveLabelDraft('DEMO PHARMACY\nMETOPROLOL TARTRTE 25 MG TABLETS\nTake 1 tablet by mouth twice daily.\nWith meals.');
  assert.equal(r.spellingCorrected, true);
  assert.match(r.fields.productName, /Metoprolol Tartrate/i);
  assert.equal(r.fields.strength, '25 MG');
  // Fixtures may only have another strength — spelling still lands in the draft; strength stays from the label.
  assert.ok(r.notices.some((n) => /Corrected spelling|Matched name/i.test(n)));
  // Never invent dose/frequency from DB beyond label SIG draft.
  assert.equal(r.fields.frequency, 'twice');
  assert.equal(r.fields.actualDose, '1');
});

test('aligned strength attaches reference without changing label strength text', () => {
  const r = resolveLabelDraft('METOPROLOL TARTRATE 50 MG TABLETS\nTake 1 tablet by mouth twice daily.');
  assert.match(r.fields.productName, /Metoprolol Tartrate/i);
  assert.match(r.fields.strength, /50/i);
  assert.ok(r.fields.rxCui);
});

test('look-alike strengths stay distinct and do not silent-substitute', () => {
  const five = resolveLabelDraft('ELIQUIS 5 MG TABLET\nTake 1 tablet by mouth twice daily.');
  const low = resolveLabelDraft('ELIQUIS 2.5 MG TABLET\nTake 1 tablet by mouth twice daily.');
  assert.notEqual(five.fields.rxCui, low.fields.rxCui);
  assert.match(five.fields.productName, /Eliquis/i);
  assert.match(low.fields.strength, /2\.5/i);
});

test('prior authorized list may rank but not override contradictory strength', () => {
  const r = resolveLabelDraft('apixaban 2.5 MG tablet\nTake 1 tablet daily.', {
    priorMeds: [{ productName: 'Eliquis', strength: '5 mg', formulation: 'tablet', category: 'prescription', rxCui: '1364447' }],
  });
  assert.match(r.fields.strength, /2\.5/i);
  assert.notEqual(r.fields.rxCui, '1364447');
});

test('category proposal keeps OTC distinct from supplements', () => {
  const otc = proposeCategory('Ibuprofen 200 mg\nOver the counter pain reliever', { category: 'prescription', productName: 'Ibuprofen', supplementFacts: '' });
  assert.equal(otc.category, 'otc');
  const supp = proposeCategory('Vitamin D3\nSupplement Facts\nServing size 1 softgel', { category: 'prescription', productName: 'Vitamin D3', supplementFacts: '' });
  assert.equal(supp.category, 'supplement');
  assert.equal(supp.needsAsk, false);
});

test('ambiguous near-ties ask rather than silent substitute', () => {
  const r = resolveLabelDraft('SOME UNKNOWN MEDXYZ 10 MG\nTake as directed.');
  assert.equal(r.spellingCorrected, false);
  assert.ok(!r.fields.rxCui || r.ambiguous || r.notices.length);
});

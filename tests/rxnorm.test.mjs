import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTerminologyQuery,
  findDuplicateFlags,
  normalizeFromFixture,
  terminologyForOutage,
  patientDuplicatePrompt,
  parseDuplicateResponse,
  RxNormError,
} from '../lib/rxnorm.ts';
import { emptyMedication } from '../lib/medication.ts';

const base = (over = {}) => ({
  ...emptyMedication(),
  category: 'prescription',
  formulation: 'tablet',
  strengthUnknown: false,
  ...over,
});

test('terminology query uses name/strength/form only and rejects note-like payloads', () => {
  const q = buildTerminologyQuery(base({ productName: 'Eliquis', strength: '5 mg', formulation: 'tablet' }));
  assert.match(q, /Eliquis/);
  assert.match(q, /5 mg/);
  assert.doesNotMatch(q, /patient|dob|ssn/i);
  assert.throws(() => buildTerminologyQuery(base({ productName: 'Patient DOB 1948-03-12' })), RxNormError);
  assert.throws(() => buildTerminologyQuery(base({ productName: 'ab' })), RxNormError);
  assert.throws(() => buildTerminologyQuery(base({ category: 'supplement', productName: 'Vitamin D' })), RxNormError);
});

test('Eliquis and apixaban at the same strength normalize to the same clinical drug', () => {
  const brand = normalizeFromFixture(base({ productName: 'Eliquis', strength: '5 mg' }));
  const generic = normalizeFromFixture(base({ productName: 'apixaban', strength: '5 mg' }));
  assert.equal(brand.mappingStatus, 'candidate');
  assert.equal(generic.mappingStatus, 'candidate');
  assert.equal(brand.clinicalDrugRxCui, '1364445');
  assert.equal(generic.clinicalDrugRxCui, '1364445');
  assert.equal(brand.ingredientRxCuis[0], '1364430');
  assert.ok(brand.originalProductName === 'Eliquis');
  assert.ok(generic.originalProductName === 'apixaban');
});

test('different apixaban strengths stay distinct and flag as strength review only', () => {
  const five = normalizeFromFixture(base({ productName: 'apixaban', strength: '5 mg' }));
  const low = normalizeFromFixture(base({ productName: 'apixaban', strength: '2.5 mg' }));
  assert.notEqual(five.clinicalDrugRxCui, low.clinicalDrugRxCui);
  const flags = findDuplicateFlags([
    { id: 'a', productName: 'apixaban', strength: '5 mg', formulation: 'tablet', frequency: 'twice', terminology: five },
    { id: 'b', productName: 'apixaban', strength: '2.5 mg', formulation: 'tablet', frequency: 'daily', terminology: low },
  ]);
  assert.equal(flags.some((f) => f.flagType === 'possible_duplicate'), false);
  assert.equal(flags.some((f) => f.flagType === 'different_strength_or_schedule'), true);
  assert.match(flags.find((f) => f.flagType === 'different_strength_or_schedule').explanation, /intentional|strength/i);
});

test('brand/generic same clinical product proposes an explainable possible_duplicate flag', () => {
  const brand = normalizeFromFixture(base({ productName: 'Eliquis', strength: '5 mg' }));
  const generic = normalizeFromFixture(base({ productName: 'apixaban', strength: '5 mg' }));
  const flags = findDuplicateFlags([
    { id: '11111111-1111-4111-8111-111111111111', productName: 'Eliquis', strength: '5 mg', formulation: 'tablet', terminology: brand },
    { id: '22222222-2222-4222-8222-222222222222', productName: 'apixaban', strength: '5 mg', formulation: 'tablet', terminology: generic },
  ]);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].flagType, 'possible_duplicate');
  assert.match(flags[0].explanation, /Brand and generic|clinical product/i);
  assert.equal(flags[0].evidence.clinicalDrugRxCui, '1364445');
});

test('metoprolol tartrate vs succinate extended release are distinct release flags', () => {
  const ir = normalizeFromFixture(base({ productName: 'metoprolol tartrate', strength: '50 mg' }));
  const er = normalizeFromFixture(base({ productName: 'metoprolol succinate', strength: '50 mg' }));
  assert.equal(ir.clinicalDrugRxCui, '866514');
  assert.equal(er.clinicalDrugRxCui, '866436');
  assert.equal(er.releaseCharacteristic.includes('Extended'), true);
  const flags = findDuplicateFlags([
    { id: 'a', productName: 'metoprolol tartrate', strength: '50 mg', formulation: 'tablet', terminology: ir },
    { id: 'b', productName: 'metoprolol succinate', strength: '50 mg', formulation: 'tablet', terminology: er },
  ]);
  assert.equal(flags.some((f) => f.flagType === 'possible_duplicate'), false);
  assert.equal(flags.some((f) => f.flagType === 'different_formulation_release'), true);
  assert.match(flags.find((f) => f.flagType === 'different_formulation_release').explanation, /do not combine/i);
});

test('ingredient overlap with a combination product is flagged for staff review only', () => {
  const metro = normalizeFromFixture(base({ productName: 'metoprolol tartrate', strength: '50 mg' }));
  const combo = normalizeFromFixture(base({ productName: 'Lopressor HCT', strength: '50/25 mg' }));
  assert.ok(combo.ingredientRxCuis.includes('6918'));
  assert.ok(combo.ingredientRxCuis.includes('5487'));
  const flags = findDuplicateFlags([
    { id: 'a', productName: 'metoprolol tartrate', strength: '50 mg', formulation: 'tablet', terminology: metro },
    { id: 'b', productName: 'Lopressor HCT', strength: '50/25 mg', formulation: 'tablet', terminology: combo },
  ]);
  assert.equal(flags.some((f) => f.flagType === 'ingredient_overlap'), true);
  assert.match(flags.find((f) => f.flagType === 'ingredient_overlap').explanation, /not an instruction to stop or merge/i);
});

test('unmatched and outage paths stay usable without inventing identity', () => {
  const unmatched = normalizeFromFixture(base({ productName: 'Completely Unknownzyme', strength: '1 mg' }));
  assert.equal(unmatched.mappingStatus, 'unmatched');
  assert.equal(unmatched.rxCui, '');
  assert.equal(unmatched.originalProductName, 'Completely Unknownzyme');
  const outage = terminologyForOutage(base({ productName: 'Eliquis', strength: '5 mg' }), 'Eliquis 5 mg tablet');
  assert.equal(outage.mappingStatus, 'unavailable');
  assert.equal(outage.rxCui, '');
  assert.match(outage.notes.join(' '), /unavailable|manually/i);
  const flags = findDuplicateFlags([
    { id: 'a', productName: 'Completely Unknownzyme', strength: '1 mg', formulation: 'tablet', terminology: unmatched },
    { id: 'b', productName: 'Eliquis', strength: '5 mg', formulation: 'tablet', terminology: outage },
  ]);
  assert.equal(flags.length, 0);
});

test('supplements stay unmatched and patient prompt copy is fixed', () => {
  const supp = normalizeFromFixture(base({ category: 'supplement', productName: 'Vitamin D3', strength: '2000 IU' }));
  assert.equal(supp.mappingStatus, 'unmatched');
  assert.equal(patientDuplicatePrompt(), 'Looks similar to another medicine on your list.');
  assert.equal(parseDuplicateResponse('take_both'), 'take_both');
  assert.throws(() => parseDuplicateResponse('merge_now'), RxNormError);
});

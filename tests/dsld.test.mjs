import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDsldMatch,
  buildDsldProductQuery,
  formatDsldSupplementFacts,
  mapDsldHits,
  DsldError,
} from '../lib/dsld.ts';
import { emptyMedication } from '../lib/medication.ts';

test('DSLD query sends product terminology only', () => {
  const q = buildDsldProductQuery({ productName: 'Vitamin D3', brandName: "Nature's Bounty", strength: '2000 IU' });
  assert.match(q, /Vitamin D3/);
  assert.match(q, /Nature's Bounty/);
  assert.doesNotMatch(q, /patient|dob|ssn/i);
  assert.throws(() => buildDsldProductQuery({ productName: 'Patient DOB 1948-03-12' }), DsldError);
  assert.throws(() => buildDsldProductQuery({ productName: 'ab' }), DsldError);
});

test('mapDsldHits preserves brand, form, and serving summary', () => {
  const hits = mapDsldHits({
    hits: [{
      _id: '46331',
      _source: {
        fullName: '2000 IU Vitamin D-3',
        brandName: "Member's Mark",
        upcSku: '0 78742 09416 8',
        physicalState: { langualCodeDescription: 'Softgel Capsule' },
        servingSizes: [{ unit: 'Softgel(s)', minQuantity: 1, maxQuantity: 1, inSFB: true }],
      },
    }],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].brandName, "Member's Mark");
  assert.match(hits[0].servingSummary, /1 Softgel/i);
  const facts = formatDsldSupplementFacts(hits[0]);
  assert.match(facts, /Label serving size/);
  assert.match(facts, /not your reported use/);
  const fields = applyDsldMatch(emptyMedication(), hits[0]);
  assert.equal(fields.category, 'supplement');
  assert.equal(fields.rxCui, '');
  assert.match(fields.productName, /Member's Mark/);
  assert.match(fields.supplementFacts, /per serving on the label/);
  // Patient use fields stay empty — serving is label fact only.
  assert.equal(fields.actualDose, '');
  assert.equal(fields.frequency, 'unknown');
});

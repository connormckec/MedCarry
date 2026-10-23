import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMedicationSection,historicalUseProposal,noteMedicationKey} from '../lib/note-import.ts';
import {validateFields,useSummary,snapshotText} from '../lib/medication.ts';
const parse=(s)=>parseMedicationSection(s,'Fictional cardiology note','2026-07-01');

test('import proposals retain source and never establish current use',()=>{
  const {fields}=parse('Metoprolol tartrate 25 mg tablet; take 1 tablet by mouth twice daily.')[0];
  assert.equal(fields.productName,'Metoprolol tartrate');assert.equal(fields.strength,'25 mg');
  assert.equal(fields.source,'note');assert.equal(fields.sourceDate,'2026-07-01');assert.match(fields.sourceText,/take 1/);
  assert.equal(fields.status,'unsure');assert.equal(fields.actualUseUnknown,true);assert.equal(fields.actualDose,'');
  assert.equal(fields.labelDirections,'');assert.match(useSummary(fields),/uncertain/);
});
test('explicit historical tablet use becomes a proposal only when reviewed',()=>{
  const original=parse('Metoprolol tartrate 25 mg tablet; take 1 tablet by mouth twice daily.')[0].fields;
  const proposed=historicalUseProposal(original);assert.equal(proposed.actualDose,'1');assert.equal(proposed.frequency,'twice');
  assert.equal(original.actualUseUnknown,true);assert.equal(original.actualDose,'');assert.equal(proposed.labelDirections,'');
});
test('a product strength and frequency never imply one tablet',()=>{
  const fields=parse('Apixaban 5 mg twice daily')[0].fields;
  const proposed=historicalUseProposal(fields);assert.equal(proposed.actualDose,'');assert.equal(proposed.actualUseUnknown,true);
});
test('a concentration never becomes an injected dose',()=>{
  const fields=parse('Insulin glargine 100 units/mL daily')[0].fields;
  assert.equal(historicalUseProposal(fields).actualDose,'');
  const explicit=parse('Insulin glargine 100 units/mL; inject 10 units daily')[0].fields;
  assert.equal(historicalUseProposal(explicit).actualDose,'10');
});
test('half tablets preserve strength and the original instructions',()=>{
  const fields=parse('Lisinopril 10 mg tablet; take 1/2 tablet every morning daily')[0].fields;
  const proposed=historicalUseProposal(fields);assert.equal(proposed.actualDose,'1/2');assert.equal(proposed.strength,'10 mg');assert.equal(fields.actualDose,'');
});
test('historical stop status and tapers are never flattened into active use',()=>{
  for(const line of ['Warfarin 5 mg tablet; take 1 tablet daily; discontinued','Prednisone 10 mg tablet; take 3 tablets daily then 2 tablets for 3 days']){
    const fields=parse(line)[0].fields;assert.equal(historicalUseProposal(fields).actualUseUnknown,true);
  }
});
test('combined strengths stay combined and require review',()=>{
  const row=parse('Losartan-hydrochlorothiazide 50-12.5 mg tablet daily')[0];assert.equal(row.fields.strength,'50-12.5 mg');assert.ok(row.warnings.some(s=>/Combination/.test(s)));
});
test('duplicate and non-medication candidates remain visible for staff exclusion',()=>{
  const rows=parse('Medications:\n- Aspirin 81 mg daily\nAspirin 81 mg daily\nPatient feels well');
  assert.equal(rows.length,3);assert.ok(rows[1].warnings.some(w=>/Duplicate/.test(w)));assert.ok(rows[2].warnings.some(w=>/may not be/.test(w)));
  assert.equal(noteMedicationKey(rows[0].fields),noteMedicationKey(rows[1].fields));
});
test('input bounds and impossible source dates are rejected',()=>{
  assert.throws(()=>parse('x'.repeat(24001)),/24,000/);assert.throws(()=>parse(Array(41).fill('Aspirin 81 mg').join('\n')),/40 lines/);
  const fields=parse('Aspirin 81 mg daily')[0].fields;assert.throws(()=>validateFields({...fields,sourceDate:'2026-02-30'}),/source date/);
});
test('provider export distinguishes the old source from the current report',()=>{
  const fields=parse('Aspirin 81 mg daily')[0].fields;
  const text=snapshotText({id:'s',patientName:'Fictional',recipient:'Demo',createdAt:'2026-10-22T12:00:00Z',medications:[{...fields,id:'m',profileId:'p',revision:1,confirmedRevision:1,confirmedAt:'2026-10-22T12:00:00Z',sourceIds:[],createdAt:'',updatedAt:''}]});
  assert.match(text,/Historical source: Fictional cardiology note/);assert.match(text,/Original historical entry \(not current instructions\)/);assert.match(text,/Current use uncertain/);
});
test('missing formulation and negative or PRN use stay uncertain',()=>{const bare=parse('Apixaban 5 mg twice daily')[0].fields;assert.equal(bare.formulation,'other');assert.equal(bare.doseUnit,'other');for(const line of ['Lisinopril 10 mg tablet; take 1 tablet daily; patient not taking','Furosemide 20 mg tablet; take 1 tablet as needed every 6 hours'])assert.equal(historicalUseProposal(parse(line)[0].fields).actualUseUnknown,true);});

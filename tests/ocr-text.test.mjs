import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWeakOcrText,
  normalizeOcrText,
  ocrExcerpt,
  pickBestOcrCandidate,
  scoreLabelText,
} from '../lib/ocr-text.ts';

test('normalizeOcrText repairs common OCR unit glitches without inventing drugs', () => {
  assert.match(normalizeOcrText('Lisinopril 10 rnq'), /10 mg/i);
  assert.match(normalizeOcrText('Take 5 m1 by mouth'), /5 mL/i);
  assert.equal(normalizeOcrText('PHARMACY\n\n\nRx'), 'PHARMACY\n\nRx');
});

test('scoreLabelText prefers strength and directions over pharmacy headers', () => {
  const good = scoreLabelText('METOPROLOL TARTRATE 25 MG TABLETS\nTake 1 tablet by mouth twice daily.');
  const header = scoreLabelText('DEMO PHARMACY\nRx #12345\nPatient Example\nTel 555-0100');
  assert.ok(good > header);
  assert.ok(good >= 40);
  assert.ok(isWeakOcrText('DEMO PHARMACY\nRx #12345'));
  assert.equal(isWeakOcrText('METOPROLOL TARTRATE 25 MG\nTake 1 tablet daily.'), false);
});

test('pickBestOcrCandidate selects the medication-bearing pass', () => {
  const best = pickBestOcrCandidate([
    { text: 'PHARMACY\nQty 30', confidence: 80, source: 'weak' },
    { text: 'ATORVASTATIN 40 MG\nTake 1 tablet by mouth once daily.', confidence: 55, source: 'good' },
    { text: '', confidence: 90, source: 'empty' },
  ]);
  assert.ok(best);
  assert.match(best.text, /ATORVASTATIN/);
  assert.equal(best.source, 'good');
});

test('ocrExcerpt flattens newlines for patient notices', () => {
  const excerpt = ocrExcerpt('Line one\nLine two\nLine three', 40);
  assert.match(excerpt, / · /);
  assert.ok(excerpt.length <= 40);
});

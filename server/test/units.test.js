import './setup.js';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseDate } from '../src/routes/import.js';
import { normalizeName, normalizeProjectName, formatINR } from '../src/lib/util.js';
import { computeCalcPsf } from '../src/services/records.js';
import { bandIssues } from '../src/routes/admin.js';
import { coerce } from '../src/services/registry.js';
import { pool } from '../src/db.js';

after(() => pool.end());

describe('Indian money & date parsing', () => {
  it('parses crore / lakh notations into whole rupees', () => {
    assert.equal(parseMoney('1.35 Cr'), 13500000);
    assert.equal(parseMoney('₹85 L'), 8500000);
    assert.equal(parseMoney('1,35,00,000'), 13500000);
    assert.equal(parseMoney(13500000), 13500000);
    assert.ok(Number.isNaN(parseMoney('about a crore')));
  });
  it('parses common date formats', () => {
    assert.equal(parseDate('2030-06-01'), '2030-06-01');
    assert.equal(parseDate('06/2030'), '2030-06-01');
    assert.equal(parseDate('Dec 2032'), '2032-12-01');
    assert.equal(parseDate("Dec'32"), '2032-12-01');
    assert.equal(parseDate('15/08/2029'), '2029-08-15');
    assert.equal(parseDate(47635), '2030-06-01'); // Excel serial
    assert.equal(parseDate('soon'), 'INVALID');
  });
  it('formats rupees for display', () => {
    assert.equal(formatINR(13500000), '₹1.35 Cr');
    assert.equal(formatINR(8500000), '₹85 L');
  });
});

describe('Normalisation for duplicate detection', () => {
  it('treats developer suffixes as noise', () => {
    assert.equal(normalizeName('Hiranandani Group'), normalizeName('Hiranandani'));
    assert.equal(normalizeName('L&T Realty Ltd.'), normalizeName('L and T'));
  });
  it('keeps meaningful project words', () => {
    assert.equal(normalizeProjectName('ABC Heights!'), 'abc heights');
  });
});

describe('₹/sq.ft. calculation', () => {
  it('uses the midpoint of ranges on the chosen basis', () => {
    assert.equal(computeCalcPsf({ price_from: 10000000, price_to: 12000000, carpet_from: 500, carpet_to: 600, psf_basis: 'carpet' }), 20000);
    assert.equal(computeCalcPsf({ price_from: 13800000, sbua_from: 1000, carpet_from: 690, psf_basis: 'sbua' }), 13800);
    assert.equal(computeCalcPsf({ price_on_request: true, price_from: 1, carpet_from: 1 }), null);
    assert.equal(computeCalcPsf({ price_from: 10000000 }), null);
  });
});

describe('Band checks', () => {
  it('finds gaps and overlaps', () => {
    const issues = bandIssues([{ label: 'A', lower_bound: null, upper_bound: 100 }, { label: 'B', lower_bound: 120, upper_bound: 200 }, { label: 'C', lower_bound: 150, upper_bound: null }]);
    assert.equal(issues.length, 2);
  });
});

describe('Input coercion', () => {
  it('rejects malformed values with a field-specific message', () => {
    assert.throws(() => coerce({ t: 'int', min: 0, max: 10 }, 'abc', 'Floors'), /Floors: must be a whole number/);
    assert.throws(() => coerce({ t: 'date' }, '2030-13-45', 'RERA'), /RERA: must be a date/);
    assert.equal(coerce({ t: 'num', min: 0, max: 1e12, integer: true }, '1,35,00,000', 'Price'), 13500000);
  });
});

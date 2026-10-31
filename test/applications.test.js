const test = require('node:test');
const assert = require('node:assert');
const { onStatusChange, setStage, setNotes } = require('../src/main/applications');

test('marking a job applied starts its application at the Applied stage', () => {
  const job = { id: 'x', status: 'seen' };
  onStatusChange(job, 'saved');
  assert.strictEqual(job.application, undefined);
  onStatusChange(job, 'applied', '2026-10-01T00:00:00Z');
  assert.deepStrictEqual(job.application, { stage: 'applied', history: [{ stage: 'applied', at: '2026-10-01T00:00:00Z' }], notes: '' });
});

test('stage changes are recorded once, with dates, and survive un-applying', () => {
  const job = { id: 'x', status: 'applied' };
  onStatusChange(job, 'applied', 't0');
  setStage(job, 'interview', 't1');
  setStage(job, 'interview', 't2'); // no duplicate entry
  setStage(job, 'rejected', 't3');
  assert.deepStrictEqual(job.application.history.map((e) => [e.stage, e.at]),
    [['applied', 't0'], ['interview', 't1'], ['rejected', 't3']]);
  onStatusChange(job, 'seen'); // user un-clicks "Applied"
  onStatusChange(job, 'applied');
  assert.strictEqual(job.application.stage, 'rejected');
  assert.throws(() => setStage(job, 'hired?'));
});

test('setting a stage or notes on an unapplied job marks it applied', () => {
  const job = { id: 'x', status: 'saved' };
  setStage(job, 'screening', 't1');
  assert.strictEqual(job.status, 'applied');
  assert.deepStrictEqual(job.application.history.map((e) => e.stage), ['applied', 'screening']);
  setNotes(job, 'x'.repeat(10000));
  assert.strictEqual(job.application.notes.length, 5000);
});

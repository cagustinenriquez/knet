// Application tracking: where each job you applied to stands. Pure functions, unit tested.

const STAGES = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn'];
const MAX_NOTES = 5000;

// Called when a job's status changes. Marking a job "applied" starts its application;
// un-marking keeps the record, so re-applying picks up where it left off.
function onStatusChange(job, status, at = new Date().toISOString()) {
  if (status === 'applied' && !job.application) {
    job.application = { stage: 'applied', history: [{ stage: 'applied', at }], notes: '' };
  }
  return job;
}

function setStage(job, stage, at = new Date().toISOString()) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
  onStatusChange(job, 'applied', at);
  job.status = 'applied';
  if (job.application.stage !== stage) {
    job.application.stage = stage;
    job.application.history.push({ stage, at });
  }
  return job;
}

function setNotes(job, notes) {
  onStatusChange(job, 'applied');
  job.application.notes = String(notes ?? '').slice(0, MAX_NOTES);
  return job;
}

module.exports = { STAGES, onStatusChange, setStage, setNotes };

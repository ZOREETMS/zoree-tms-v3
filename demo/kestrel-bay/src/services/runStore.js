'use strict';
// Current run, human decisions, and the audit log the IT Director asks about.
const state = { job: null, decisions: {}, log: [] };

function log(event, detail) {
  state.log.unshift({ at: new Date().toISOString(), event, detail });
  if (state.log.length > 500) state.log.length = 500;
}

function newJob(mode, { offline = false } = {}) {
  const job = {
    id: Date.now().toString(36), mode, offline, status: 'running', startedAt: new Date().toISOString(),
    total: 0, results: [], events: [], summary: null, checks: [],
    emit(step, text, extra) { this.events.push({ at: Date.now(), step, text, ...(extra || {}) }); },
  };
  state.job = job;
  state.decisions = {};
  log('run.started', { id: job.id, mode });
  return job;
}

function finishJob(job, error) {
  job.status = error ? 'failed' : 'done';
  job.error = error ? error.message : undefined;
  job.finishedAt = new Date().toISOString();
  log(error ? 'run.failed' : 'run.completed', error ? { error: error.message } : { total: job.summary.total, toPerson: job.summary.toPerson });
}

function getJob() { return state.job; }
function getDecisions() { return state.decisions; }
function getLog() { return state.log; }

function recordDecision(seq, decision) {
  state.decisions[seq] = { ...decision, at: new Date().toISOString() };
  log('decision', { seq, action: decision.action, by: decision.by });
  return state.decisions[seq];
}

module.exports = { newJob, finishJob, getJob, getDecisions, getLog, recordDecision, log };

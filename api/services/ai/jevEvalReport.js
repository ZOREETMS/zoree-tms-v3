// Markdown report for a jevEval run — every figure is from this run only.
'use strict';

function fmt(v, suffix = '') {
  return v === null || v === undefined ? 'n/a' : `${v}${suffix}`;
}

function caseRow(c) {
  const ok = c.runs.filter((r) => r.ok);
  const vetoes = ok.filter((r) => r.veto).length;
  const first = ok[0] || {};
  const keyword = `${c.keyword.cmd || '—'}${c.keyword.arg1 ? ` ${c.keyword.arg1}` : ''}${c.label === 'question' && c.keyword.wouldChangeData ? ' ⚠️' : ''}`;
  const pq = ok.map((r) => (typeof r.pQuestion === 'number' ? r.pQuestion.toFixed(2) : '?')).join('/');
  return `| ${c.id} | ${c.label} | ${c.text.replace(/\|/g, '\\|')} | ${keyword} | ${first.intent || 'error'} | ${pq} | ${vetoes}/${c.runs.length} |`;
}

function toMarkdown({ summary: s, results }) {
  const lines = [
    `# Jev intent gate — evaluation run ${s.startedAt}`,
    '',
    `**Conditions:** ${s.cases} labeled messages × ${s.runsPerCase} runs = ${s.calls} Jev calls · model ${s.models.join(', ') || s.modelConfigured} · veto threshold ${s.vetoThreshold} · timeout ${s.timeoutMs} ms (production setting) · ${s.errors} errors (${s.timeouts} timeouts) · run from the ZoreeTMS dev machine.`,
    '',
    '**Counting:** rates are over all runs; an errored run counts as not blocked, as in fail-open production.',
    '',
    '**Caveat:** the messages were written by hand to probe the keyword parser, so these are results on this set, not a production rate.',
    '',
    '## Results',
    '',
    `- **Keyword parser risk:** ${s.questions.keywordWouldChangeData} of ${s.questions.total} questions would change TMS data.`,
    `- **Jev protection on those:** blocked ${s.questions.runsBlocked} of ${s.questions.runsOnThose} calls (${fmt(s.questions.blockRatePct, '%')}, ${s.questions.runsErrored} errored); ${s.questions.casesBlockedEveryRun} of ${s.questions.keywordWouldChangeData} messages blocked on every run.`,
    `- **False blocks on real commands:** ${s.commands.runsFalselyBlocked} of ${s.commands.runsOnThose} calls (${fmt(s.commands.falseBlockRatePct, '%')}, ${s.commands.runsErrored} errored) across ${s.commands.reachingGate} commands.`,
    `- **Inconsistent between runs:** ${s.inconsistentCases.length ? s.inconsistentCases.join(', ') : 'none'}.`,
    `- **Latency** (successful calls, includes network from this machine; see timeouts above): p50 ${fmt(s.latencyMs.p50, ' ms')}, p95 ${fmt(s.latencyMs.p95, ' ms')}, max ${fmt(s.latencyMs.max, ' ms')}.`,
    `- **Cost:** ${fmt(s.tokens.avgPerCall)} input tokens per call; $${s.costUsd.total} for this run; about $${fmt(s.costUsd.per1000Messages)} per 1,000 messages at $${s.pricePerMTok}/M input tokens (published price, not your invoice).`,
    '',
    '## Per message',
    '',
    '⚠️ = a question the keyword parser would turn into a data change. p(question) is listed per run.',
    '',
    '| id | label | message | keyword parser | Jev intent | p(question) | blocked |',
    '|---|---|---|---|---|---|---|',
    ...results.map(caseRow),
    '',
  ];
  const errors = results.flatMap((c) => c.runs.filter((r) => !r.ok).map((r) => `- ${c.id}: ${r.error}`));
  if (errors.length) lines.push('## Errors', '', ...errors, '');
  return lines.join('\n');
}

module.exports = { toMarkdown };

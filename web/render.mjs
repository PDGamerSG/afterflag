const v2Schema = 'afterflag/release-proof/v2';
const legacySchema = 'afterflag/v1';
const unavailable = 'Unavailable';

const stages = {
  'provider-ready': ['Provider connected', 'Flagsmith is available for the rehearsal.', 'Provider'],
  baseline: ['Baseline observed', 'Flagsmith cohort decisions before the rollout.', 'Baseline'],
  'legacy-admitted': ['Old-codec job admitted', 'The queue retained a job encoded before cutover.', 'Admit'],
  'pilot-opened': ['Pilot opened', 'Flagsmith reads the pilot and stable cohort decisions after opening the pilot.', 'Pilot'],
  promoted: ['Stable cohort promoted', 'Flagsmith reads both cohort decisions after the promotion.', 'Promote'],
  fenced: ['Old admission fenced', 'The queue checks admission with a stale producer decision and replays the existing job.', 'Fence'],
  blocker: ['Retirement blocked', 'The gate examines retained work and the candidate’s attempt to decode it.', 'Block'],
  'health-blocked': ['Unhealthy signal recorded', 'Flagsmith Feature Health reflects the blocked gate.', 'Health'],
  'halt-before-drain': ['Rehearsal stopped at the gate', 'The run ended with the retained job still in the queue.', 'Stop'],
  hold: ['Bridge held', 'A separate Flagsmith hold tests whether the bridge pauses with zero effects.', 'Hold'],
  drained: ['Bridge drained old work', 'The bridge runs again after the hold is released.', 'Drain'],
  lifecycle: ['Old-job lifecycle replayed', 'A separate queue exercises retirement safety across delayed, held, retryable, claimed and dead-letter jobs.', 'Replay'],
  'replacement-admitted': ['New-codec job admitted', 'The queue accepts a job encoded under the promoted Flagsmith policy.', 'Admit'],
  candidate: ['Candidate processed new work', 'The candidate receives a job encoded under the new policy.', 'Candidate'],
  redelivery: ['Redelivery checked', 'The candidate checks for an existing receipt on redelivery.', 'Redeliver'],
  retired: ['Retirement evaluated', 'The gate evaluates the closed admission lane and remaining old-codec work.', 'Retire'],
  'health-ready': ['Healthy signal recorded', 'Flagsmith Feature Health reflects the final gate result.', 'Health'],
  error: ['Rehearsal interrupted', 'The report preserves the events recorded up to the interruption.', 'Error'],
  rollout: ['Producer switched codecs', 'The legacy rehearsal records the producer cutover.', 'Rollout'],
  'candidate-before-drain': ['Candidate challenged', 'The legacy rehearsal attempts to decode an old job.', 'Challenge'],
  'retirement-before-fence': ['Open admission checked', 'The legacy rehearsal checks retirement before fencing admission.', 'Block'],
  'worker-restart': ['Worker restarted', 'A child process reopens the durable queue.', 'Restart'],
  'drain-old': ['Bridge processed old work', 'The legacy rehearsal drains the retained job.', 'Drain'],
  'drain-and-retire': ['Retirement evaluated', 'The legacy rehearsal records the final gate result.', 'Retire']
};

const compactStageLabels = {
  Baseline: 'Base', Promote: 'Stable', Rollout: 'Roll', Challenge: 'Test',
  Provider: 'Setup', Candidate: 'Run', Redeliver: 'Retry'
};
const primaryStages = new Set([
  'baseline', 'pilot-opened', 'promoted', 'fenced', 'blocker', 'drained', 'retired',
  'rollout', 'candidate-before-drain', 'retirement-before-fence', 'hold', 'drain-old', 'drain-and-retire'
]);
const rolloutStates = {
  new: { y: 26, label: 'New codec' },
  pilot: { y: 53, label: 'Pilot only' },
  old: { y: 80, label: 'Old codec' }
};
const gateStates = {
  ready: { y: 31, label: 'Ready' },
  blocked: { y: 76, label: 'Blocked' }
};

const fullTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC'
});
const eventTime = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZone: 'UTC'
});

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fields(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function human(value) {
  const words = String(value).replaceAll(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatTime(value, formatter) {
  if (typeof value !== 'number' && typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : formatter.format(date);
}

function renderedTime(value, formatter) {
  const label = formatTime(value, formatter);
  return label ? `<time datetime="${esc(new Date(value).toISOString())}">${esc(label)}</time>` : '';
}

function valueHtml(value) {
  if (value == null || value === '') return `<span class="muted">${unavailable}</span>`;
  return esc(typeof value === 'object' ? JSON.stringify(value) : value);
}

function factList(entries, className = '') {
  return `<dl class="facts ${className}">${entries.map(([key, value]) =>
    `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function getStages(kind) {
  return Object.hasOwn(stages, kind) ? stages[kind] : [human(kind), 'An observation from the rehearsal.', 'Event'];
}

function observedLabel(event) {
  const data = fields(event.data);
  if (['retired', 'drain-and-retire'].includes(event.kind) && gateTransition(event) === 'ready') return 'Retirement authorized';
  if (event.kind === 'blocker' && gateTransition(event) !== 'blocked') return 'Candidate challenged';
  if (event.kind === 'hold' && (data.status ?? fields(data.worker).status ?? data.verdict) !== 'held') return 'Bridge hold checked';
  if (event.kind === 'drained' && fields(data.worker).status !== 'committed' && !data.receipt) return 'Bridge drain attempted';
  if (event.kind === 'candidate' && fields(data.worker).status !== 'committed' && !data.receipt) return 'Candidate delivery attempted';
  const fence = fields(data.fence).status ?? data.fence;
  if (event.kind === 'fenced' && !['fenced', 'closed'].includes(fence)) return 'Old admission checked';
  return event.label;
}

function normalize(raw) {
  if (raw?.schema !== v2Schema && raw?.schema !== legacySchema) {
    throw new Error('Unsupported Afterflag report schema');
  }
  const legacy = raw.schema === legacySchema;
  const metadata = legacy ? {
    scenario: 'Document export',
    scope: raw.summary?.scope ?? 'SQLite document-export rehearsal',
    queue: 'SQLite',
    flagsmith: { version: raw.infrastructure?.image?.split(':').at(-1) },
    startedAt: raw.startedAt
  } : fields(raw.metadata);
  const legacyModes = [raw.flagsmith?.mode, raw.infrastructure?.flagsmith];
  const recordedMode = legacy
    ? legacyModes.includes('fixture') ? 'fixture' : legacyModes.find(Boolean)
    : raw.mode;
  const mode = recordedMode === 'fixture' ? 'fixture'
    : recordedMode === 'live' || (legacy && ['live-local', 'self-hosted-live'].includes(recordedMode))
      ? 'live' : 'unknown';
  const conclusion = fields(raw.conclusion);
  const verdict = legacy
    ? { passed: 'ready', failed: 'blocked' }[raw.status]
    : conclusion.status;
  const status = ['ready', 'blocked'].includes(verdict) ? verdict : 'incomplete';
  const records = legacy ? raw.phases : raw.events;
  const events = (Array.isArray(records) ? records : []).map((record, index) => {
    const item = fields(record);
    const kind = String((legacy ? item.name : item.kind) ?? 'observation');
    const data = legacy ? item : item.data;
    const [label, description, shortLabel] = getStages(kind);
    const event = {
      key: index + 1,
      seq: item.seq ?? index + 1,
      kind,
      label,
      description: legacy && typeof item.message === 'string' ? item.message : description,
      shortLabel,
      at: item.at,
      data,
      previous: item.previous,
      hash: item.hash
    };
    return { ...event, label: observedLabel(event) };
  });
  return {
    legacy, metadata, mode, status, events, schema: raw.schema, id: legacy ? raw.runId : raw.id,
    checks: Array.isArray(conclusion.checks) ? conclusion.checks.map(fields) : [],
    seal: raw.seal, attestation: fields(raw.attestation),
    error: fields(raw.error ?? conclusion.error)
  };
}

function eventNumber(event) {
  return String(event.seq).padStart(2, '0');
}

function queueLabel(queue) {
  return queue === 'postgresql' ? 'PostgreSQL' : queue;
}

function context(report) {
  const values = [report.metadata.title ?? report.metadata.scenario, queueLabel(report.metadata.queue)];
  if (values.every((value) => !value)) return '';
  return `<ul class="run-context" aria-label="Run scope">${values.filter(Boolean).map((label) =>
    `<li>${valueHtml(label)}</li>`).join('')}</ul>`;
}

function snapshotFor(event) {
  const data = fields(event.data);
  return fields(data.snapshot ?? data.queue ?? data.ledger ?? (data.ready != null ? data : undefined));
}

function count(value) {
  const validNumber = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value));
  return validNumber && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

function modeLabel(report) {
  if (report.legacy) return { live: 'Legacy · live', fixture: 'Legacy · fixture', unknown: 'Legacy report' }[report.mode];
  return { live: 'Live run', fixture: 'Fixture run', unknown: 'Mode unknown' }[report.mode];
}

function verdictPanel(report, blocker) {
  const { legacy, mode, status, checks } = report;
  const display = {
    ready: legacy ? 'Legacy check passed' : mode === 'live' ? 'Ready to retire' : 'Readiness recorded',
    blocked: 'Retirement blocked',
    incomplete: 'Proof incomplete'
  };
  const retirement = report.events.find((event) => event.kind === 'retired');
  const finalSnapshot = retirement ? snapshotFor(retirement) : {};
  const closedAndDrained = finalSnapshot.admission === 'retired' && count(finalSnapshot.pending) === 0;
  const detail = {
    ready: legacy ? 'The recorded SQLite rehearsal passed.'
      : mode === 'fixture' ? 'The fixture reached readiness for the declared scenario.'
        : closedAndDrained ? 'Old-codec admission is closed and the queue has no pending old jobs.'
          : 'The recorded release checks passed for the declared scope.',
    blocked: 'The recorded gate found a release blocker.',
    incomplete: 'The report has insufficient evidence for a release verdict.'
  };
  const failed = checks.filter((check) => check.status === 'fail').length;
  const passed = checks.filter((check) => check.status === 'pass').length;
  const snapshot = blocker ? snapshotFor(blocker) : {};
  const pending = count(snapshot.pending);
  const ready = count(snapshot.ready);
  const actualBlocker = pending != null && ready != null
    ? `${formatCount(ready)} ready · ${formatCount(pending)} pending`
    : blocker?.label;
  const checkSummary = failed ? `${failed} of ${checks.length} failed` : `${passed} of ${checks.length} passed`;
  const term = actualBlocker
    ? gateTransition(blocker) === 'blocked' ? 'Recorded blocker' : 'Initial check'
    : checks.length ? 'Release checks' : 'Run record';
  const summary = actualBlocker ?? (checks.length ? checkSummary : report.id ?? unavailable);
  return `<aside class="verdict panel" data-status="${status}" aria-labelledby="verdict-heading">
    <div class="verdict-meta"><span id="verdict-heading">Release verdict</span><span class="mode-tag" data-mode="${mode}">${modeLabel(report)}</span></div>
    <div class="verdict-status"><span class="status-icon" aria-hidden="true"></span><strong>${display[status]}</strong></div>
    <p>${detail[status]}</p>
    <dl class="verdict-foot"><dt>${term}</dt><dd>${valueHtml(summary)}</dd></dl>
  </aside>`;
}

function gateTransition(event) {
  const data = fields(event.data);
  let status;
  if (['blocker', 'lifecycle'].includes(event.kind)) status = fields(data.gate).status ?? data.gate;
  if (['retired', 'retirement-before-fence', 'drain-and-retire'].includes(event.kind)) status = data.status ?? data.verdict;
  if (['ready', 'retired'].includes(status)) return 'ready';
  if (['blocked', 'pending-work', 'pending-old-work', 'admission-open'].includes(status)) return 'blocked';
  return undefined;
}

function policyTransition(event, codecs) {
  if (event.kind === 'rollout') return 'new';
  if (!['baseline', 'pilot-opened', 'promoted'].includes(event.kind)) return undefined;
  const { stable, pilot } = fields(event.data);
  const stableCodec = fields(stable).codec ?? stable;
  const pilotCodec = fields(pilot).codec ?? pilot;
  const old = codecs.old;
  const modern = codecs.new;
  if (!old || !modern) return null;
  if (stableCodec === old && pilotCodec === old) return 'old';
  if (stableCodec === old && pilotCodec === modern) return 'pilot';
  if (stableCodec === modern && pilotCodec === modern) return 'new';
  return null;
}

function seriesFor({ events, legacy, metadata }) {
  const seen = new Set();
  const states = [];
  for (const event of events) {
    if (!primaryStages.has(event.kind) || (!legacy && event.kind === 'hold') || seen.has(event.kind)) continue;
    states.push(event);
    seen.add(event.kind);
  }
  const visible = new Set((states.length ? states : events.slice(0, 7)).map((event) => event.key));
  let rollout;
  let gate;
  return events.flatMap((event) => {
    const policy = policyTransition(event, fields(metadata.codecs));
    if (policy !== undefined) rollout = policy;
    gate = gateTransition(event) ?? gate;
    return visible.has(event.key) ? [{ event, rollout, gate }] : [];
  });
}

function chartScale(title, compact, states, lane) {
  return `<div class="lane lane-${lane}">
    <span class="lane-title"><span class="wide-label">${title}</span><span class="compact-label">${compact}</span></span>
    ${Object.values(states).map(({ y, label }) => `<span class="scale-label" style="--y:${y}%">${label}</span>`).join('')}
  </div>`;
}

function chartLane(series, lane, states) {
  const width = 100 / series.length;
  const plot = series.map((point, index) => {
    const current = point[lane];
    const next = series[index + 1]?.[lane];
    if (!current) return '';
    const x = (index + 0.5) * width;
    const y = states[current].y;
    const horizontal = next
      ? `<span class="track-line" style="--x:${x}%;--y:${y}%;--width:${width}%"></span>` : '';
    const vertical = next && next !== current ? `<span class="track-step" style="--x:${x + width}%;--y:${Math.min(y, states[next].y)}%;--height:${Math.abs(y - states[next].y)}%"></span>` : '';
    const pointSize = series[index - 1]?.[lane] === current ? '' : ' transition-point';
    return `<span class="track track-${current}">${horizontal}${vertical}
      <span class="track-point${pointSize}" style="--x:${x}%;--y:${y}%"></span>
    </span>`;
  }).join('');
  return `<div class="lane lane-${lane}">
    ${Object.values(states).map(({ y }) => `<span class="guide" style="--y:${y}%"></span>`).join('')}
    ${plot}
    ${plot ? '' : '<span class="lane-empty">Awaiting evidence</span>'}
  </div>`;
}

function selectAttrs(event, selected, tabStop = selected) {
  const current = event === selected;
  return `data-select="${event.key}" aria-pressed="${current}" aria-controls="event-${event.key}" tabindex="${event === tabStop ? 0 : -1}"`;
}

function renderChart(report, selected) {
  const series = seriesFor(report);
  if (!series.length) return '<p class="empty chart-empty">Timeline evidence is unavailable in this report.</p>';
  const selectedStage = series.some((item) => item.event === selected) ? selected : series[0].event;
  const buttons = series.map(({ event, rollout, gate }) => {
    const stageDescription = `Event ${event.seq}, ${event.label}. Producer policy: ${rolloutStates[rollout]?.label ?? 'unmeasured'}. Retirement gate: ${gateStates[gate]?.label ?? 'unmeasured'}.`;
    const compact = compactStageLabels[event.shortLabel] ?? event.shortLabel;
    return `<button type="button" class="stage" ${selectAttrs(event, selected, selectedStage)} aria-labelledby="stage-label-${event.key} stage-description-${event.key}">
      <span class="stage-axis" id="stage-label-${event.key}"><span class="wide-label">${esc(event.shortLabel)}</span><span class="compact-label">${esc(compact)}</span></span>
      <span id="stage-description-${event.key}" hidden>${esc(stageDescription)}</span>
    </button>`;
  }).join('');
  return `<div class="chart-grid">
    <div class="chart-scale" aria-hidden="true">
      ${chartScale('Producer policy', 'Policy', rolloutStates, 'rollout')}
      ${chartScale('Retirement gate', 'Gate', gateStates, 'gate')}
    </div>
    <div class="chart-plot">
      <div class="plot-layers" aria-hidden="true">
        ${chartLane(series, 'rollout', rolloutStates)}
        ${chartLane(series, 'gate', gateStates)}
      </div>
      <div class="stage-controls" role="group" aria-label="Recorded stages" data-selection-group style="--columns:${series.length}">${buttons}</div>
    </div>
  </div>
  <div class="chart-footer">
    <p class="chart-selection"><span>Selected stage</span><strong data-chart-selection>${esc(selected.label)}</strong></p>
    <a class="inspect" data-inspect href="#event-${selected.key}">Inspect event <span aria-hidden="true" class="arrow arrow-down"></span></a>
  </div>`;
}

function countPair(snapshot) {
  const ready = count(snapshot.ready);
  const pending = count(snapshot.pending);
  if (ready == null && pending == null) return '';
  return `<div class="snapshot" aria-label="Queue snapshot">
    ${[[ready, 'Ready to claim'], [pending, 'Old-codec jobs pending']].map(([value, label]) => value == null ? '' :
      `<div><strong>${formatCount(value)}</strong><span>${label}</span></div>`).join('')}
  </div>`;
}

function blockingJobs(snapshot) {
  const jobs = Array.isArray(snapshot.blocking) ? snapshot.blocking.map(fields) : [];
  if (!jobs.length) return '';
  return `<div class="blocking-jobs"><h4>Blocking jobs</h4><ul>
    ${jobs.map(({ id, codec, status, availableAt }) => `<li>
      <code>${valueHtml(id)}</code>
      ${[codec, status].filter(Boolean).map((value) => `<span class="job-tag">${valueHtml(value)}</span>`).join('')}
      ${availableAt == null ? '' : `<span class="job-availability">Available ${renderedTime(availableAt, fullTime) || valueHtml(availableAt)}</span>`}
    </li>`).join('')}
  </ul></div>`;
}

function highlights(event) {
  const data = fields(event.data);
  const worker = fields(data.candidate ?? data.worker ?? data.replay);
  const receipt = fields(data.receipt ?? worker.receipt);
  const gate = fields(data.gate);
  const job = fields(data.job ?? worker.job);
  const provider = fields(data.provider);
  const fence = fields(data.fence);
  const stable = fields(data.stable);
  const pilot = fields(data.pilot);
  const workerHold = fields(worker.hold ?? data.hold).enabled;
  const installed = Array.isArray(worker.codecs) ? worker.codecs.join(', ') : undefined;
  const scalar = (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  const pairs = [
    ['Gate', gate.status],
    ['Gate reason', gate.reason],
    ['Status', data.status ?? data.verdict],
    ['Job', job.id ?? data.jobId],
    ['Codec', worker.codec ?? job.codec ?? data.codec],
    ['Stable cohort', stable.codec ?? data.stable],
    ['Pilot cohort', pilot.codec ?? data.pilot],
    ['Hold decision', workerHold ?? data.hold],
    ['Admission', fence.status ?? snapshotFor(event).admission],
    ['Stale admission', fields(data.rejected).status],
    ['Existing-job retry', fields(data.retry).status],
    ['Worker outcome', worker.status ?? data.worker],
    ['Worker process', worker.process],
    ['Installed codecs', installed],
    ['Worker build', worker.build],
    ['Input digest', job.inputDigest ?? worker.inputDigest ?? data.inputDigest],
    ['Worker-read digest', worker.inputDigestObserved],
    ['Receipt', receipt.id ?? receipt.jobId],
    ['Artifact digest', receipt.artifactDigest],
    ['Effects', data.effects],
    ['Feature Health', data.type],
    ['Health event ID', data.type ? data.id : undefined],
    ['Flagsmith', provider.version],
    ['Environment', provider.environmentId ?? data.environmentId],
    ['Rehearsal error', data.message]
  ].filter(([, value]) => scalar(value)).map(([key, value]) => {
    const html = valueHtml(value);
    return [key, ['Worker build', 'Input digest', 'Worker-read digest', 'Receipt', 'Artifact digest'].includes(key)
      ? `<code>${html}</code>` : html];
  });
  const observedTimes = [
    ['Queue sample', data.snapshotAt],
    ['Delivery clock', data.deliveryAt]
  ].flatMap(([key, value]) => {
    const time = renderedTime(value, fullTime);
    return time ? [[key, time]] : [];
  });
  const facts = [...pairs, ...observedTimes];
  return facts.length ? factList(facts, 'event-facts') : '';
}

function candidateComparison(report) {
  const before = report.events.find((event) => event.kind === 'blocker');
  const after = report.events.find((event) => event.kind === 'candidate');
  const rejected = fields(fields(before?.data).candidate);
  const committed = fields(fields(after?.data).worker);
  const build = fields(report.metadata.builds).candidate;
  if (typeof build !== 'string' || !/^[0-9a-f]{64}$/.test(build) ||
      before == null || rejected.build !== build || rejected.status !== 'unsupported-codec' ||
      after == null || committed.build !== build || committed.status !== 'committed') return undefined;
  return { before, after, rejected, committed, build };
}

function comparisonPanel(comparison, selected) {
  if (!comparison || ![comparison.before, comparison.after].includes(selected)) return '';
  const { before, after, rejected, committed, build } = comparison;
  const comparisonRows = [
    [before, rejected, 'Before bridge drain', 'Codec rejected', 'blocked'],
    [after, committed, 'After bridge drain', 'Artifact committed', 'ready']
  ];
  return `<section class="candidate-proof" aria-label="Candidate build comparison">
    <div class="candidate-heading"><h4>Same candidate build</h4><code title="${build}">${build.slice(0, 12)}…${build.slice(-6)}</code></div>
    <div class="candidate-outcomes">${comparisonRows.map(([event, result, phase, label, tone]) => {
      const job = fields(result.job);
      return `<a href="#event-${event.key}" data-evidence-link="${event.key}" data-result="${tone}"${event === selected ? ' aria-current="true"' : ''}>
        <span>${phase}</span><strong>${label}<span class="arrow arrow-right" aria-hidden="true"></span></strong>
        <code>${valueHtml(job.id)} · ${valueHtml(job.codec)}</code>
      </a>`;
    }).join('')}</div>
  </section>`;
}

function eventDetails(event, selected, comparison) {
  const timestamp = renderedTime(event.at, eventTime);
  const snapshot = snapshotFor(event);
  const data = JSON.stringify(event.data === undefined ? {} : event.data, null, 2);
  const chain = [
    ['Previous hash', event.previous],
    ['Event hash', event.hash]
  ].filter(([, value]) => value != null);
  return `<article id="event-${event.key}" class="event-detail" data-event="${event.key}" data-label="${esc(event.label)}" ${event === selected ? '' : 'hidden'}>
    <div class="event-meta"><span>Event ${esc(eventNumber(event))}</span>${timestamp ? `<span>${timestamp} UTC</span>` : ''}</div>
    <h3 tabindex="-1" data-event-heading>${esc(event.label)}</h3>
    <p class="event-description">${esc(event.description)}</p>
    ${countPair(snapshot)}
    ${blockingJobs(snapshot)}
    ${comparisonPanel(comparison, event)}
    ${highlights(event)}
    <details class="event-data"><summary>Recorded event data</summary>
      ${chain.length ? factList(chain.map(([key, value]) => [key, `<code>${valueHtml(value)}</code>`])) : ''}
      <pre>${esc(data)}</pre>
    </details>
  </article>`;
}

function evidence(report, selected) {
  if (!selected) return `<div class="panel empty">
    <p>Event evidence is unavailable in this report.</p>
    ${report.error.message ? `<p>Reported error · ${valueHtml(report.error.message)}</p>` : ''}
  </div>`;
  const rows = report.events.map((event) => `<button type="button" class="event-row" ${selectAttrs(event, selected)}>
    <span class="row-number">${esc(eventNumber(event))}</span><span class="row-label">${esc(event.label)}</span>
    <span class="arrow arrow-right" aria-hidden="true"></span>
  </button>`).join('');
  const comparison = candidateComparison(report);
  return `<div class="evidence-grid panel">
    <div class="event-list" role="group" aria-label="Events in recorded order" data-selection-group>${rows}</div>
    <div class="details-pane">${report.events.map((event) => eventDetails(event, selected, comparison)).join('')}</div>
  </div>`;
}

function releaseChecks(report) {
  if (!report.checks.length) return `<p class="panel empty">${report.legacy
    ? 'Legacy outcomes are recorded in the evidence log.'
    : 'Release checks are unavailable in this report.'}</p>`;
  const words = { pass: 'Pass', fail: 'Fail', unknown: 'Unknown' };
  const index = new Map(report.events.map((event) => [String(event.seq), event.key]));
  return `<ul class="checks panel">${report.checks.map((check) => {
    const status = Object.hasOwn(words, check.status) ? check.status : 'unknown';
    const references = Array.isArray(check.events) ? check.events : [];
    const links = references.filter((seq) => index.has(String(seq))).map((seq) => {
      const key = index.get(String(seq));
      return `<a href="#event-${key}" data-evidence-link="${key}" aria-label="Inspect event ${esc(seq)}">#${esc(seq)}</a>`;
    }).join('');
    return `<li><div><strong>${valueHtml(check.label ?? check.id)}</strong>${links ? `<div class="check-links">${links}</div>` : ''}</div>
      <span class="check-status" data-check="${status}"><i aria-hidden="true"></i>${words[status]}</span></li>`;
  }).join('')}</ul>`;
}

function identifier(value, names) {
  const entries = names.filter((key) => fields(value)[key] != null);
  if (!entries.length) return valueHtml(value);
  return entries.map((key) => `<span class="provenance-value">${valueHtml(value[key])}</span>`).join('');
}

function provenance(report) {
  const { metadata } = report;
  const version = fields(metadata.flagsmith).version;
  const builds = fields(metadata.builds);
  const codecs = fields(metadata.codecs);
  const started = renderedTime(metadata.startedAt, fullTime);
  const hasSharedScope = Boolean(metadata.scope && metadata.scope === report.id);
  const entries = [
    ['Queue', valueHtml(queueLabel(metadata.queue))],
    ['Flagsmith', valueHtml(version)],
    [hasSharedScope ? 'Run / namespace' : 'Run ID', `<code>${valueHtml(report.id)}</code>`],
    ['Started', started || valueHtml(metadata.startedAt)],
    ['Mode', esc(modeLabel(report))]
  ];
  if (!hasSharedScope && metadata.scope) entries.splice(1, 0, ['Scope', valueHtml(metadata.scope)]);
  if (!report.legacy) {
    if (report.verified) entries.push(['Integrity', 'Hash chain and verdict checked at build']);
    entries.push(['Manifest', identifier(metadata.manifest, ['path', 'id', 'digest', 'sha256'])]);
    entries.push(['Source', identifier(metadata.source, ['repository', 'revision', 'commit', 'digest', 'sha256', 'dirty'])]);
  }
  const detail = [
    ['Schema', valueHtml(report.schema)],
    ...(report.legacy ? [] : [['Recorded seal', valueHtml(report.seal)]]),
    ...(report.attestation.algorithm ? [
      ['Attestation', valueHtml(report.attestation.algorithm)],
      ['Signer fingerprint', valueHtml(report.attestation.fingerprint)]
    ] : []),
    ...Object.entries(fields(metadata.flags)).map(([name, flag]) => [human(name) + ' flag', valueHtml(flag)]),
    ...Object.entries(builds).map(([role, build]) => [human(role) + ' build', identifier(build, ['path', 'digest', 'sha256'])]),
    ...Object.entries(codecs).map(([role, codec]) => [human(role) + ' codec', valueHtml(codec)])
  ];
  return `<div class="provenance panel">${factList(entries)}
    <details><summary>Report identifiers</summary>${factList(detail)}</details>
  </div>`;
}

export function renderReport(raw, { verified = false } = {}) {
  const report = { ...normalize(raw), verified };
  const blocker = report.events.find((event) => ['blocker', 'retirement-before-fence'].includes(event.kind));
  const selected = blocker ?? report.events.at(-1);
  const size = report.events.length;
  return {
    CONTEXT: context(report),
    VERDICT: verdictPanel(report, blocker),
    CHART: renderChart(report, selected),
    EVENT_COUNT: `<span class="event-count">${formatCount(size)} ${size === 1 ? 'event' : 'events'}</span>`,
    EVIDENCE: evidence(report, selected),
    CHECKS: releaseChecks(report),
    PROVENANCE: provenance(report)
  };
}

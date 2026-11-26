import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function initQueue(pool) {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(415502, 17)');
    await client.query(`
    CREATE TABLE IF NOT EXISTS afterflag_admission (
      scope text NOT NULL,
      codec text NOT NULL,
      phase text NOT NULL DEFAULT 'open' CHECK (phase IN ('open','fenced','retired')),
      generation integer NOT NULL DEFAULT 0,
      PRIMARY KEY (scope, codec)
    );
    CREATE TABLE IF NOT EXISTS afterflag_jobs (
      scope text NOT NULL,
      id text NOT NULL,
      codec text NOT NULL,
      bytes bytea NOT NULL,
      input_digest text NOT NULL,
      expected_digest text NOT NULL,
      decision_digest text,
      available_at bigint NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','claimed','held','retry','dead','committed')),
      lease_token uuid,
      lease_until bigint,
      attempts integer NOT NULL DEFAULT 0,
      reason text,
      PRIMARY KEY (scope, id),
      FOREIGN KEY (scope, codec) REFERENCES afterflag_admission (scope, codec),
      CHECK (
        (status = 'claimed' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
        (status <> 'claimed' AND lease_token IS NULL AND lease_until IS NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS afterflag_codec_backlog
      ON afterflag_jobs (scope, codec, available_at, id) WHERE status <> 'committed';
    CREATE INDEX IF NOT EXISTS afterflag_dispatch
      ON afterflag_jobs (scope, available_at, id) WHERE status NOT IN ('dead','committed');
    CREATE TABLE IF NOT EXISTS afterflag_effects (
      scope text NOT NULL,
      job_id text NOT NULL,
      artifact bytea NOT NULL,
      artifact_digest text NOT NULL,
      receipt text NOT NULL,
      committed_at bigint NOT NULL,
      PRIMARY KEY (scope, job_id),
      FOREIGN KEY (scope, job_id) REFERENCES afterflag_jobs (scope, id)
    );
    `);
  });
}

const enqueueColumns = 'id, codec, input_digest, expected_digest, decision_digest, available_at, status';
const dispatchable = `(
  status IN ('pending','held','retry') AND available_at <= $2 OR
  status = 'claimed' AND lease_until <= $2
)`;
const finiteTime = (time) => Number.isSafeInteger(time) && time >= 0;

function jobView(row) {
  return {
    id: row.id, codec: row.codec, status: row.status,
    inputDigest: row.input_digest, decisionDigest: row.decision_digest,
    availableAt: Number(row.available_at)
  };
}

async function timeAt(client, given) {
  if (given !== undefined) {
    if (!finiteTime(given)) throw new TypeError('Expected a non-negative millisecond timestamp.');
    return given;
  }
  const { rows } = await client.query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000) AS now");
  return Number(rows[0].now);
}

async function transaction(pool, callback, begin = 'BEGIN') {
  const client = await pool.connect();
  try {
    await client.query(begin);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function openQueue(connectionString, scope, { connections = 12 } = {}) {
  if (!connectionString || !scope) throw new TypeError('A PostgreSQL connection and queue scope are required.');
  const pool = new pg.Pool({
    connectionString, max: connections, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, application_name: 'afterflag'
  });

  async function readReceipt(client, id) {
    const { rows } = await client.query(`
      SELECT receipt AS id, artifact_digest AS "artifactDigest", committed_at AS "committedAt"
      FROM afterflag_effects WHERE scope = $1 AND job_id = $2
    `, [scope, id]);
    const row = rows[0];
    return row ? { ...row, committedAt: Number(row.committedAt) } : null;
  }

  async function inspectIn(client, codec, now) {
    const { rows: [snapshot] } = await client.query(`
      SELECT phase, generation, (
        SELECT coalesce(json_agg(counts), '[]') FROM (
          SELECT status, count(*)::int AS total,
                 count(*) FILTER (WHERE ${dispatchable})::int AS ready
          FROM afterflag_jobs WHERE scope = $1 AND codec = $3 AND status <> 'committed' GROUP BY status
        ) AS counts
      ) AS counts, (
        SELECT coalesce(json_agg(jobs), '[]') FROM (
          SELECT ${enqueueColumns} FROM afterflag_jobs
          WHERE scope = $1 AND codec = $3 AND status <> 'committed'
          ORDER BY available_at, id LIMIT 8
        ) AS jobs
      ) AS blocking
      FROM afterflag_admission WHERE scope = $1 AND codec = $3
    `, [scope, now, codec]);
    if (!snapshot) throw new Error('Codec admission was not registered.');
    return {
      codec, admission: snapshot.phase, generation: snapshot.generation,
      ready: snapshot.counts.reduce((sum, row) => sum + row.ready, 0),
      pending: snapshot.counts.reduce((sum, row) => sum + row.total, 0),
      counts: Object.fromEntries(snapshot.counts.map((row) => [row.status, row.total])),
      blocking: snapshot.blocking.map(jobView)
    };
  }

  return {
    scope,
    pool,
    close: () => pool.end(),
    async addCodecs(codecs) {
      await pool.query(`
        INSERT INTO afterflag_admission (scope, codec)
        SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING
      `, [scope, codecs]);
    },
    enqueue({ id, codec, availableAt = 0, bytes, expectedDigest, decisionDigest = null }) {
      const inputDigest = digest(bytes);
      return transaction(pool, async (client) => {
        const find = async () => (await client.query(`
          SELECT ${enqueueColumns} FROM afterflag_jobs WHERE scope = $1 AND id = $2
        `, [scope, id])).rows[0];
        const existingOutcome = (row) => row.expected_digest === expectedDigest
          ? { status: 'existing', job: jobView(row) } : { status: 'conflict', id };

        const existing = await find();
        if (existing) return existingOutcome(existing);

        // The producer holds this lock through the INSERT. A fence must wait for the transaction.
        const { rows: states } = await client.query(`
          SELECT phase, generation FROM afterflag_admission
          WHERE scope = $1 AND codec = $2 FOR SHARE
        `, [scope, codec]);
        const state = states[0];
        if (!state) throw new Error('Codec admission was not registered.');
        if (state.phase !== 'open') {
          const concurrent = await find();
          return concurrent ? existingOutcome(concurrent) : { status: 'fenced', id, codec, generation: state.generation };
        }
        const { rows } = await client.query(`
          INSERT INTO afterflag_jobs
            (scope, id, codec, available_at, bytes, input_digest, expected_digest, decision_digest)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (scope,id) DO NOTHING
          RETURNING ${enqueueColumns}
        `, [scope, id, codec, availableAt, bytes, inputDigest, expectedDigest, decisionDigest]);
        return rows[0] ? { status: 'enqueued', job: jobView(rows[0]) } : existingOutcome(await find());
      });
    },
    fence(codec) {
      return transaction(pool, async (client) => {
        const { rows } = await client.query(`
          UPDATE afterflag_admission
          SET phase = 'fenced', generation = generation + 1
          WHERE scope = $1 AND codec = $2 AND phase = 'open' RETURNING generation
        `, [scope, codec]);
        if (rows[0]) return { status: 'fenced', codec, generation: rows[0].generation };
        const { rows: current } = await client.query(
          'SELECT phase, generation FROM afterflag_admission WHERE scope = $1 AND codec = $2', [scope, codec]
        );
        if (!current[0]) throw new Error('Codec admission was not registered.');
        return { status: current[0].phase, codec, generation: current[0].generation };
      });
    },
    claim({ id, now: requestedNow, leaseMs = 30000 } = {}) {
      if (!finiteTime(leaseMs) || leaseMs === 0) throw new TypeError('Lease duration must be positive.');
      return transaction(pool, async (client) => {
        const now = await timeAt(client, requestedNow);
        let row;
        if (id === undefined) {
          ({ rows: [row] } = await client.query(`
            SELECT * FROM afterflag_jobs WHERE scope = $1
              AND status NOT IN ('dead','committed') AND ${dispatchable}
            ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
          `, [scope, now]));
          if (!row) return { status: 'empty' };
          id = row.id;
        } else {
          ({ rows: [row] } = await client.query(
            'SELECT * FROM afterflag_jobs WHERE scope = $1 AND id = $2 FOR UPDATE', [scope, id]
          ));
          if (!row) return { status: 'missing', id };
          if (row.status === 'committed') {
            return { status: 'duplicate', job: jobView(row), receipt: await readReceipt(client, id) };
          }
          if (row.status === 'dead') return { status: 'dead', id };
          if (row.available_at > now) return { status: 'delayed', id, availableAt: Number(row.available_at) };
          if (row.status === 'claimed' && row.lease_until > now) return { status: 'unavailable', id };
        }

        const token = randomUUID();
        await client.query(`
          UPDATE afterflag_jobs
          SET status = 'claimed', lease_token = $3, lease_until = $4, attempts = attempts + 1
          WHERE scope = $1 AND id = $2
        `, [scope, id, token, now + leaseMs]);
        return {
          status: 'claimed', token, job: { ...jobView(row), status: 'claimed', bytes: row.bytes },
          attempt: row.attempts + 1
        };
      });
    },
    defer(id, token, status, { now: requestedNow, availableAt, reason = null } = {}) {
      if (!['pending', 'held', 'retry', 'dead'].includes(status)) throw new TypeError('Invalid unresolved state.');
      return transaction(pool, async (client) => {
        const now = await timeAt(client, requestedNow);
        const { rowCount } = await client.query(`
          UPDATE afterflag_jobs SET status = $5, available_at = COALESCE($6, available_at),
            reason = $7, lease_token = NULL, lease_until = NULL
          WHERE scope = $1 AND id = $2 AND lease_token = $3 AND lease_until > $4
        `, [scope, id, token, now, status, availableAt ?? null, reason]);
        return { status: rowCount === 1 ? status : 'lease-lost', id };
      });
    },
    async redrive(id, requestedNow) {
      const now = await timeAt(pool, requestedNow);
      const { rows } = await pool.query(`
        UPDATE afterflag_jobs SET status = 'retry', available_at = $3, reason = NULL
        WHERE scope = $1 AND id = $2 AND status = 'dead' RETURNING ${enqueueColumns}
      `, [scope, id, now]);
      return rows[0] ? { status: 'redriven', job: jobView(rows[0]) } : { status: 'not-dead', id };
    },
    complete(id, token, artifact, requestedNow) {
      return transaction(pool, async (client) => {
        const now = await timeAt(client, requestedNow);
        const { rows: [row] } = await client.query(`
          SELECT expected_digest FROM afterflag_jobs
          WHERE scope = $1 AND id = $2 AND lease_token = $3 AND lease_until > $4 FOR UPDATE
        `, [scope, id, token, now]);
        if (!row) return { status: 'lease-lost', id };
        const bytes = Buffer.from(artifact);
        const artifactDigest = digest(bytes);
        if (row.expected_digest !== artifactDigest) return { status: 'artifact-mismatch', id };
        const receiptId = digest(JSON.stringify([scope, id, artifactDigest]));
        await client.query(`
          INSERT INTO afterflag_effects (scope, job_id, artifact, artifact_digest, receipt, committed_at)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [scope, id, bytes, artifactDigest, receiptId, now]);
        await client.query(`
          UPDATE afterflag_jobs SET status = 'committed', lease_token = NULL, lease_until = NULL, reason = NULL
          WHERE scope = $1 AND id = $2
        `, [scope, id]);
        return { status: 'committed', receipt: { id: receiptId, artifactDigest, committedAt: now } };
      });
    },
    inspect(codec, requestedNow) {
      return transaction(pool, async (client) => inspectIn(client, codec, await timeAt(client, requestedNow)),
        'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    },
    retire(codec, requestedNow) {
      return transaction(pool, async (client) => {
        await client.query(
          'SELECT phase FROM afterflag_admission WHERE scope = $1 AND codec = $2 FOR UPDATE', [scope, codec]
        );
        const snapshot = await inspectIn(client, codec, await timeAt(client, requestedNow));
        if (snapshot.admission === 'open') return { status: 'blocked', reason: 'admission-open', snapshot };
        if (snapshot.pending > 0) return { status: 'blocked', reason: 'pending-work', snapshot };
        await client.query(`
          UPDATE afterflag_admission SET phase = 'retired' WHERE scope = $1 AND codec = $2
        `, [scope, codec]);
        return { status: 'ready', snapshot: { ...snapshot, admission: 'retired' } };
      });
    },
    receipt(id) {
      return readReceipt(pool, id);
    },
    async effectCount() {
      const { rows } = await pool.query('SELECT count(*)::int AS total FROM afterflag_effects WHERE scope = $1', [scope]);
      return rows[0].total;
    }
  };
}

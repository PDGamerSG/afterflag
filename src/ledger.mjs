import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const defaultLeaseMs = 30000;
const ownsLease = (job, token, now) => typeof token === 'string' &&
  job.lease_token === token && job.lease_expires_at > now;

export function openLedger(filename = ':memory:') {
  const db = new DatabaseSync(filename);

  const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  const setSetting = (key, value) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);

  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function addColumns(table, definitions) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    for (const [name, type] of Object.entries(definitions)) {
      if (!columns.some((column) => column.name === name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      }
    }
  }

  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, codec TEXT NOT NULL, available_at INTEGER NOT NULL,
          intent_hash TEXT NOT NULL, bytes BLOB NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
          receipt TEXT, claimed_at INTEGER, lease_token TEXT, lease_expires_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS effects (
          job_id TEXT NOT NULL, effect_type TEXT NOT NULL, receipt TEXT NOT NULL,
          payload_digest TEXT NOT NULL, artifact BLOB, created_at INTEGER NOT NULL,
          PRIMARY KEY (job_id, effect_type)
        );
      `);
      addColumns('jobs', { claimed_at: 'INTEGER', lease_token: 'TEXT', lease_expires_at: 'INTEGER' });
      addColumns('effects', { artifact: 'BLOB' });
    });
  } catch (error) {
    db.close();
    throw error;
  }

  return {
    enqueue(input) {
      return transaction(() => {
        const existing = db.prepare(
          'SELECT id, codec, intent_hash, available_at FROM jobs WHERE id = ?'
        ).get(input.id);
        if (existing) {
          if (existing.intent_hash !== input.intentHash) return { status: 'conflict', id: input.id };
          return {
            status: 'existing',
            id: input.id,
            codec: existing.codec,
            availableAt: existing.available_at
          };
        }
        if (getSetting('fence:' + input.codec)) {
          return { status: 'fenced', id: input.id, codec: input.codec };
        }
        db.prepare(
          'INSERT INTO jobs (id, codec, available_at, intent_hash, bytes, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          input.id,
          input.codec,
          input.availableAt ?? 0,
          input.intentHash,
          input.bytes,
          Date.now()
        );
        return { status: 'enqueued', id: input.id, codec: input.codec };
      });
    },

    getJob(id) {
      const row = db.prepare(
        'SELECT id, codec, available_at, intent_hash, bytes, status, receipt FROM jobs WHERE id = ?'
      ).get(id);
      if (!row) return null;
      return {
        ...row,
        availableAt: row.available_at,
        intentHash: row.intent_hash,
        bytes: Buffer.from(row.bytes)
      };
    },

    claim(id, now, leaseMs = defaultLeaseMs) {
      if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new RangeError('Lease duration must be positive.');
      return transaction(() => {
        const claimedAt = now ?? Date.now();
        const job = db.prepare(
          'SELECT id, codec, available_at, intent_hash, bytes, status, receipt, claimed_at, ' +
          'created_at, lease_expires_at FROM jobs WHERE id = ?'
        ).get(id);
        if (!job) return { status: 'missing', id };
        if (job.status === 'committed') return { status: 'duplicate', id, receipt: job.receipt };
        if (job.available_at > claimedAt) return { status: 'delayed', id, availableAt: job.available_at };
        if (job.status === 'claimed') {
          const expiresAt = job.lease_expires_at ??
            (job.claimed_at === null ? claimedAt : job.claimed_at + defaultLeaseMs);
          if (expiresAt > claimedAt) {
            return { status: 'unavailable', id, state: job.status };
          }
        } else if (job.status !== 'pending') {
          return { status: 'unavailable', id, state: job.status };
        }
        const token = randomUUID();
        const expiresAt = claimedAt + leaseMs;
        db.prepare(
          'UPDATE jobs SET status = ?, claimed_at = ?, lease_token = ?, lease_expires_at = ? WHERE id = ?'
        ).run('claimed', claimedAt, token, expiresAt, id);
        return {
          status: 'claimed',
          token,
          job: {
            ...job,
            status: 'claimed',
            claimed_at: claimedAt,
            lease_expires_at: expiresAt,
            availableAt: job.available_at,
            intentHash: job.intent_hash,
            bytes: Buffer.from(job.bytes)
          }
        };
      });
    },

    release(id, token, now) {
      return transaction(() => {
        const row = db.prepare('SELECT status, lease_token, lease_expires_at FROM jobs WHERE id = ?').get(id);
        if (!row) return { status: 'missing', id };
        if (row.status === 'committed') return { status: 'duplicate', id, receipt: this.receipt(id) };
        if (row.status !== 'claimed') return { status: 'unavailable', id, state: row.status };
        if (!ownsLease(row, token, now ?? Date.now())) return { status: 'lease-lost', id };
        db.prepare(
          'UPDATE jobs SET status = ?, claimed_at = NULL, lease_token = NULL, lease_expires_at = NULL WHERE id = ?'
        ).run('pending', id);
        return { status: 'released', id };
      });
    },

    commit(id, effectType, { token, artifact, now } = {}) {
      return transaction(() => {
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        if (!job) return { status: 'missing', id };
        if (job.status === 'committed') return { status: 'duplicate', receipt: job.receipt };
        if (job.status !== 'claimed') return { status: 'unavailable', id, state: job.status };
        const committedAt = now ?? Date.now();
        if (!ownsLease(job, token, committedAt)) return { status: 'lease-lost', id };
        if (job.available_at > committedAt) return { status: 'delayed', id, availableAt: job.available_at };
        const existing = db.prepare(
          'SELECT receipt FROM effects WHERE job_id = ? AND effect_type = ?'
        ).get(id, effectType);
        if (existing) return { status: 'duplicate', receipt: existing.receipt };
        const receipt = digest(id + ':' + effectType + ':' + job.intent_hash);
        const payloadDigest = digest(job.bytes);
        const artifactBytes = Buffer.from(artifact);
        db.prepare(
          'INSERT INTO effects (job_id, effect_type, receipt, payload_digest, artifact, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, effectType, receipt, payloadDigest, artifactBytes, committedAt);
        db.prepare(
          'UPDATE jobs SET status = ?, receipt = ?, claimed_at = NULL, lease_token = NULL, ' +
          'lease_expires_at = NULL WHERE id = ?'
        ).run('committed', receipt, id);
        return { status: 'committed', receipt, payloadDigest, artifactDigest: digest(artifactBytes) };
      });
    },

    getEffect(id) {
      const row = db.prepare(
        'SELECT effects.receipt, effects.payload_digest, effects.artifact FROM effects ' +
        'JOIN jobs ON jobs.id = effects.job_id AND jobs.receipt = effects.receipt WHERE jobs.id = ?'
      ).get(id);
      if (!row) return null;
      const artifact = row.artifact === null ? null : Buffer.from(row.artifact);
      return {
        receipt: row.receipt,
        payloadDigest: row.payload_digest,
        artifact,
        artifactDigest: artifact === null ? null : digest(artifact)
      };
    },

    receipt(id) {
      const row = db.prepare('SELECT receipt FROM jobs WHERE id = ?').get(id);
      return row?.receipt ? { receipt: row.receipt, digest: digest(row.receipt) } : null;
    },

    fence(codec) {
      return transaction(() => {
        setSetting('fence:' + codec, String(Date.now()));
        return { status: 'fenced', codec };
      });
    },

    retire(codec, now = Date.now()) {
      return transaction(() => {
        const fence = getSetting('fence:' + codec);
        if (!fence) {
          return { status: 'blocked', reason: 'admission-open', ledger: { admission: 'open' } };
        }
        const counts = db.prepare(
          'SELECT COUNT(*) AS pending, ' +
          "SUM(CASE WHEN status = 'pending' AND available_at <= ? THEN 1 ELSE 0 END) AS ready " +
          "FROM jobs WHERE codec = ? AND status != 'committed'"
        ).get(now, codec);
        if (Number(counts.pending) !== 0) {
          return {
            status: 'blocked',
            reason: 'pending-work',
            ledger: {
              admission: 'fenced',
              pending: Number(counts.pending),
              ready: Number(counts.ready || 0)
            }
          };
        }
        setSetting('retired:' + codec, String(now));
        return { status: 'ready', ledger: { admission: 'retired', pending: 0, ready: 0 } };
      });
    },

    inspect(codec, now = Date.now()) {
      const counts = db.prepare(
        'SELECT COUNT(*) AS pending, ' +
        "SUM(CASE WHEN status = 'pending' AND available_at <= ? THEN 1 ELSE 0 END) AS ready " +
        "FROM jobs WHERE codec = ? AND status != 'committed'"
      ).get(now, codec);
      const blockerRow = db.prepare(
        'SELECT id, available_at AS availableAt FROM jobs ' +
        "WHERE codec = ? AND status != 'committed' " +
        'ORDER BY available_at ASC, id ASC LIMIT 1'
      ).get(codec);
      const blocker = blockerRow ? {
        id: blockerRow.id,
        availableAt: blockerRow.availableAt
      } : null;
      return {
        admission: getSetting('retired:' + codec)
          ? 'retired'
          : getSetting('fence:' + codec)
            ? 'fenced'
            : 'open',
        pending: Number(counts.pending),
        ready: Number(counts.ready || 0),
        blocking: blocker ? [blocker] : []
      };
    },

    effectCount(id) {
      const count = id === undefined
        ? db.prepare('SELECT COUNT(*) AS count FROM effects').get()
        : db.prepare('SELECT COUNT(*) AS count FROM effects WHERE job_id = ?').get(id);
      return Number(count.count);
    },

    close() {
      db.close();
    }
  };
}

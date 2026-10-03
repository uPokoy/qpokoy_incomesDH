'use strict';

// The SDK is loaded only in the deployed adapter; route tests use an in-memory store.
const { Driver, MetadataAuthService, TypedValues, TypedData } = require('ydb-sdk');
const { randomUUID } = require('node:crypto');

const U = TypedValues.utf8;
const T = TypedValues.timestamp;
const D = TypedValues.double;
const REVISION_KEY = 'system.data_revision';
const internalSetting = (key) => /^(auth|system|rate|billing)\./.test(key);

function createYdbStore(env = process.env, DriverClass = Driver) {
  if (!env.ENDPOINT || !env.DATABASE) throw new Error('ENDPOINT and DATABASE are required');
  const driver = new DriverClass({ endpoint: env.ENDPOINT, database: env.DATABASE, authService: new MetadataAuthService() });
  let readyPromise;
  async function ready() {
    readyPromise ||= driver.ready(10000);
    try {
      if (!await readyPromise) throw new Error('YDB driver is not ready');
    } catch (error) { readyPromise = null; throw error; }
  }
  const RESOURCE_RETRY_DELAYS_MS = [300, 800, 1600];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isResourceExhausted = (error) =>
    Number(error?.code) === 8 || /RESOURCE_EXHAUSTED|ResourceExhausted/i.test(String(error?.message || error || ''));

  async function withResourceRetry(operation) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (!isResourceExhausted(error) || attempt >= RESOURCE_RETRY_DELAYS_MS.length) throw error;
        const delay = RESOURCE_RETRY_DELAYS_MS[attempt] + Math.floor(Math.random() * 150);
        console.warn(`YDB RESOURCE_EXHAUSTED: retry ${attempt + 1}/${RESOURCE_RETRY_DELAYS_MS.length} in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  async function query(text, params = {}) {
    await ready();
    return withResourceRetry(() => driver.tableClient.withSession(async (session) => {
      const result = await session.executeQuery(text, typeof params === 'function' ? params() : params);
      return result.resultSets?.[0] ? TypedData.createNativeObjects(result.resultSets[0]) : [];
    }));
  }
  async function transaction(steps) {
    await ready();
    return withResourceRetry(() => driver.tableClient.withSession(async (session) => {
      const meta = await session.beginTransaction({ serializableReadWrite: {} });
      const control = { txId: meta.id };
      try {
        for (const { sql, params } of steps) await session.executeQuery(sql, typeof params === 'function' ? params() : params, control);
        await session.commitTransaction(control);
      } catch (error) {
        try { await session.rollbackTransaction(control); } catch (_) { /* Preserve the original failure. */ }
        throw error;
      }
    }));
  }
  const first = async (text, params) => (await query(text, params))[0] || null;
  const conflict = (error) => /already exists|duplicate|precondition.failed|constraint/i.test(String(error?.message || ''));
  const revisionDeclarations = 'DECLARE $revisionKey AS Utf8; DECLARE $revision AS Utf8; DECLARE $revisionTime AS Timestamp;';
  const revisionWrite = `UPSERT INTO \`settings\` (user_id,setting_key,setting_value,updated_at)
    VALUES ($uid,$revisionKey,$revision,$revisionTime);`;
  const revisionSql = revisionDeclarations + '\n' + revisionWrite;
  const revisionParams = () => ({ $revisionKey: U(REVISION_KEY), $revision: U(randomUUID()), $revisionTime: T(new Date()) });
  // The data write and revision share one AUTO_TX, never two independent commits.
  // Fresh per attempt prevents reusing an older revision after a retried commit.
  const mutate = (sql, params) => query(revisionDeclarations + '\n' + sql + '\n' + revisionWrite, () => ({ ...params, ...revisionParams() }));

  return {
    // Each request authenticates in a single AUTO_TX, with point predicates and
    // no JOIN. Unchanged cache hits never open an explicit transaction.
    async loadBootstrap(sessionId, validate, knownRevision = '') {
      await ready();
      return withResourceRetry(() => driver.tableClient.withSession(async (session) => {
        const rows = (result, index) => result.resultSets?.[index] ? TypedData.createNativeObjects(result.resultSets[index]) : [];
        const readAuth = async (control) => {
          const result = await session.executeQuery(`DECLARE $id AS Utf8; DECLARE $revisionKey AS Utf8;
            $session = SELECT session_id,user_id,secret_hash,created_at,expires_at,last_seen_at,revoked_at
              FROM \`sessions\` WHERE session_id=$id;
            $uid = (SELECT user_id FROM $session);
            SELECT session_id,user_id,secret_hash,created_at,expires_at,last_seen_at,revoked_at FROM $session;
            SELECT user_id,email,status,created_at,updated_at,trial_ends_at FROM \`users\` WHERE user_id=$uid;
            SELECT setting_value FROM \`settings\` WHERE user_id=$uid AND setting_key=$revisionKey;`,
          { $id: U(sessionId), $revisionKey: U(REVISION_KEY) }, control);
          const auth = { session: rows(result, 0)[0] || null, user: rows(result, 1)[0] || null };
          validate(auth); // Never read the full bundle before bearer/user validation.
          return { ...auth, revision: rows(result, 2)[0]?.setting_value || '' };
        };
        const checked = await readAuth();
        if (checked.revision && knownRevision === checked.revision) {
          return { user: checked.user, revision: checked.revision, not_modified: true };
        }

        // A miss re-reads auth/revision inside the bundle's snapshot. Using the
        // preflight revision here would race a mutation between the two queries.
        const meta = await session.beginTransaction({ serializableReadWrite: {} });
        const control = { txId: meta.id };
        try {
          const auth = await readAuth(control);
          const initialize = !auth.revision;
          const revision = auth.revision || randomUUID();
          const result = await session.executeQuery(`DECLARE $uid AS Utf8;
            ${initialize ? revisionDeclarations : ''}
            SELECT user_id,id,income_date,category,description,amount,created_at,updated_at
              FROM \`incomes\` WHERE user_id=$uid ORDER BY income_date DESC,created_at DESC;
            SELECT user_id,id,name,created_at FROM \`categories\` WHERE user_id=$uid ORDER BY created_at ASC;
            SELECT user_id,setting_key,setting_value,updated_at FROM \`settings\` WHERE user_id=$uid ORDER BY setting_key;
            ${initialize ? revisionWrite : ''}`,
          { $uid: U(auth.user.user_id), ...(initialize ? {
            $revisionKey: U(REVISION_KEY), $revision: U(revision), $revisionTime: T(new Date())
          } : {}) }, control);
          await session.commitTransaction(control);
          return { user: auth.user, revision, not_modified: false, incomes: rows(result, 0), categories: rows(result, 1), settings: rows(result, 2) };
        } catch (error) {
          try { await session.rollbackTransaction(control); } catch (_) { /* Preserve the original failure. */ }
          throw error;
        }
      }));
    },
    health: async () => { await query('SELECT 1 AS ok;'); },
    async consumeRateLimit(bucketKey, limit, windowMs, when) {
      const uid = '__rate_limit__';
      const settingKey = 'rate.' + bucketKey;
      const nowMs = when.getTime();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await ready();
          return await driver.tableClient.withSession(async (session) => {
            const meta = await session.beginTransaction({ serializableReadWrite: {} });
            const control = { txId: meta.id };
            try {
              const result = await session.executeQuery(
                'DECLARE $uid AS Utf8; DECLARE $key AS Utf8; SELECT setting_value FROM `settings` WHERE user_id=$uid AND setting_key=$key;',
                { $uid: U(uid), $key: U(settingKey) }, control);
              const row = result.resultSets?.[0] ? TypedData.createNativeObjects(result.resultSets[0])[0] : null;
              let state = null;
              try { state = row?.setting_value ? JSON.parse(row.setting_value) : null; } catch (_) { state = null; }
              let count = Number(state?.count);
              let resetAt = Date.parse(state?.reset_at || '');
              if (!Number.isInteger(count) || count < 0 || !Number.isFinite(resetAt) || resetAt <= nowMs) {
                count = 0;
                resetAt = nowMs + windowMs;
              }
              const allowed = count < limit;
              if (allowed) {
                const value = JSON.stringify({ count: count + 1, reset_at: new Date(resetAt).toISOString() });
                await session.executeQuery(
                  'DECLARE $uid AS Utf8; DECLARE $key AS Utf8; DECLARE $value AS Utf8; DECLARE $updated AS Timestamp; UPSERT INTO `settings` (user_id,setting_key,setting_value,updated_at) VALUES ($uid,$key,$value,$updated);',
                  { $uid: U(uid), $key: U(settingKey), $value: U(value), $updated: T(when) }, control);
              }
              await session.commitTransaction(control);
              return {
                allowed,
                retry_after_seconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - nowMs) / 1000))
              };
            } catch (error) {
              try { await session.rollbackTransaction(control); } catch (_) { /* Preserve the original failure. */ }
              throw error;
            }
          });
        } catch (error) {
          if (isResourceExhausted(error)) {
            if (attempt >= 2) throw error;
            const delay = RESOURCE_RETRY_DELAYS_MS[Math.min(attempt, RESOURCE_RETRY_DELAYS_MS.length - 1)] + Math.floor(Math.random() * 150);
            console.warn(`YDB rate-limit store RESOURCE_EXHAUSTED: retry ${attempt + 1}/2 in ${delay}ms`);
            await sleep(delay);
            continue;
          }
          if (attempt >= 2 || !/aborted|serialization|conflict|transaction.*lock/i.test(String(error?.message || ''))) throw error;
        }
      }
    },
    getUser: (id) => first('DECLARE $id AS Utf8; SELECT user_id,email,status,created_at,updated_at,trial_ends_at FROM `users` WHERE user_id=$id;', { $id: U(id) }),
    getIdentity: (provider, providerUserId) => first('DECLARE $p AS Utf8; DECLARE $id AS Utf8; SELECT provider,provider_user_id,user_id,password_hash FROM `auth_identities` WHERE provider=$p AND provider_user_id=$id;', { $p: U(provider), $id: U(providerUserId) }),
    async applyAdminBillingChange({ targetId, settingKey, value, audit, timestamp }) {
      const sql = value === null
        ? 'DECLARE $uid AS Utf8; DECLARE $key AS Utf8; DELETE FROM `settings` WHERE user_id=$uid AND setting_key=$key;'
        : 'DECLARE $uid AS Utf8; DECLARE $key AS Utf8; DECLARE $value AS Utf8; DECLARE $updated AS Timestamp; UPSERT INTO `settings` (user_id,setting_key,setting_value,updated_at) VALUES ($uid,$key,$value,$updated);';
      const params = { $uid: U(targetId), $key: U(settingKey) };
      if (value !== null) { params.$value = U(JSON.stringify(value)); params.$updated = T(timestamp); }
      await transaction([
        { sql, params },
        { sql: 'DECLARE $actor AS Utf8; DECLARE $key AS Utf8; DECLARE $value AS Utf8; DECLARE $updated AS Timestamp; INSERT INTO `settings` (user_id,setting_key,setting_value,updated_at) VALUES ($actor,$key,$value,$updated);',
          params: { $actor: U(audit.user_id), $key: U(audit.setting_key), $value: U(audit.setting_value), $updated: T(audit.updated_at) } }
      ]);
    },
    getSetting: (uid, key) => first('DECLARE $uid AS Utf8; DECLARE $key AS Utf8; SELECT user_id,setting_key,setting_value,updated_at FROM `settings` WHERE user_id=$uid AND setting_key=$key;', { $uid: U(uid), $key: U(key) }),
    deleteSetting: (uid, key) => (internalSetting(key) ? query : mutate)('DECLARE $uid AS Utf8; DECLARE $key AS Utf8; DELETE FROM `settings` WHERE user_id=$uid AND setting_key=$key;', { $uid: U(uid), $key: U(key) }),
    async linkIdentity(provider, providerUserId, uid, createdAt) {
      const existing = await this.getIdentity(provider, providerUserId);
      if (existing) return existing.user_id === uid;
      try {
        await query(`DECLARE $provider AS Utf8; DECLARE $providerId AS Utf8; DECLARE $uid AS Utf8; DECLARE $hash AS Utf8; DECLARE $created AS Timestamp;
          INSERT INTO \`auth_identities\` (provider,provider_user_id,user_id,password_hash,created_at)
          VALUES ($provider,$providerId,$uid,$hash,$created);`,
        { $provider: U(provider), $providerId: U(providerUserId), $uid: U(uid), $hash: U(''), $created: T(createdAt) });
        return true;
      } catch (error) { if (conflict(error)) return false; throw error; }
    },
    async registerOAuth(user, provider, providerUserId, categories) {
      if (await this.getIdentity(provider, providerUserId) || await this.getIdentity('email', user.email)) return false;
      try {
        await query(`DECLARE $uid AS Utf8; DECLARE $email AS Utf8; DECLARE $provider AS Utf8; DECLARE $providerId AS Utf8;
          DECLARE $emailProvider AS Utf8; DECLARE $status AS Utf8; DECLARE $hash AS Utf8;
          DECLARE $created AS Timestamp; DECLARE $updated AS Timestamp; DECLARE $trial AS Timestamp;
          DECLARE $cat0 AS Utf8; DECLARE $cat1 AS Utf8; DECLARE $cat2 AS Utf8;
          DECLARE $name0 AS Utf8; DECLARE $name1 AS Utf8; DECLARE $name2 AS Utf8;
          INSERT INTO \`auth_identities\` (provider,provider_user_id,user_id,password_hash,created_at) VALUES
          ($emailProvider,$email,$uid,$hash,$created),($provider,$providerId,$uid,$hash,$created);
          INSERT INTO \`users\` (user_id,email,status,created_at,updated_at,trial_ends_at)
          VALUES ($uid,$email,$status,$created,$updated,$trial);
          INSERT INTO \`categories\` (user_id,id,name,created_at) VALUES
          ($uid,$cat0,$name0,$created),($uid,$cat1,$name1,$created),($uid,$cat2,$name2,$created);`,
        { $uid: U(user.user_id), $email: U(user.email), $provider: U(provider), $providerId: U(providerUserId),
          $emailProvider: U('email'), $status: U(user.status), $hash: U(''), $created: T(user.created_at),
          $updated: T(user.updated_at), $trial: T(user.trial_ends_at),
          $cat0: U(categories[0].id), $cat1: U(categories[1].id), $cat2: U(categories[2].id),
          $name0: U(categories[0].name), $name1: U(categories[1].name), $name2: U(categories[2].name) });
        return true;
      } catch (error) { if (conflict(error)) return false; throw error; }
    },
    async activateUser(uid, when, trialEndsAt) {
      await transaction([
        {
          sql: 'DECLARE $uid AS Utf8; DECLARE $status AS Utf8; DECLARE $when AS Timestamp; DECLARE $trial AS Timestamp; UPDATE `users` SET status=$status,updated_at=$when,trial_ends_at=$trial WHERE user_id=$uid;',
          params: { $uid: U(uid), $status: U('active'), $when: T(when), $trial: T(trialEndsAt) }
        },
        {
          sql: 'DECLARE $uid AS Utf8; DECLARE $key AS Utf8; DELETE FROM `settings` WHERE user_id=$uid AND setting_key=$key;',
          params: { $uid: U(uid), $key: U('auth.email_verification') }
        }
      ]);
      return this.getUser(uid);
    },
    async getEmailVerification(uid) {
      const row = await first('DECLARE $uid AS Utf8; DECLARE $key AS Utf8; SELECT setting_value FROM `settings` WHERE user_id=$uid AND setting_key=$key;',
        { $uid: U(uid), $key: U('auth.email_verification') });
      if (!row?.setting_value) return null;
      try { return JSON.parse(row.setting_value); } catch (_) { return null; }
    },
    createEmailVerification: (row) => query(`DECLARE $uid AS Utf8; DECLARE $key AS Utf8; DECLARE $value AS Utf8; DECLARE $updated AS Timestamp;
      UPSERT INTO \`settings\` (user_id,setting_key,setting_value,updated_at) VALUES ($uid,$key,$value,$updated);`,
      { $uid: U(row.user_id), $key: U('auth.email_verification'), $value: U(JSON.stringify({
        token_hash: row.token_hash,
        created_at: row.created_at.toISOString(),
        expires_at: row.expires_at.toISOString()
      })), $updated: T(row.created_at) }),
    async confirmEmailVerification(uid, tokenHash, when, trialEndsAt) {
      await ready();
      return driver.tableClient.withSession(async (session) => {
        const meta = await session.beginTransaction({ serializableReadWrite: {} });
        const control = { txId: meta.id };
        try {
          const verificationResult = await session.executeQuery(
            'DECLARE $uid AS Utf8; DECLARE $key AS Utf8; SELECT setting_value FROM `settings` WHERE user_id=$uid AND setting_key=$key;',
            { $uid: U(uid), $key: U('auth.email_verification') }, control);
          const verificationRow = verificationResult.resultSets?.[0] ? TypedData.createNativeObjects(verificationResult.resultSets[0])[0] : null;
          let verification = null;
          try { verification = verificationRow?.setting_value ? JSON.parse(verificationRow.setting_value) : null; } catch (_) { verification = null; }
          const userResult = await session.executeQuery(
            'DECLARE $uid AS Utf8; SELECT status FROM `users` WHERE user_id=$uid;',
            { $uid: U(uid) }, control);
          const user = userResult.resultSets?.[0] ? TypedData.createNativeObjects(userResult.resultSets[0])[0] : null;
          if (!verification || verification.token_hash !== tokenHash || new Date(verification.expires_at) <= when || user?.status !== 'pending_email') {
            await session.rollbackTransaction(control);
            return false;
          }
          await session.executeQuery(
            `DECLARE $uid AS Utf8; DECLARE $status AS Utf8; DECLARE $when AS Timestamp; DECLARE $trial AS Timestamp; DECLARE $key AS Utf8;
             UPDATE \`users\` SET status=$status,updated_at=$when,trial_ends_at=$trial WHERE user_id=$uid;
             DELETE FROM \`settings\` WHERE user_id=$uid AND setting_key=$key;`,
            { $uid: U(uid), $status: U('active'), $when: T(when), $trial: T(trialEndsAt), $key: U('auth.email_verification') }, control);
          await session.commitTransaction(control);
          return true;
        } catch (error) {
          try { await session.rollbackTransaction(control); } catch (_) { /* Preserve the original failure. */ }
          throw error;
        }
      });
    },
    async register(user, passwordHash, categories) {
      const existing = await this.getIdentity('email', user.email);
      if (existing) return false;
      try {
        // One AUTO_TX (serializable read/write, commitTx) covers the identity,
        // user and all default categories. A failure rolls back the entire query.
        await query(`DECLARE $uid AS Utf8; DECLARE $email AS Utf8; DECLARE $provider AS Utf8; DECLARE $status AS Utf8;
          DECLARE $created AS Timestamp; DECLARE $updated AS Timestamp; DECLARE $trial AS Timestamp;
          DECLARE $hash AS Utf8;
          DECLARE $cat0 AS Utf8; DECLARE $cat1 AS Utf8; DECLARE $cat2 AS Utf8;
          DECLARE $name0 AS Utf8; DECLARE $name1 AS Utf8; DECLARE $name2 AS Utf8;
          INSERT INTO \`auth_identities\` (provider,provider_user_id,user_id,password_hash,created_at)
          VALUES ($provider,$email,$uid,$hash,$created);
          INSERT INTO \`users\` (user_id,email,status,created_at,updated_at,trial_ends_at)
          VALUES ($uid,$email,$status,$created,$updated,$trial);
          INSERT INTO \`categories\` (user_id,id,name,created_at) VALUES
          ($uid,$cat0,$name0,$created),($uid,$cat1,$name1,$created),($uid,$cat2,$name2,$created);`,
        { $uid: U(user.user_id), $email: U(user.email), $provider: U('email'), $status: U(user.status), $created: T(user.created_at),
          $updated: T(user.updated_at), $trial: T(user.trial_ends_at), $hash: U(passwordHash),
          $cat0: U(categories[0].id), $cat1: U(categories[1].id), $cat2: U(categories[2].id),
          $name0: U(categories[0].name), $name1: U(categories[1].name), $name2: U(categories[2].name) });
        return true;
      } catch (error) { if (conflict(error)) return false; throw error; }
    },
    getSession: (id) => first('DECLARE $id AS Utf8; SELECT session_id,user_id,secret_hash,created_at,expires_at,last_seen_at,revoked_at FROM `sessions` WHERE session_id=$id;', { $id: U(id) }),
    addSession: (s) => query(`DECLARE $id AS Utf8; DECLARE $uid AS Utf8; DECLARE $hash AS Utf8;
      DECLARE $created AS Timestamp; DECLARE $expires AS Timestamp;
      INSERT INTO \`sessions\` (session_id,user_id,secret_hash,created_at,expires_at)
      VALUES ($id,$uid,$hash,$created,$expires);`,
      { $id: U(s.session_id), $uid: U(s.user_id), $hash: U(s.secret_hash), $created: T(s.created_at), $expires: T(s.expires_at) }),
    revokeSession: (id, when) => query('DECLARE $id AS Utf8; DECLARE $when AS Timestamp; UPDATE `sessions` SET revoked_at=$when WHERE session_id=$id;', { $id: U(id), $when: T(when) }),
    createPasswordResetToken: (row) => transaction([
      {
        sql: 'DECLARE $uid AS Utf8; DELETE FROM `password_reset_tokens` WHERE user_id=$uid;',
        params: { $uid: U(row.user_id) }
      },
      {
        sql: `DECLARE $hash AS Utf8; DECLARE $uid AS Utf8; DECLARE $created AS Timestamp; DECLARE $expires AS Timestamp;
          INSERT INTO \`password_reset_tokens\` (token_hash,user_id,created_at,expires_at)
          VALUES ($hash,$uid,$created,$expires);`,
        params: { $hash: U(row.token_hash), $uid: U(row.user_id), $created: T(row.created_at), $expires: T(row.expires_at) }
      }
    ]),
    deletePasswordResetToken: (hash) => query('DECLARE $hash AS Utf8; DELETE FROM `password_reset_tokens` WHERE token_hash=$hash;', { $hash: U(hash) }),
    async resetPassword(tokenHash, passwordHash, when) {
      await ready();
      return driver.tableClient.withSession(async (session) => {
        const meta = await session.beginTransaction({ serializableReadWrite: {} });
        const control = { txId: meta.id };
        try {
          const result = await session.executeQuery(
            'DECLARE $hash AS Utf8; SELECT token_hash,user_id,created_at,expires_at,used_at FROM `password_reset_tokens` WHERE token_hash=$hash;',
            { $hash: U(tokenHash) }, control);
          const token = result.resultSets?.[0] ? TypedData.createNativeObjects(result.resultSets[0])[0] : null;
          if (!token || token.used_at || new Date(token.expires_at) <= when) {
            await session.rollbackTransaction(control);
            return false;
          }
          await session.executeQuery(
            `DECLARE $uid AS Utf8; DECLARE $provider AS Utf8; DECLARE $password AS Utf8;
             DECLARE $when AS Timestamp; DECLARE $hash AS Utf8;
             UPDATE \`auth_identities\` SET password_hash=$password WHERE provider=$provider AND user_id=$uid;
             UPDATE \`sessions\` SET revoked_at=$when WHERE user_id=$uid AND revoked_at IS NULL;
             UPDATE \`password_reset_tokens\` SET used_at=$when WHERE token_hash=$hash;
             DELETE FROM \`password_reset_tokens\` WHERE user_id=$uid AND token_hash<>$hash;`,
            { $uid: U(token.user_id), $provider: U('email'), $password: U(passwordHash), $when: T(when), $hash: U(tokenHash) }, control);
          await session.commitTransaction(control);
          return true;
        } catch (error) {
          try { await session.rollbackTransaction(control); } catch (_) { /* Preserve the original failure. */ }
          throw error;
        }
      });
    },
    listIncomes: (uid) => query(`DECLARE $uid AS Utf8;
      SELECT user_id,id,income_date,category,description,amount,created_at,updated_at FROM \`incomes\`
      WHERE user_id=$uid ORDER BY income_date DESC,created_at DESC;`, { $uid: U(uid) }),
    getIncome: (uid, id) => first(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8;
      SELECT user_id,id,income_date,category,description,amount,created_at,updated_at FROM \`incomes\`
      WHERE user_id=$uid AND id=$id;`, { $uid: U(uid), $id: U(id) }),
    async addIncome(row) {
      if (await this.getIncome(row.user_id, row.id)) return false;
      try {
        await mutate(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DECLARE $date AS Utf8;
          DECLARE $category AS Utf8; DECLARE $description AS Utf8; DECLARE $amount AS Double;
          DECLARE $created AS Timestamp; DECLARE $updated AS Timestamp;
          INSERT INTO \`incomes\` (user_id,id,income_date,category,description,amount,created_at,updated_at)
          VALUES ($uid,$id,$date,$category,$description,$amount,$created,$updated);`, incomeParams(row));
        return true;
      } catch (error) { if (conflict(error)) return false; throw error; }
    },
    async updateIncome(uid, id, row, updatedAt) {
      if (!await this.getIncome(uid, id)) return false;
      await mutate(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DECLARE $date AS Utf8;
        DECLARE $category AS Utf8; DECLARE $description AS Utf8; DECLARE $amount AS Double;
        DECLARE $updated AS Timestamp;
        UPDATE \`incomes\` SET income_date=$date,category=$category,description=$description,amount=$amount,updated_at=$updated
        WHERE user_id=$uid AND id=$id;`, { $uid: U(uid), $id: U(id), $date: U(row.income_date),
          $category: U(row.category), $description: U(row.description), $amount: D(row.amount), $updated: T(updatedAt) });
      return true;
    },
    async deleteIncome(uid, id) {
      if (!await this.getIncome(uid, id)) return false;
      await mutate('DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DELETE FROM `incomes` WHERE user_id=$uid AND id=$id;', { $uid: U(uid), $id: U(id) });
      return true;
    },
    deleteAllIncomes: (uid) => mutate('DECLARE $uid AS Utf8; DELETE FROM `incomes` WHERE user_id=$uid;', { $uid: U(uid) }),
    async replaceIncomes(uid, rows) {
      const steps = [{ sql: 'DECLARE $uid AS Utf8; DELETE FROM `incomes` WHERE user_id=$uid;', params: { $uid: U(uid) } }];
      if (rows.length) {
        const declarations = ['DECLARE $uid AS Utf8;'];
        const values = [];
        const params = { $uid: U(uid) };
        rows.forEach((row, index) => {
          declarations.push(`DECLARE $id${index} AS Utf8; DECLARE $date${index} AS Utf8; DECLARE $category${index} AS Utf8; DECLARE $description${index} AS Utf8; DECLARE $amount${index} AS Double; DECLARE $created${index} AS Timestamp; DECLARE $updated${index} AS Timestamp;`);
          values.push(`($uid,$id${index},$date${index},$category${index},$description${index},$amount${index},$created${index},$updated${index})`);
          params[`$id${index}`] = U(row.id);
          params[`$date${index}`] = U(row.income_date);
          params[`$category${index}`] = U(row.category);
          params[`$description${index}`] = U(row.description);
          params[`$amount${index}`] = D(row.amount);
          params[`$created${index}`] = T(row.created_at);
          params[`$updated${index}`] = T(row.updated_at);
        });
        steps.push({ sql: `${declarations.join(' ')} UPSERT INTO \`incomes\` (user_id,id,income_date,category,description,amount,created_at,updated_at) VALUES ${values.join(',')};`, params });
      }
      steps.push({ sql: 'DECLARE $uid AS Utf8; ' + revisionSql, params: () => ({ $uid: U(uid), ...revisionParams() }) });
      await transaction(steps);
      return rows;
    },
    deleteAccount: (uid) => transaction([
      'incomes', 'categories', 'settings', 'sessions', 'password_reset_tokens', 'auth_identities', 'users'
    ].map((table) => ({ sql: `DECLARE $uid AS Utf8; DELETE FROM \`${table}\` WHERE user_id=$uid;`, params: { $uid: U(uid) } }))),
    listCategories: (uid) => query(`DECLARE $uid AS Utf8;
      SELECT user_id,id,name,created_at FROM \`categories\` WHERE user_id=$uid ORDER BY created_at ASC;`, { $uid: U(uid) }),
    getCategory: (uid, id) => first(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8;
      SELECT user_id,id,name,created_at FROM \`categories\` WHERE user_id=$uid AND id=$id;`, { $uid: U(uid), $id: U(id) }),
    async addCategory(row) {
      const list = await this.listCategories(row.user_id);
      if (list.some((x) => x.name.toLocaleLowerCase('ru-RU') === row.name.toLocaleLowerCase('ru-RU'))) return false;
      await mutate(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DECLARE $name AS Utf8; DECLARE $created AS Timestamp;
        INSERT INTO \`categories\` (user_id,id,name,created_at) VALUES ($uid,$id,$name,$created);`,
      { $uid: U(row.user_id), $id: U(row.id), $name: U(row.name), $created: T(row.created_at) });
      return true;
    },
    deleteCategory: (uid, id) => mutate('DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DELETE FROM `categories` WHERE user_id=$uid AND id=$id;', { $uid: U(uid), $id: U(id) }),
    listSettings: (uid) => query(`DECLARE $uid AS Utf8; SELECT user_id,setting_key,setting_value,updated_at
      FROM \`settings\` WHERE user_id=$uid ORDER BY setting_key;`, { $uid: U(uid) }),
    putSetting: (row) => (internalSetting(row.setting_key) ? query : mutate)(`DECLARE $uid AS Utf8; DECLARE $key AS Utf8; DECLARE $value AS Utf8; DECLARE $updated AS Timestamp;
      UPSERT INTO \`settings\` (user_id,setting_key,setting_value,updated_at) VALUES ($uid,$key,$value,$updated);`,
    { $uid: U(row.user_id), $key: U(row.setting_key), $value: U(row.setting_value), $updated: T(row.updated_at) })
  };
}

function incomeParams(row) {
  return { $uid: U(row.user_id), $id: U(row.id), $date: U(row.income_date), $category: U(row.category),
    $description: U(row.description), $amount: D(row.amount), $created: T(row.created_at), $updated: T(row.updated_at) };
}
module.exports = { createYdbStore };

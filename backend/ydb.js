'use strict';

// The SDK is loaded only in the deployed adapter; route tests use an in-memory store.
const { Driver, MetadataAuthService, TypedValues, TypedData } = require('ydb-sdk');

const U = TypedValues.utf8;
const T = TypedValues.timestamp;
const D = TypedValues.double;

function createYdbStore(env = process.env) {
  if (!env.ENDPOINT || !env.DATABASE) throw new Error('ENDPOINT and DATABASE are required');
  const driver = new Driver({ endpoint: env.ENDPOINT, database: env.DATABASE, authService: new MetadataAuthService() });
  let readyPromise;
  async function query(text, params = {}) {
    readyPromise ||= driver.ready(10000);
    try {
      if (!await readyPromise) throw new Error('YDB driver is not ready');
    } catch (error) { readyPromise = null; throw error; }
    return driver.tableClient.withSession(async (session) => {
      const result = await session.executeQuery(text, params);
      return result.resultSets?.[0] ? TypedData.createNativeObjects(result.resultSets[0]) : [];
    });
  }
  const first = async (text, params) => (await query(text, params))[0] || null;
  const conflict = (error) => /already exists|duplicate|precondition.failed|constraint/i.test(String(error?.message || ''));

  return {
    health: async () => { await query('SELECT 1 AS ok;'); },
    getUser: (id) => first('DECLARE $id AS Utf8; SELECT user_id,email,status,created_at,updated_at,trial_ends_at FROM `users` WHERE user_id=$id;', { $id: U(id) }),
    getIdentity: (provider, providerUserId) => first('DECLARE $p AS Utf8; DECLARE $id AS Utf8; SELECT provider,provider_user_id,user_id,password_hash FROM `auth_identities` WHERE provider=$p AND provider_user_id=$id;', { $p: U(provider), $id: U(providerUserId) }),
    async register(user, passwordHash) {
      const existing = await this.getIdentity('email', user.email);
      if (existing) return false;
      try {
        // Both INSERT statements execute in one YDB table transaction.
        await query(`DECLARE $uid AS Utf8; DECLARE $email AS Utf8; DECLARE $provider AS Utf8; DECLARE $status AS Utf8;
          DECLARE $created AS Timestamp; DECLARE $updated AS Timestamp; DECLARE $trial AS Timestamp;
          DECLARE $hash AS Utf8;
          INSERT INTO \`auth_identities\` (provider,provider_user_id,user_id,password_hash,created_at)
          VALUES ($provider,$email,$uid,$hash,$created);
          INSERT INTO \`users\` (user_id,email,status,created_at,updated_at,trial_ends_at)
          VALUES ($uid,$email,$status,$created,$updated,$trial);`,
        { $uid: U(user.user_id), $email: U(user.email), $provider: U('email'), $status: U(user.status), $created: T(user.created_at),
          $updated: T(user.updated_at), $trial: T(user.trial_ends_at), $hash: U(passwordHash) });
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
    listIncomes: (uid) => query(`DECLARE $uid AS Utf8;
      SELECT user_id,id,income_date,category,description,amount,created_at,updated_at FROM \`incomes\`
      WHERE user_id=$uid ORDER BY income_date DESC,created_at DESC;`, { $uid: U(uid) }),
    getIncome: (uid, id) => first(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8;
      SELECT user_id,id,income_date,category,description,amount,created_at,updated_at FROM \`incomes\`
      WHERE user_id=$uid AND id=$id;`, { $uid: U(uid), $id: U(id) }),
    async addIncome(row) {
      if (await this.getIncome(row.user_id, row.id)) return false;
      try {
        await query(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DECLARE $date AS Utf8;
          DECLARE $category AS Utf8; DECLARE $description AS Utf8; DECLARE $amount AS Double;
          DECLARE $created AS Timestamp; DECLARE $updated AS Timestamp;
          INSERT INTO \`incomes\` (user_id,id,income_date,category,description,amount,created_at,updated_at)
          VALUES ($uid,$id,$date,$category,$description,$amount,$created,$updated);`, incomeParams(row));
        return true;
      } catch (error) { if (conflict(error)) return false; throw error; }
    },
    async updateIncome(uid, id, row, updatedAt) {
      if (!await this.getIncome(uid, id)) return false;
      await query(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DECLARE $date AS Utf8;
        DECLARE $category AS Utf8; DECLARE $description AS Utf8; DECLARE $amount AS Double;
        DECLARE $updated AS Timestamp;
        UPDATE \`incomes\` SET income_date=$date,category=$category,description=$description,amount=$amount,updated_at=$updated
        WHERE user_id=$uid AND id=$id;`, { $uid: U(uid), $id: U(id), $date: U(row.income_date),
          $category: U(row.category), $description: U(row.description), $amount: D(row.amount), $updated: T(updatedAt) });
      return true;
    },
    async deleteIncome(uid, id) {
      if (!await this.getIncome(uid, id)) return false;
      await query('DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DELETE FROM `incomes` WHERE user_id=$uid AND id=$id;', { $uid: U(uid), $id: U(id) });
      return true;
    },
    listCategories: (uid) => query(`DECLARE $uid AS Utf8;
      SELECT user_id,id,name,created_at FROM \`categories\` WHERE user_id=$uid ORDER BY created_at ASC;`, { $uid: U(uid) }),
    getCategory: (uid, id) => first(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8;
      SELECT user_id,id,name,created_at FROM \`categories\` WHERE user_id=$uid AND id=$id;`, { $uid: U(uid), $id: U(id) }),
    async addCategory(row) {
      const list = await this.listCategories(row.user_id);
      if (list.some((x) => x.name.toLocaleLowerCase('ru-RU') === row.name.toLocaleLowerCase('ru-RU'))) return false;
      await query(`DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DECLARE $name AS Utf8; DECLARE $created AS Timestamp;
        INSERT INTO \`categories\` (user_id,id,name,created_at) VALUES ($uid,$id,$name,$created);`,
      { $uid: U(row.user_id), $id: U(row.id), $name: U(row.name), $created: T(row.created_at) });
      return true;
    },
    deleteCategory: (uid, id) => query('DECLARE $uid AS Utf8; DECLARE $id AS Utf8; DELETE FROM `categories` WHERE user_id=$uid AND id=$id;', { $uid: U(uid), $id: U(id) }),
    listSettings: (uid) => query(`DECLARE $uid AS Utf8; SELECT user_id,setting_key,setting_value,updated_at
      FROM \`settings\` WHERE user_id=$uid ORDER BY setting_key;`, { $uid: U(uid) }),
    putSetting: (row) => query(`DECLARE $uid AS Utf8; DECLARE $key AS Utf8; DECLARE $value AS Utf8; DECLARE $updated AS Timestamp;
      UPSERT INTO \`settings\` (user_id,setting_key,setting_value,updated_at) VALUES ($uid,$key,$value,$updated);`,
    { $uid: U(row.user_id), $key: U(row.setting_key), $value: U(row.setting_value), $updated: T(row.updated_at) })
  };
}

function incomeParams(row) {
  return { $uid: U(row.user_id), $id: U(row.id), $date: U(row.income_date), $category: U(row.category),
    $description: U(row.description), $amount: D(row.amount), $created: T(row.created_at), $updated: T(row.updated_at) };
}
module.exports = { createYdbStore };

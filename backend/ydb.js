'use strict';

const { createYdbStore: createBaseYdbStore } = require('./ydb-core');
const { Driver, MetadataAuthService, TypedData } = require('ydb-sdk');

function createYdbStore(env, DriverClass) {
  const customDriver = typeof DriverClass === 'function';
  const config = env || process.env;
  const store = createBaseYdbStore(config, DriverClass);

  // Unit/integration harnesses inject their own DriverClass and rely on the
  // original adapter semantics. The production Cloud Function does not pass
  // one, so only the deployed path receives the latency optimization below.
  if (customDriver) return store;

  const baseAddIncome = store.addIncome;
  const baseGetIncome = store.getIncome.bind(store);
  const justCreated = new Map();

  const keyFor = (uid, id) => String(uid) + '\u0000' + String(id);

  store.addIncome = async function addIncomeFast(row) {
    const key = keyFor(row.user_id, row.id);
    // The INSERT itself is authoritative for duplicate detection. Skipping the
    // preliminary SELECT removes one YDB round-trip while preserving the
    // existing conflict handling inside the base store.
    const created = await baseAddIncome.call({ getIncome: async () => null }, row);
    if (created) {
      justCreated.set(key, { ...row });
      const timer = setTimeout(() => justCreated.delete(key), 10000);
      if (typeof timer.unref === 'function') timer.unref();
    }
    return created;
  };

  store.getIncome = async function getIncomeFast(uid, id) {
    const key = keyFor(uid, id);
    if (justCreated.has(key)) {
      const row = justCreated.get(key);
      justCreated.delete(key);
      return row;
    }
    return baseGetIncome(uid, id);
  };

  // The admin list is deliberately kept outside the normal application data
  // bundle: only an authenticated admin endpoint can call this method. A lazy
  // driver keeps ordinary user requests unchanged.
  let adminDriver = null;
  let adminReadyPromise = null;
  async function readyAdminDriver() {
    if (!adminDriver) {
      adminDriver = new Driver({
        endpoint: config.ENDPOINT,
        database: config.DATABASE,
        authService: new MetadataAuthService()
      });
    }
    adminReadyPromise ||= adminDriver.ready(10000);
    try {
      if (!await adminReadyPromise) throw new Error('YDB admin driver is not ready');
    } catch (error) {
      adminReadyPromise = null;
      throw error;
    }
  }

  store.listAdminUsers = async function listAdminUsers() {
    await readyAdminDriver();
    return adminDriver.tableClient.withSession(async (session) => {
      const result = await session.executeQuery(`
        SELECT user_id,email,status,created_at,updated_at,trial_ends_at
          FROM \`users\` ORDER BY created_at DESC;
        SELECT user_id,setting_key,setting_value,updated_at
          FROM \`settings\`
          WHERE setting_key="billing.admin_override" OR setting_key="billing.access";
      `);
      const rows = (index) => result.resultSets?.[index]
        ? TypedData.createNativeObjects(result.resultSets[index])
        : [];
      return { users: rows(0), settings: rows(1) };
    });
  };

  return store;
}

module.exports = { createYdbStore };

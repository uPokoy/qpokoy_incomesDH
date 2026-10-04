'use strict';

const { createYdbStore: createBaseYdbStore } = require('./ydb-core');

function createYdbStore(env, DriverClass) {
  const store = createBaseYdbStore(env, DriverClass);
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

  return store;
}

module.exports = { createYdbStore };

'use strict';
const OVERRIDE_KEY = 'billing.admin_override';
const AUDIT_OWNER = 'system.admin_audit';
function adminIds(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return new Set(list.map(x => String(x).trim().toLowerCase()).filter(x => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)));
}
function readGrant(row) {
  try {
    const v = JSON.parse(row?.setting_value || 'null');
    if (!v || !['monthly', 'yearly', 'lifetime'].includes(v.plan)) return null;
    const paymentId = /^[A-Za-z0-9-]{10,80}$/.test(String(v.last_payment_id || '')) ? String(v.last_payment_id) : null;
    const paidAtMs = Date.parse(v.last_paid_at || '');
    const paidAt = Number.isFinite(paidAtMs) ? new Date(paidAtMs).toISOString() : null;
    return { plan: v.plan, paid_until: v.paid_until || null, grace_until: v.grace_until || null,
      auto_renew: v.plan !== 'lifetime' && v.auto_renew === true,
      last_payment_id: paymentId, last_paid_at: paidAt };
  } catch (_) { return null; }
}
function grantFor(action, date, current) {
  if (action === 'lifetime') return { plan: 'lifetime', paid_until: null, grace_until: null, auto_renew: false };
  let end;
  if (action === 'until') {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date');
    const check = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
    // Date grants include the selected day in Moscow, followed by the existing three-day grace.
    end = new Date(date + 'T23:59:59.999+03:00');
  } else if (action === 'month' || action === 'year') {
    end = new Date(current);
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + (action === 'month' ? 1 : 12));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, last));
  } else { throw new Error('Invalid action'); }
  return { plan: action === 'year' ? 'yearly' : 'monthly', paid_until: end.toISOString(),
    grace_until: new Date(end.getTime() + 3 * 86400000).toISOString(), auto_renew: false };
}
module.exports = { OVERRIDE_KEY, AUDIT_OWNER, adminIds, readGrant, grantFor };

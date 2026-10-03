from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'backend/app.js',
    "  oauthExchangeIp: { limit: 30, windowMs: 10 * 60 * 1000 }\n});",
    "  oauthExchangeIp: { limit: 30, windowMs: 10 * 60 * 1000 },\n"
    "  adminLookupIp: { limit: 120, windowMs: 60 * 60 * 1000 },\n"
    "  adminWriteIp: { limit: 60, windowMs: 60 * 60 * 1000 }\n});"
)

replace_once(
    'backend/app.js',
    "  })();\n\n  const isoDate =",
    "  })();\n"
    "  const adminUserIds = new Set((Array.isArray(options.adminUserIds) ? options.adminUserIds : String(options.adminUserIds || '').split(','))\n"
    "    .map((value) => String(value || '').trim()).filter(Boolean));\n\n"
    "  const isoDate ="
)

replace_once(
    'backend/app.js',
    "    const plan = ['monthly', 'yearly', 'lifetime'].includes(saved?.plan) ? saved.plan : null;\n"
    "    const paidUntil = isoDate(saved?.paid_until);\n"
    "    const graceUntil = isoDate(saved?.grace_until);\n"
    "    const autoRenew = Boolean(saved?.auto_renew && (plan === 'monthly' || plan === 'yearly'));\n"
    "    if (plan === 'lifetime') return { ...base, mode: 'lifetime', status: 'active', plan, source: 'payment' };\n"
    "    if ((plan === 'monthly' || plan === 'yearly') && paidUntil && new Date(paidUntil).getTime() > currentMs) {\n"
    "      return { ...base, mode: 'paid', status: 'active', plan, auto_renew: autoRenew, paid_until: paidUntil, grace_until: graceUntil };\n"
    "    }\n"
    "    if ((plan === 'monthly' || plan === 'yearly') && graceUntil && new Date(graceUntil).getTime() > currentMs) {\n"
    "      return { ...base, mode: 'grace', status: 'grace', plan, auto_renew: autoRenew, paid_until: paidUntil, grace_until: graceUntil };\n"
    "    }",
    "    const plan = ['monthly', 'yearly', 'lifetime', 'manual'].includes(saved?.plan) ? saved.plan : null;\n"
    "    const paidUntil = isoDate(saved?.paid_until);\n"
    "    const graceUntil = isoDate(saved?.grace_until);\n"
    "    const autoRenew = Boolean(saved?.auto_renew && (plan === 'monthly' || plan === 'yearly'));\n"
    "    const source = saved?.source === 'admin' ? 'admin' : 'payment';\n"
    "    if (plan === 'lifetime') return { ...base, mode: 'lifetime', status: 'active', plan, source };\n"
    "    if (['monthly', 'yearly', 'manual'].includes(plan) && paidUntil && new Date(paidUntil).getTime() > currentMs) {\n"
    "      return { ...base, mode: 'paid', status: 'active', plan, source, auto_renew: autoRenew, paid_until: paidUntil, grace_until: graceUntil };\n"
    "    }\n"
    "    if (['monthly', 'yearly', 'manual'].includes(plan) && graceUntil && new Date(graceUntil).getTime() > currentMs) {\n"
    "      return { ...base, mode: 'grace', status: 'grace', plan, source, auto_renew: autoRenew, paid_until: paidUntil, grace_until: graceUntil };\n"
    "    }"
)

old_helper = """  async function requireWriteAccess(user) {
    const access = await billingAccess(user);
    if (!access.can_write) {
      throw new HttpError(402, 'subscription_required',
        'Пробный период или подписка закончились. Доступны просмотр данных, экспорт PDF и удаление аккаунта.');
    }
    return access;
  }

"""
new_helper = old_helper + """  function isAdmin(user) {
    return Boolean(user?.user_id && adminUserIds.has(String(user.user_id)));
  }
  function requireAdmin(user) {
    if (!isAdmin(user)) throw new HttpError(403, 'admin_forbidden', 'Доступ к админ-панели запрещён.');
  }
  async function storedBilling(userId) {
    const row = await store.getSetting(userId, BILLING_ACCESS_SETTING);
    if (!row?.setting_value) return null;
    try {
      const value = JSON.parse(row.setting_value);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (_) { return null; }
  }
  async function adminUserPayload(target) {
    return {
      user: publicUser(target),
      billing: await billingAccess(target),
      manual: await storedBilling(target.user_id)
    };
  }
  function addUtcMonths(value, months) {
    const result = new Date(value);
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const maxDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, maxDay));
    return result;
  }
  async function auditAdminBilling(adminUser, targetUser, action, before, after, when) {
    const suffix = randomBytes(6).toString('hex');
    await store.putSetting({
      user_id: targetUser.user_id,
      setting_key: `billing.audit.${when.getTime()}.${suffix}`,
      setting_value: JSON.stringify({
        action,
        admin_user_id: adminUser.user_id,
        target_user_id: targetUser.user_id,
        at: when.toISOString(),
        before: before || null,
        after: after || null
      }),
      updated_at: when
    });
  }

"""
replace_once('backend/app.js', old_helper, new_helper)

old_route = """      if (method === 'GET' && pathname === '/billing/status') return response(200, {
        data: await billingAccess(user), plans: BILLING_PLANS
      });
"""
new_route = old_route + """      if (method === 'GET' && pathname === '/admin/status') return response(200, {
        data: { is_admin: isAdmin(user), user_id: user.user_id, email: user.email }
      });
      if (method === 'GET' && pathname === '/admin/users') {
        requireAdmin(user);
        await enforceRateLimit('adminLookupIp', sourceIp + ':' + user.user_id);
        const email = emailValue(url.searchParams.get('email') || '');
        const identity = await store.getIdentity('email', email);
        const target = identity ? await store.getUser(identity.user_id) : null;
        if (!target) throw new HttpError(404, 'admin_user_not_found', 'Пользователь не найден.');
        return response(200, { data: await adminUserPayload(target) });
      }
      const adminBillingMatch = /^\/admin\/users\/([^/]+)\/billing$/.exec(pathname);
      if (adminBillingMatch && method === 'PUT') {
        requireAdmin(user);
        await enforceRateLimit('adminWriteIp', sourceIp + ':' + user.user_id);
        const targetId = uuidValue(adminBillingMatch[1]);
        const target = await store.getUser(targetId);
        if (!target) throw new HttpError(404, 'admin_user_not_found', 'Пользователь не найден.');
        const action = requiredString(body.action, 'action', 40);
        const allowedActions = new Set(['grant_month', 'grant_year', 'grant_lifetime', 'set_until', 'clear_manual']);
        if (!allowedActions.has(action)) bad('Invalid admin billing action');
        const before = await storedBilling(targetId);
        const when = now();

        if (action === 'clear_manual') {
          if (!before || before.source !== 'admin') {
            throw new HttpError(409, 'admin_manual_access_missing', 'У пользователя нет ручного доступа, который можно сбросить.');
          }
          await store.deleteSetting(targetId, BILLING_ACCESS_SETTING);
          await auditAdminBilling(user, target, action, before, null, when);
          return response(200, { data: await adminUserPayload(target) });
        }

        if (before && before.source !== 'admin') {
          throw new HttpError(409, 'admin_payment_access_exists',
            'У пользователя есть платёжная запись подписки. Ручное изменение не выполнено, чтобы не повредить платёжные данные.');
        }
        if (before?.plan === 'lifetime' && action !== 'grant_lifetime') {
          throw new HttpError(409, 'admin_lifetime_access_exists',
            'Сначала сбросьте ручной бессрочный доступ, затем задайте новый срок.');
        }

        let after;
        if (action === 'grant_lifetime') {
          after = { plan: 'lifetime', source: 'admin', paid_until: null, grace_until: null, auto_renew: false };
        } else if (action === 'set_until') {
          const until = requiredString(body.until, 'until', 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) bad('Invalid until');
          const end = new Date(`${until}T23:59:59.999Z`);
          if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== until || end <= when) bad('Invalid until');
          after = { plan: 'manual', source: 'admin', paid_until: end.toISOString(), grace_until: null, auto_renew: false };
        } else {
          const savedUntil = before?.paid_until ? new Date(before.paid_until) : null;
          const base = savedUntil && Number.isFinite(savedUntil.getTime()) && savedUntil > when ? savedUntil : when;
          const months = action === 'grant_year' ? 12 : 1;
          const end = addUtcMonths(base, months);
          after = {
            plan: action === 'grant_year' ? 'yearly' : 'monthly',
            source: 'admin',
            paid_until: end.toISOString(),
            grace_until: null,
            auto_renew: false
          };
        }
        after.updated_by_admin_at = when.toISOString();
        await store.putSetting({
          user_id: targetId,
          setting_key: BILLING_ACCESS_SETTING,
          setting_value: JSON.stringify(after),
          updated_at: when
        });
        await auditAdminBilling(user, target, action, before, after, when);
        return response(200, { data: await adminUserPayload(target) });
      }
"""
replace_once('backend/app.js', old_route, new_route)

replace_once(
    'backend/index.js',
    "      billingEnforcementStartedAt: process.env.BILLING_ENFORCEMENT_STARTED_AT || '',\n",
    "      billingEnforcementStartedAt: process.env.BILLING_ENFORCEMENT_STARTED_AT || '',\n"
    "      adminUserIds: process.env.ADMIN_USER_IDS || '',\n"
)

replace_once(
    'js/api-client.js',
    "      async billingStatus(){return (await request('GET','/billing/status')).data;},\n      async listIncomes()",
    "      async billingStatus(){return (await request('GET','/billing/status')).data;},\n"
    "      async adminStatus(){return (await request('GET','/admin/status')).data;},\n"
    "      async adminFindUser(email){return (await request('GET','/admin/users?email='+encodeURIComponent(email))).data;},\n"
    "      async adminSetBilling(userId,body){return (await request('PUT','/admin/users/'+encodeURIComponent(userId)+'/billing',body)).data;},\n"
    "      async listIncomes()"
)

replace_once(
    '.github/workflows/frontend-deploy.yml',
    "          cp index.html about.html offer.html pricing.html privacy.html manifest.json site/\n",
    "          cp index.html admin.html about.html offer.html pricing.html privacy.html manifest.json site/\n"
)

routes_test = Path('.github/dev168_routes_test.txt').read_text(encoding='utf-8').strip()
p = Path('backend/test/routes.test.js')
text = p.read_text(encoding='utf-8')
if "admin billing panel is server-authorized" in text:
    raise SystemExit('backend admin test already exists')
p.write_text(text.rstrip() + '\n\n' + routes_test + '\n', encoding='utf-8')

api_test = Path('.github/dev168_api_test.txt').read_text(encoding='utf-8').strip()
p = Path('tests/api-client.test.js')
text = p.read_text(encoding='utf-8')
if "admin client uses authenticated status" in text:
    raise SystemExit('api admin test already exists')
p.write_text(text.rstrip() + '\n\n' + api_test + '\n', encoding='utf-8')

for name in ['js/app.js', 'index.html']:
    p = Path(name)
    text = p.read_text(encoding='utf-8')
    if 'dev-2026.10.03.167' not in text:
        raise SystemExit(f'{name}: DEV167 marker not found')
    p.write_text(text.replace('dev-2026.10.03.167', 'dev-2026.10.03.168'), encoding='utf-8')

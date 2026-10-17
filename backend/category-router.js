'use strict';

// Authentication stays in app.handle; errors propagate to its existing catch.
function createCategoryRouter({ store, requireWriteAccess, requiredString, uuidValue, randomUUID, now, HttpError, response }) {
  async function handle(method, pathname, body, user) {
    const userId = user.user_id;
    if (pathname === '/categories' && method === 'GET') return response(200, { data: await store.listCategories(userId) });
    if (pathname === '/categories' && method === 'POST') {
      await requireWriteAccess(user);
      const name = requiredString(body.name, 'name', 80).replace(/\s+/g, ' ');
      if (body.request_id !== undefined) {
        const requestId = uuidValue(requiredString(body.request_id, 'request_id', 36)).toLowerCase();
        const result = await store.addCategoryIdempotent({ user_id: userId, id: randomUUID(), name, created_at: now() }, requestId);
        if (result.error === 'idempotency_conflict') throw new HttpError(409, result.error, 'Request id already used for a different category name');
        if (result.error === 'category_exists') throw new HttpError(409, result.error, 'Category already exists');
        if (result.error === 'category_request_deleted') throw new HttpError(409, result.error, 'Category created by this request was deleted');
        return response(result.created ? 201 : 200, { data: result.category });
      }
      const id = randomUUID();
      const created = await store.addCategory({ user_id: userId, id, name, created_at: now() });
      if (!created) throw new HttpError(409, 'category_exists', 'Category already exists');
      return response(201, { data: await store.getCategory(userId, id) });
    }
    const categoryMatch = /^\/categories\/([^/]+)$/.exec(pathname);
    if (categoryMatch && method === 'DELETE') {
      await requireWriteAccess(user);
      const id = uuidValue(categoryMatch[1]);
      const category = await store.getCategory(userId, id);
      if (!category) throw new HttpError(404, 'not_found', 'Category not found');
      if (category.name.toLocaleLowerCase('ru-RU') === 'зарплата') throw new HttpError(403, 'protected_category', 'Salary category cannot be deleted');
      await store.deleteCategory(userId, id);
      return response(204, null);
    }
    return null;
  }
  return { handle };
}

module.exports = { createCategoryRouter };

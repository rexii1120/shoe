import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createDatabase } from './database.js';

const statusLabels = {
  paid: '已支付待发货',
  shipped: '已发货',
  active: '租赁中',
  returned: '已归还',
  completed: '已完成',
  cancelled: '已取消'
};

const terminalStatuses = new Set(['returned', 'completed', 'cancelled']);
const validStatuses = new Set(Object.keys(statusLabels));

export async function createApp(options = {}) {
  const store = await createDatabase({ dbPath: options.dbPath });
  const jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'court-kicks-dev-secret';
  const app = express();

  app.locals.store = store;

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, database: store.dbPath });
  });

  app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    assert(name?.trim(), 400, '请输入姓名');
    assert(validEmail(email), 400, '请输入有效邮箱');
    assert(String(password || '').length >= 6, 400, '密码至少 6 位');

    const existing = store.get('SELECT id FROM users WHERE lower(email) = lower(?)', [email]);
    assert(!existing, 409, '该邮箱已注册');

    const passwordHash = await bcrypt.hash(password, 10);
    const createdAt = new Date().toISOString();
    store.run(
      'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), passwordHash, 'user', createdAt]
    );

    const user = store.get('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [store.lastInsertId()]);
    res.status(201).json({ user: serializeUser(user), token: signToken(user, jwtSecret) });
  }));

  app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    assert(validEmail(email), 400, '请输入有效邮箱');
    assert(password, 400, '请输入密码');

    const user = store.get('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
    assert(user, 401, '邮箱或密码不正确');

    const matches = await bcrypt.compare(password, user.password_hash);
    assert(matches, 401, '邮箱或密码不正确');

    res.json({ user: serializeUser(user), token: signToken(user, jwtSecret) });
  }));

  app.get('/api/auth/me', requireAuth(jwtSecret), (req, res) => {
    res.json({ user: req.user });
  });

  app.get('/api/shoes', (req, res) => {
    const search = String(req.query.search || '').trim();
    const category = String(req.query.category || '').trim();
    const params = [];
    const where = ['s.is_active = 1'];

    if (search) {
      const keyword = `%${search}%`;
      where.push('(s.name LIKE ? OR s.brand LIKE ? OR s.category LIKE ? OR s.tags LIKE ?)');
      params.push(keyword, keyword, keyword, keyword);
    }

    if (category && category !== '全部') {
      where.push('s.category = ?');
      params.push(category);
    }

    const rows = store.all(
      `SELECT s.* FROM shoes s WHERE ${where.join(' AND ')} ORDER BY s.rating DESC, s.created_at DESC`,
      params
    );

    res.json({ shoes: hydrateShoes(store, rows) });
  });

  app.get('/api/shoes/:id', (req, res) => {
    const row = store.get('SELECT * FROM shoes WHERE id = ? AND is_active = 1', [req.params.id]);
    assert(row, 404, '未找到鞋款');
    res.json({ shoe: hydrateShoes(store, [row])[0] });
  });

  app.get('/api/orders', requireAuth(jwtSecret), (req, res) => {
    const rows = orderRows(store, 'WHERE o.user_id = ?', [req.user.id]);
    res.json({ orders: rows.map(formatOrder) });
  });

  app.post('/api/orders', requireAuth(jwtSecret), (req, res) => {
    const {
      shoeId,
      size,
      rentalStart,
      rentalEnd,
      customerName,
      phone,
      address
    } = req.body;

    assert(Number.isInteger(Number(shoeId)), 400, '请选择鞋款');
    assert(size, 400, '请选择尺码');
    assert(customerName?.trim(), 400, '请输入收货人');
    assert(phone?.trim(), 400, '请输入联系电话');
    assert(address?.trim(), 400, '请输入配送地址');

    const rentalDays = calculateRentalDays(rentalStart, rentalEnd);
    const shoe = store.get('SELECT * FROM shoes WHERE id = ? AND is_active = 1', [shoeId]);
    assert(shoe, 404, '未找到鞋款');

    const inventory = store.get(
      'SELECT * FROM shoe_inventory WHERE shoe_id = ? AND size = ?',
      [shoeId, String(size)]
    );
    assert(inventory && inventory.available_qty > 0, 409, '该尺码库存不足');

    const subtotal = shoe.daily_rate * rentalDays;
    const total = subtotal + shoe.deposit;
    const now = new Date().toISOString();
    const orderNumber = `CK${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;

    const orderId = store.transaction(() => {
      store.run(
        'UPDATE shoe_inventory SET available_qty = available_qty - 1 WHERE id = ? AND available_qty > 0',
        [inventory.id],
        false
      );
      store.run(
        `INSERT INTO orders (
          order_number, user_id, status, rental_start, rental_end, rental_days,
          subtotal, deposit, total, customer_name, phone, address,
          inventory_released, created_at, paid_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          orderNumber,
          req.user.id,
          'paid',
          rentalStart,
          rentalEnd,
          rentalDays,
          subtotal,
          shoe.deposit,
          total,
          customerName.trim(),
          phone.trim(),
          address.trim(),
          now,
          now,
          now
        ],
        false
      );

      const insertedOrderId = store.lastInsertId();
      store.run(
        `INSERT INTO order_items (
          order_id, shoe_id, shoe_name, shoe_brand, image_url, size,
          quantity, daily_rate, deposit
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          insertedOrderId,
          shoe.id,
          shoe.name,
          shoe.brand,
          shoe.image_url,
          String(size),
          shoe.daily_rate,
          shoe.deposit
        ],
        false
      );

      return insertedOrderId;
    });

    const order = orderRows(store, 'WHERE o.id = ?', [orderId])[0];
    res.status(201).json({ order: formatOrder(order) });
  });

  app.post('/api/orders/:id/cancel', requireAuth(jwtSecret), (req, res) => {
    const order = store.get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    assert(order, 404, '未找到订单');
    assert(['paid', 'shipped'].includes(order.status), 409, '当前订单不能取消');
    updateOrderStatus(store, order.id, 'cancelled');
    res.json({ order: formatOrder(orderRows(store, 'WHERE o.id = ?', [order.id])[0]) });
  });

  app.get('/api/admin/summary', requireAuth(jwtSecret), requireAdmin, (req, res) => {
    const totalShoes = store.get('SELECT COUNT(*) AS count FROM shoes WHERE is_active = 1').count;
    const activeOrders = store.get(
      "SELECT COUNT(*) AS count FROM orders WHERE status IN ('paid', 'shipped', 'active')"
    ).count;
    const revenue = store.get("SELECT COALESCE(SUM(subtotal), 0) AS amount FROM orders WHERE status != 'cancelled'").amount;
    const lowStock = store.get('SELECT COUNT(*) AS count FROM shoe_inventory WHERE available_qty <= 1').count;

    res.json({ totalShoes, activeOrders, revenue, lowStock });
  });

  app.get('/api/admin/shoes', requireAuth(jwtSecret), requireAdmin, (req, res) => {
    const rows = store.all('SELECT * FROM shoes ORDER BY is_active DESC, created_at DESC');
    res.json({ shoes: hydrateShoes(store, rows) });
  });

  app.get('/api/admin/orders', requireAuth(jwtSecret), requireAdmin, (req, res) => {
    const rows = orderRows(store, '', []);
    res.json({ orders: rows.map(formatOrder) });
  });

  app.patch('/api/admin/orders/:id/status', requireAuth(jwtSecret), requireAdmin, (req, res) => {
    const { status } = req.body;
    assert(validStatuses.has(status), 400, '订单状态无效');

    const order = store.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    assert(order, 404, '未找到订单');
    assert(!(order.inventory_released && !terminalStatuses.has(status)), 409, '已释放库存的订单不能回退到进行中状态');

    updateOrderStatus(store, order.id, status);
    res.json({ order: formatOrder(orderRows(store, 'WHERE o.id = ?', [order.id])[0]) });
  });

  app.post('/api/admin/shoes', requireAuth(jwtSecret), requireAdmin, (req, res) => {
    const payload = normalizeShoePayload(req.body, true);
    const now = new Date().toISOString();
    const slug = createSlug(payload.name);

    const duplicate = store.get('SELECT id FROM shoes WHERE slug = ?', [slug]);
    assert(!duplicate, 409, '该鞋款已存在');

    const shoeId = store.transaction(() => {
      store.run(
        `INSERT INTO shoes (
          name, brand, slug, category, description, image_url, daily_rate,
          deposit, rating, tags, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          payload.name,
          payload.brand,
          slug,
          payload.category,
          payload.description,
          payload.imageUrl,
          payload.dailyRate,
          payload.deposit,
          payload.rating,
          payload.tags,
          now,
          now
        ],
        false
      );

      const insertedShoeId = store.lastInsertId();
      upsertInventory(store, insertedShoeId, payload.inventory);
      return insertedShoeId;
    });

    const row = store.get('SELECT * FROM shoes WHERE id = ?', [shoeId]);
    res.status(201).json({ shoe: hydrateShoes(store, [row])[0] });
  });

  app.patch('/api/admin/shoes/:id', requireAuth(jwtSecret), requireAdmin, (req, res) => {
    const existing = store.get('SELECT * FROM shoes WHERE id = ?', [req.params.id]);
    assert(existing, 404, '未找到鞋款');

    const payload = normalizeShoePayload(req.body, false, existing);
    const now = new Date().toISOString();

    store.transaction(() => {
      store.run(
        `UPDATE shoes SET
          name = ?, brand = ?, category = ?, description = ?, image_url = ?,
          daily_rate = ?, deposit = ?, rating = ?, tags = ?, is_active = ?, updated_at = ?
        WHERE id = ?`,
        [
          payload.name,
          payload.brand,
          payload.category,
          payload.description,
          payload.imageUrl,
          payload.dailyRate,
          payload.deposit,
          payload.rating,
          payload.tags,
          payload.isActive ? 1 : 0,
          now,
          existing.id
        ],
        false
      );

      if (Array.isArray(payload.inventory)) {
        upsertInventory(store, existing.id, payload.inventory);
      }
    });

    const row = store.get('SELECT * FROM shoes WHERE id = ?', [existing.id]);
    res.json({ shoe: hydrateShoes(store, [row])[0] });
  });

  app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  app.use((error, req, res, next) => {
    const status = error.status || 500;
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({ error: error.message || '服务器错误' });
  });

  return app;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAuth(jwtSecret) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    assert(token, 401, '请先登录');

    try {
      const decoded = jwt.verify(token, jwtSecret);
      const user = req.app.locals.store.get(
        'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
        [decoded.id]
      );
      assert(user, 401, '登录已失效');
      req.user = serializeUser(user);
      next();
    } catch (error) {
      if (error.status) throw error;
      next(httpError(401, '登录已失效'));
    }
  };
}

function requireAdmin(req, res, next) {
  assert(req.user?.role === 'admin', 403, '需要管理员权限');
  next();
}

function signToken(user, jwtSecret) {
  return jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: '7d' });
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.created_at
  };
}

function hydrateShoes(store, rows) {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const inventory = store.all(
    `SELECT * FROM shoe_inventory WHERE shoe_id IN (${placeholders}) ORDER BY CAST(size AS REAL), size`,
    ids
  );

  const inventoryByShoe = new Map();
  for (const item of inventory) {
    if (!inventoryByShoe.has(item.shoe_id)) inventoryByShoe.set(item.shoe_id, []);
    inventoryByShoe.get(item.shoe_id).push({
      id: item.id,
      size: item.size,
      totalQty: item.total_qty,
      availableQty: item.available_qty
    });
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    slug: row.slug,
    category: row.category,
    description: row.description,
    imageUrl: row.image_url,
    tryOnUrl: tryOnAssetFor(row.slug, row.image_url),
    dailyRate: row.daily_rate,
    deposit: row.deposit,
    rating: row.rating,
    tags: row.tags ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inventory: inventoryByShoe.get(row.id) || []
  }));
}

function orderRows(store, whereSql, params) {
  return store.all(
    `SELECT
      o.*,
      u.name AS user_name,
      u.email AS user_email,
      oi.shoe_id,
      oi.shoe_name,
      oi.shoe_brand,
      oi.image_url,
      oi.size,
      oi.quantity,
      oi.daily_rate
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN order_items oi ON oi.order_id = o.id
    ${whereSql}
    ORDER BY o.created_at DESC`,
    params
  );
}

function formatOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    statusLabel: statusLabels[row.status] || row.status,
    rentalStart: row.rental_start,
    rentalEnd: row.rental_end,
    rentalDays: row.rental_days,
    subtotal: row.subtotal,
    deposit: row.deposit,
    total: row.total,
    customerName: row.customer_name,
    phone: row.phone,
    address: row.address,
    inventoryReleased: Boolean(row.inventory_released),
    createdAt: row.created_at,
    paidAt: row.paid_at,
    updatedAt: row.updated_at,
    user: {
      id: row.user_id,
      name: row.user_name,
      email: row.user_email
    },
    item: {
      shoeId: row.shoe_id,
      shoeName: row.shoe_name,
      shoeBrand: row.shoe_brand,
      imageUrl: row.image_url,
      size: row.size,
      quantity: row.quantity,
      dailyRate: row.daily_rate
    }
  };
}

function tryOnAssetFor(slug, imageUrl) {
  const knownAssets = new Set([
    'apex-nova-1',
    'baseline-force',
    'skyhook-elite',
    'crossover-pulse'
  ]);

  return knownAssets.has(slug) ? `/assets/tryon/${slug}.svg` : imageUrl;
}

function updateOrderStatus(store, orderId, status) {
  const order = store.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  assert(order, 404, '未找到订单');

  store.transaction(() => {
    if (terminalStatuses.has(status) && !order.inventory_released) {
      const item = store.get('SELECT shoe_id, size, quantity FROM order_items WHERE order_id = ?', [orderId]);
      if (item) {
        store.run(
          'UPDATE shoe_inventory SET available_qty = available_qty + ? WHERE shoe_id = ? AND size = ?',
          [item.quantity, item.shoe_id, item.size],
          false
        );
      }
    }

    store.run(
      'UPDATE orders SET status = ?, inventory_released = ?, updated_at = ? WHERE id = ?',
      [
        status,
        terminalStatuses.has(status) ? 1 : order.inventory_released,
        new Date().toISOString(),
        orderId
      ],
      false
    );
  });
}

function upsertInventory(store, shoeId, inventory) {
  for (const item of inventory) {
    const size = String(item.size || '').trim();
    const totalQty = Number(item.totalQty);
    const availableQty = Number(item.availableQty ?? item.totalQty);
    assert(size, 400, '尺码不能为空');
    assert(Number.isInteger(totalQty) && totalQty >= 0, 400, '总库存必须是非负整数');
    assert(Number.isInteger(availableQty) && availableQty >= 0 && availableQty <= totalQty, 400, '可租库存必须在总库存范围内');

    const existing = store.get('SELECT id FROM shoe_inventory WHERE shoe_id = ? AND size = ?', [shoeId, size]);
    if (existing) {
      store.run(
        'UPDATE shoe_inventory SET total_qty = ?, available_qty = ? WHERE id = ?',
        [totalQty, availableQty, existing.id],
        false
      );
    } else {
      store.run(
        'INSERT INTO shoe_inventory (shoe_id, size, total_qty, available_qty) VALUES (?, ?, ?, ?)',
        [shoeId, size, totalQty, availableQty],
        false
      );
    }
  }
}

function normalizeShoePayload(body, requireAll, existing = {}) {
  const name = String(body.name ?? existing.name ?? '').trim();
  const brand = String(body.brand ?? existing.brand ?? '').trim();
  const category = String(body.category ?? existing.category ?? 'Performance').trim();
  const description = String(body.description ?? existing.description ?? '').trim();
  const imageUrl = String(body.imageUrl ?? existing.image_url ?? '/assets/shoes/apex-nova.svg').trim();
  const dailyRate = Number(body.dailyRate ?? existing.daily_rate);
  const deposit = Number(body.deposit ?? existing.deposit);
  const rating = Number(body.rating ?? existing.rating ?? 4.8);
  const tags = Array.isArray(body.tags) ? body.tags.join(',') : String(body.tags ?? existing.tags ?? '');
  const isActive = body.isActive ?? Boolean(existing.is_active ?? 1);
  const inventory = body.inventory;

  if (requireAll) {
    assert(name, 400, '鞋款名称不能为空');
    assert(brand, 400, '品牌不能为空');
    assert(description, 400, '描述不能为空');
    assert(Array.isArray(inventory) && inventory.length > 0, 400, '至少需要一个尺码库存');
  }

  assert(Number.isInteger(dailyRate) && dailyRate > 0, 400, '日租金必须是正整数');
  assert(Number.isInteger(deposit) && deposit >= 0, 400, '押金必须是非负整数');
  assert(Number.isFinite(rating) && rating >= 0 && rating <= 5, 400, '评分必须在 0 到 5 之间');

  return {
    name,
    brand,
    category,
    description,
    imageUrl,
    dailyRate,
    deposit,
    rating,
    tags,
    isActive,
    inventory
  };
}

function calculateRentalDays(startValue, endValue) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(startValue)), 400, '请选择租赁开始日期');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(endValue)), 400, '请选择租赁结束日期');

  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  assert(start >= today, 400, '开始日期不能早于今天');
  assert(end >= start, 400, '结束日期不能早于开始日期');

  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  assert(days <= 30, 400, '单次租赁最长 30 天');
  return days;
}

function createSlug(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || `shoe-${Date.now()}`;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function assert(condition, status, message) {
  if (!condition) throw httpError(status, message);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

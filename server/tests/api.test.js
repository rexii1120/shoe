import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function startTestServer() {
  const dbPath = path.join(os.tmpdir(), `court-kicks-${Date.now()}-${Math.random()}.sqlite`);
  const app = await createApp({ dbPath, jwtSecret: 'test-secret' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;

  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dbPath, { force: true });
    }
  };
}

async function api(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || response.statusText);
  }
  return payload;
}

test('user can rent a shoe and admin can complete it', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const userLogin = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@court.local', password: 'user123' })
  });
  assert.equal(userLogin.user.role, 'user');

  const shoesBefore = await api(server.baseUrl, '/shoes');
  assert.ok(shoesBefore.shoes.length > 0);
  const shoe = shoesBefore.shoes[0];
  const size = shoe.inventory.find((item) => item.availableQty > 0);
  assert.ok(size);

  const orderPayload = await api(server.baseUrl, '/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userLogin.token}` },
    body: JSON.stringify({
      shoeId: shoe.id,
      size: size.size,
      rentalStart: addDays(1),
      rentalEnd: addDays(3),
      customerName: 'Test User',
      phone: '13800000000',
      address: 'Test Address'
    })
  });

  assert.equal(orderPayload.order.status, 'paid');
  assert.equal(orderPayload.order.rentalDays, 3);
  assert.equal(orderPayload.order.total, shoe.dailyRate * 3 + shoe.deposit);

  const orders = await api(server.baseUrl, '/orders', {
    headers: { Authorization: `Bearer ${userLogin.token}` }
  });
  assert.equal(orders.orders.length, 1);

  const adminLogin = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@court.local', password: 'admin123' })
  });
  assert.equal(adminLogin.user.role, 'admin');

  const completed = await api(server.baseUrl, `/admin/orders/${orderPayload.order.id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminLogin.token}` },
    body: JSON.stringify({ status: 'completed' })
  });

  assert.equal(completed.order.status, 'completed');
  assert.equal(completed.order.inventoryReleased, true);
});

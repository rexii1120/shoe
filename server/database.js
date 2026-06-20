import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultDbPath = path.join(__dirname, 'data', 'rental.sqlite');

let sqlModulePromise;

function getSqlModule() {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file)
    });
  }

  return sqlModulePromise;
}

function cleanParams(params = []) {
  return params.map((value) => (value === undefined ? null : value));
}

function nowIso() {
  return new Date().toISOString();
}

export async function createDatabase(options = {}) {
  const SQL = await getSqlModule();
  const dbPath = options.dbPath || defaultDbPath;
  const useMemory = dbPath === ':memory:';
  const dbDirectory = useMemory ? null : path.dirname(dbPath);

  if (dbDirectory) {
    fs.mkdirSync(dbDirectory, { recursive: true });
  }

  const db = useMemory || !fs.existsSync(dbPath)
    ? new SQL.Database()
    : new SQL.Database(fs.readFileSync(dbPath));

  db.run('PRAGMA foreign_keys = ON');
  applySchema(db);
  await seedDatabase(db);

  function persist() {
    if (!useMemory) {
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    }
  }

  persist();

  return {
    dbPath,
    run(sql, params = [], shouldPersist = true) {
      db.run(sql, cleanParams(params));
      if (shouldPersist) persist();
    },
    exec(sql, shouldPersist = true) {
      db.exec(sql);
      if (shouldPersist) persist();
    },
    all(sql, params = []) {
      const statement = db.prepare(sql);
      const rows = [];
      try {
        statement.bind(cleanParams(params));
        while (statement.step()) {
          rows.push(statement.getAsObject());
        }
      } finally {
        statement.free();
      }
      return rows;
    },
    get(sql, params = []) {
      const statement = db.prepare(sql);
      try {
        statement.bind(cleanParams(params));
        return statement.step() ? statement.getAsObject() : null;
      } finally {
        statement.free();
      }
    },
    transaction(callback) {
      db.run('BEGIN TRANSACTION');
      try {
        const result = callback();
        db.run('COMMIT');
        persist();
        return result;
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    },
    lastInsertId() {
      return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
    },
    close() {
      db.close();
    }
  };
}

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')) DEFAULT 'user',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'Performance',
      description TEXT NOT NULL,
      image_url TEXT NOT NULL,
      daily_rate INTEGER NOT NULL,
      deposit INTEGER NOT NULL,
      rating REAL NOT NULL DEFAULT 4.8,
      tags TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shoe_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shoe_id INTEGER NOT NULL,
      size TEXT NOT NULL,
      total_qty INTEGER NOT NULL,
      available_qty INTEGER NOT NULL,
      FOREIGN KEY (shoe_id) REFERENCES shoes(id) ON DELETE CASCADE,
      UNIQUE (shoe_id, size)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      rental_start TEXT NOT NULL,
      rental_end TEXT NOT NULL,
      rental_days INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      deposit INTEGER NOT NULL,
      total INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      inventory_released INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      shoe_id INTEGER NOT NULL,
      shoe_name TEXT NOT NULL,
      shoe_brand TEXT NOT NULL,
      image_url TEXT NOT NULL,
      size TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      daily_rate INTEGER NOT NULL,
      deposit INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (shoe_id) REFERENCES shoes(id)
    );
  `);
}

async function seedDatabase(db) {
  const userCount = db.exec('SELECT COUNT(*) AS count FROM users')[0]?.values?.[0]?.[0] || 0;
  const createdAt = nowIso();

  if (userCount === 0) {
    const adminHash = await bcrypt.hash('admin123', 10);
    const userHash = await bcrypt.hash('user123', 10);

    db.run(
      'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      ['管理员', 'admin@court.local', adminHash, 'admin', createdAt]
    );
    db.run(
      'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      ['演示用户', 'user@court.local', userHash, 'user', createdAt]
    );
  }

  const shoeCount = db.exec('SELECT COUNT(*) AS count FROM shoes')[0]?.values?.[0]?.[0] || 0;
  if (shoeCount > 0) return;

  const shoes = [
    {
      name: 'Apex Nova 1',
      brand: 'CourtLab',
      slug: 'apex-nova-1',
      category: '后卫速度型',
      description: '轻量织物鞋面和回弹中底，适合快速变向、突破和全场跑动。',
      imageUrl: '/assets/shoes/apex-nova.svg',
      dailyRate: 39,
      deposit: 299,
      rating: 4.9,
      tags: '轻量,速度,室内场',
      inventory: [
        ['40', 2],
        ['41', 3],
        ['42', 4],
        ['43', 3],
        ['44', 2]
      ]
    },
    {
      name: 'Baseline Force',
      brand: 'Pivot Pro',
      slug: 'baseline-force',
      category: '锋线支撑型',
      description: '宽底稳定平台和高强度侧墙，适合锋线对抗、急停和低位脚步。',
      imageUrl: '/assets/shoes/baseline-force.svg',
      dailyRate: 45,
      deposit: 349,
      rating: 4.8,
      tags: '稳定,对抗,缓震',
      inventory: [
        ['41', 2],
        ['42', 3],
        ['43', 4],
        ['44', 3],
        ['45', 2]
      ]
    },
    {
      name: 'Skyhook Elite',
      brand: 'RimRise',
      slug: 'skyhook-elite',
      category: '全能缓震型',
      description: '厚实缓震和包裹鞋领，兼顾外线投射、篮板冲抢和日常训练。',
      imageUrl: '/assets/shoes/skyhook-elite.svg',
      dailyRate: 49,
      deposit: 399,
      rating: 4.9,
      tags: '缓震,全能,高帮',
      inventory: [
        ['40', 1],
        ['41', 2],
        ['42', 3],
        ['43', 3],
        ['44', 2],
        ['45', 1]
      ]
    },
    {
      name: 'Crossover Pulse',
      brand: 'Hardwood',
      slug: 'crossover-pulse',
      category: '实战耐磨型',
      description: '耐磨外底和透气网面，适合室外球场、多人轮换和高频租赁。',
      imageUrl: '/assets/shoes/crossover-pulse.svg',
      dailyRate: 35,
      deposit: 259,
      rating: 4.7,
      tags: '耐磨,室外场,高性价比',
      inventory: [
        ['39', 2],
        ['40', 3],
        ['41', 3],
        ['42', 4],
        ['43', 2],
        ['44', 2]
      ]
    }
  ];

  for (const shoe of shoes) {
    db.run(
      `INSERT INTO shoes (
        name, brand, slug, category, description, image_url, daily_rate,
        deposit, rating, tags, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        shoe.name,
        shoe.brand,
        shoe.slug,
        shoe.category,
        shoe.description,
        shoe.imageUrl,
        shoe.dailyRate,
        shoe.deposit,
        shoe.rating,
        shoe.tags,
        createdAt,
        createdAt
      ]
    );

    const shoeId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
    for (const [size, quantity] of shoe.inventory) {
      db.run(
        'INSERT INTO shoe_inventory (shoe_id, size, total_qty, available_qty) VALUES (?, ?, ?, ?)',
        [shoeId, size, quantity, quantity]
      );
    }
  }
}

var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};

// server/config.js
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
var root, envPath, authSecret, config;
var init_config = __esm(() => {
  root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  envPath = resolve(root, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith("#"))
        continue;
      if (process.env[m[1]] === undefined)
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  authSecret = process.env.AUTH_SECRET || "";
  if (!authSecret || authSecret.startsWith("change-me")) {
    console.warn("[config] AUTH_SECRET is not set — using an insecure development secret. Set it in .env before deploying.");
  }
  config = {
    root,
    port: Number(process.env.PORT || 3000),
    authSecret: authSecret || "dev-insecure-secret-do-not-use-in-production",
    databasePath: process.env.DATABASE_PATH || resolve(root, "data/blashaqa.db"),
    openaiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    adminEmail: process.env.ADMIN_EMAIL || "",
    adminPassword: process.env.ADMIN_PASSWORD || "",
    fcmServerKey: process.env.FCM_SERVER_KEY || "",
    uploadDir: resolve(root, "data/uploads"),
    isProd: Object.assign({}, process.env).NODE_ENV === "production",
    trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
    demoSeed: process.env.DEMO_SEED === "true"
  };
});

// server/db.js
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname as dirname2, resolve as resolve2 } from "node:path";
import { randomUUID } from "node:crypto";
function log(level, event, userId = null, meta = null) {
  try {
    db.prepare("INSERT INTO logs (level,event,user_id,meta,created_at) VALUES (?,?,?,?,?)").run(level, event, userId, meta ? JSON.stringify(meta) : null, now());
  } catch {}
}
function getSetting(key, fallback = null) {
  const r = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return r ? JSON.parse(r.value) : fallback;
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
}
function tx(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function nextRequestNumber() {
  const r = db.prepare("SELECT COALESCE(MAX(number),1023) AS n FROM requests").get();
  return r.n + 1;
}
var path, db, uid = () => randomUUID(), now = () => new Date().toISOString(), j = (v, d = []) => {
  try {
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};
var init_db = __esm(() => {
  init_config();
  path = resolve2(config.databasePath);
  mkdirSync(dirname2(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
CREATE TABLE IF NOT EXISTS wilayas (
  code INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, name_fr TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS communes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, wilaya_code INTEGER NOT NULL REFERENCES wilayas(code),
  name_ar TEXT NOT NULL, name_fr TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_communes_wilaya ON communes(wilaya_code);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE, phone TEXT UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','provider','admin')),
  wilaya_code INTEGER, commune_id INTEGER,
  rating_avg REAL DEFAULT 0, rating_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  locale TEXT DEFAULT 'ar-DZ',
  fcm_token TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  business_name TEXT NOT NULL,
  activity TEXT, description TEXT,
  phone TEXT,
  wilaya_code INTEGER, commune_id INTEGER,
  category_slugs TEXT DEFAULT '[]',
  working_hours TEXT DEFAULT '',
  logo_url TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  verified INTEGER NOT NULL DEFAULT 0,
  rating_avg REAL DEFAULT 0, rating_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY, name_ar TEXT NOT NULL, name_fr TEXT NOT NULL, name_en TEXT NOT NULL,
  icon TEXT, kind TEXT DEFAULT 'both', sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id),
  category_slug TEXT, title TEXT NOT NULL, description TEXT,
  price INTEGER NOT NULL, condition TEXT DEFAULT 'new', brand TEXT, attributes TEXT DEFAULT '{}',
  images TEXT DEFAULT '[]', wilaya_code INTEGER, commune_id INTEGER,
  active INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id),
  category_slug TEXT, title TEXT NOT NULL, description TEXT,
  price_from INTEGER, price_to INTEGER, price_unit TEXT DEFAULT 'job',
  images TEXT DEFAULT '[]', wilaya_code INTEGER, commune_id INTEGER, covers_wilayas TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, number INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  raw_text TEXT NOT NULL,
  category TEXT, intent TEXT, product_or_service TEXT, kind TEXT DEFAULT 'product',
  location_wilaya INTEGER, location_commune INTEGER, location_text TEXT,
  budget_min INTEGER, budget_max INTEGER, condition TEXT,
  requirements TEXT DEFAULT '[]', missing_information TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN
    ('NEW','SEARCHING','OFFERS_FOUND','COMPARING','USER_SELECTED','IN_PROGRESS','COMPLETED','CANCELLED')),
  search_step TEXT DEFAULT 'idle',           -- idle | analyzing | searching | comparing | verifying | done
  ai_summary TEXT, ai_recommendation TEXT, ai_failed INTEGER DEFAULT 0,
  suspicious INTEGER DEFAULT 0, suspicious_reason TEXT,
  selected_offer_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id),
  provider_id TEXT NOT NULL REFERENCES providers(id),
  source TEXT NOT NULL DEFAULT 'provider' CHECK (source IN ('provider','auto')),   -- auto = matched from catalog
  product_id TEXT, service_id TEXT,
  title TEXT NOT NULL, description TEXT, image_url TEXT,
  price INTEGER NOT NULL, delivery_price INTEGER DEFAULT 0, estimated_time TEXT,
  condition TEXT, location_wilaya INTEGER, location_commune INTEGER,
  match_score REAL DEFAULT 0, match_reasons TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','selected','rejected','withdrawn')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_request ON offers(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_per_provider ON offers(request_id, provider_id, COALESCE(product_id,''), COALESCE(service_id,''));

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id),
  offer_id TEXT NOT NULL REFERENCES offers(id),
  user_id TEXT NOT NULL, provider_id TEXT NOT NULL,
  item_price INTEGER NOT NULL, fee INTEGER NOT NULL, delivery_price INTEGER NOT NULL, total INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_order ON orders(request_id) WHERE status IN ('PENDING','IN_PROGRESS','COMPLETED');

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  provider_id TEXT NOT NULL, amount INTEGER NOT NULL, fee INTEGER NOT NULL,
  provider_net INTEGER NOT NULL, method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','refunded')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id),
  provider_id TEXT NOT NULL REFERENCES providers(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','offer')),
  body TEXT, image_url TEXT, offer_id TEXT,
  read_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(request_id, provider_id, created_at);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  author_id TEXT NOT NULL, target_user_id TEXT NOT NULL, target_provider_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('user_to_provider','provider_to_user')),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), comment TEXT,
  hidden INTEGER DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE(order_id, direction)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  read_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL, provider_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider_id)
);

CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT, provider_id TEXT,
  subject TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  admin_note TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, event TEXT, user_id TEXT, meta TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
`);
});

// server/lib/security.js
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
function verifyPassword(password, stored) {
  const [alg, saltHex, keyHex] = String(stored).split("$");
  if (alg !== "scrypt")
    return false;
  const key = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
function signToken(payload, ttlSeconds = 60 * 60 * 24 * 14) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64(JSON.stringify(body))}`;
  const sig = createHmac("sha256", config.authSecret).update(data).digest("base64url");
  return `${data}.${sig}`;
}
function verifyToken(token) {
  try {
    const [h, p, s] = String(token).split(".");
    const expected = createHmac("sha256", config.authSecret).update(`${h}.${p}`).digest();
    const given = Buffer.from(s, "base64url");
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000))
      return null;
    return payload;
  } catch {
    return null;
  }
}
function rateLimit(bucket, limit, windowSec) {
  const window = Math.floor(Date.now() / 1000 / windowSec);
  db.prepare(`INSERT INTO rate_limits(bucket,window_start,count) VALUES(?,?,1)
              ON CONFLICT(bucket,window_start) DO UPDATE SET count=count+1`).run(bucket, window);
  const { count } = db.prepare("SELECT count FROM rate_limits WHERE bucket=? AND window_start=?").get(bucket, window);
  if (Math.random() < 0.01)
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(window - 5);
  return count <= limit;
}
function str(v, { min = 0, max = 2000, field = "field" } = {}) {
  if (typeof v !== "string")
    throw bad(`${field} must be text`, "invalid_input");
  const s = v.trim();
  if (s.length < min)
    throw bad(`${field} is too short`, "invalid_input");
  if (s.length > max)
    throw bad(`${field} is too long`, "invalid_input");
  return s;
}
function int(v, { min = -Infinity, max = Infinity, field = "field", optional = false } = {}) {
  if ((v === null || v === undefined || v === "") && optional)
    return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n))
    throw bad(`${field} must be an integer`, "invalid_input");
  if (n < min || n > max)
    throw bad(`${field} out of range`, "invalid_input");
  return n;
}
function oneOf(v, list, field = "field") {
  if (!list.includes(v))
    throw bad(`${field} invalid`, "invalid_input");
  return v;
}
function normalizePhone(v) {
  if (!v)
    return null;
  let p = String(v).replace(/[\s.\-()]/g, "");
  p = p.replace(/^(\+213|00213)/, "0");
  if (!/^0[567]\d{8}$/.test(p))
    throw bad("invalid Algerian mobile number", "invalid_phone");
  return p;
}
function normalizeEmail(v) {
  if (!v)
    return null;
  const e = String(v).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 120)
    throw bad("invalid email", "invalid_email");
  return e;
}
function looksSpammy(text) {
  return SPAM_PATTERNS.some((r) => r.test(text || ""));
}
var b64 = (b) => Buffer.from(b).toString("base64url"), HttpError, bad = (m, code) => new HttpError(400, m, code), SPAM_PATTERNS;
var init_security = __esm(() => {
  init_config();
  init_db();
  HttpError = class HttpError extends Error {
    constructor(status, message, code) {
      super(message);
      this.status = status;
      this.code = code;
    }
  };
  SPAM_PATTERNS = [/https?:\/\//i, /(.)\1{9,}/, /(\b\w+\b)(\s+\1){4,}/i, /\b(whatsapp|viber|telegram)\b.*\d{8,}/i];
});

// scripts/seed-demo.js
function seedDemo() {
  if (db.prepare("SELECT 1 FROM users WHERE email='demo.user@blashaqa.dz'").get()) {
    console.log("Demo data already present.");
    return;
  }
  const pw = hashPassword(DEMO_PASSWORD);
  const mkUser = (name, email, phone, role, wilaya, commune) => {
    const id = uid();
    db.prepare("INSERT INTO users(id,email,phone,name,password_hash,role,wilaya_code,commune_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, email, phone, name, pw, role, wid(wilaya), cid(wilaya, commune), now(), now());
    return id;
  };
  mkUser("مستخدم تجريبي", "demo.user@blashaqa.dz", "0550000001", "user", "Médéa", "Médéa");
  const providers = [
    ["متجر الأمين للهواتف", "demo.amine@blashaqa.dz", "0550000010", "Médéa", "Médéa", "بيع الهواتف", ["electronics"], "approved", 1, 4.8, 23],
    ["TechZone Alger", "demo.techzone@blashaqa.dz", "0550000011", "Alger", "Bab Ezzouar", "هواتف وإلكترونيات", ["electronics"], "approved", 1, 4.6, 41],
    ["سمير موبايل", "demo.samir@blashaqa.dz", "0550000012", "Médéa", "Berrouaghia", "هواتف مستعملة", ["electronics"], "approved", 0, 4.2, 6],
    ["كهرباء البخاري - يوسف", "demo.youcef@blashaqa.dz", "0550000013", "Ksar El Boukhari", "Ksar El Boukhari", "كهربائي منازل", ["repair-services"], "approved", 1, 4.9, 31],
    ["أثاث الأوراس", "demo.aures@blashaqa.dz", "0550000014", "Alger", "El Harrach", "بيع الأثاث", ["furniture"], "approved", 1, 4.5, 18],
    ["Pièces Auto Médéa", "demo.auto@blashaqa.dz", "0550000015", "Médéa", "Médéa", "قطع غيار السيارات", ["cars"], "approved", 1, 4.4, 12],
    ["استوديو لمسة", "demo.logo@blashaqa.dz", "0550000016", "Blida", "Blida", "تصميم شعارات", ["digital-services"], "approved", 1, 4.7, 27],
    ["نقل الأثاث السريع", "demo.move@blashaqa.dz", "0550000017", "Médéa", "Médéa", "نقل أثاث", ["repair-services"], "approved", 0, 0, 0],
    ["مقاولة الأمل", "demo.build@blashaqa.dz", "0550000018", "Médéa", "Berrouaghia", "مقاولة بناء", ["real-estate"], "pending", 0, 0, 0]
  ];
  const P = {};
  for (const [name, email, phone, w, c, activity, cats, approval, verified, rating, count] of providers) {
    const userId = mkUser(name, email, phone, "provider", w, c);
    const id = uid();
    db.prepare(`INSERT INTO providers(id,user_id,business_name,activity,description,phone,wilaya_code,commune_id,category_slugs,working_hours,approval_status,verified,rating_avg,rating_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, name, activity, `${activity} — بيانات تجريبية`, phone, wid(w), cid(w, c), JSON.stringify(cats), "السبت–الخميس 09:00–18:00", approval, verified, rating, count, now(), now());
    P[email] = { id, w: wid(w), c: cid(w, c) };
  }
  const prod = (email, cat, title, price, condition, brand, desc = "") => {
    const p = P[email];
    db.prepare(`INSERT INTO products(id,provider_id,category_slug,title,description,price,condition,brand,wilaya_code,commune_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid(), p.id, cat, title, desc, price, condition, brand, p.w, p.c, now(), now());
  };
  prod("demo.amine@blashaqa.dz", "electronics", "Samsung Galaxy S24 128GB", 85000, "used_good", "Samsung", "مستعمل، بطارية ممتازة مع العلبة");
  prod("demo.amine@blashaqa.dz", "electronics", "Samsung Galaxy S24 256GB", 98000, "new", "Samsung", "جديد بالضمان");
  prod("demo.techzone@blashaqa.dz", "electronics", "Samsung Galaxy S24", 88000, "used_excellent", "Samsung", "مستعمل شهرين، ضمان 3 أشهر");
  prod("demo.techzone@blashaqa.dz", "electronics", "iPhone 15 128GB", 118000, "used_excellent", "Apple", "حالة ممتازة، بطارية 94%");
  prod("demo.techzone@blashaqa.dz", "electronics", "iPhone 15 128GB جديد", 152000, "new", "Apple", "جديد بالعلبة");
  prod("demo.samir@blashaqa.dz", "electronics", "Samsung Galaxy S24", 82000, "used_good", "Samsung", "مستعمل، خدوش خفيفة");
  prod("demo.samir@blashaqa.dz", "electronics", "iPhone 15", 96000, "used_good", "Apple", "مستعمل");
  prod("demo.aures@blashaqa.dz", "furniture", "كنبة ثلاثية مقاعد قماش", 42000, "new", "", "كنبة 3 مقاعد بألوان متعددة");
  prod("demo.aures@blashaqa.dz", "furniture", "كنبة زاوية جلد", 78000, "new", "", "كنبة زاوية");
  prod("demo.auto@blashaqa.dz", "cars", "قطعة غيار Clio 4 — فلتر زيت", 1800, "new", "Renault", "متوافق مع Clio 4");
  prod("demo.auto@blashaqa.dz", "cars", "قطع غيار Clio 4 — أقراص فرامل أمامية", 9500, "new", "Renault", "طقم أقراص Clio 4");
  const svc = (email, cat, title, from, to, unit, covers = []) => {
    const p = P[email];
    db.prepare(`INSERT INTO services(id,provider_id,category_slug,title,description,price_from,price_to,price_unit,wilaya_code,commune_id,covers_wilayas,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid(), p.id, cat, title, `${title} — خدمة تجريبية`, from, to, unit, p.w, p.c, JSON.stringify(covers), now(), now());
  };
  svc("demo.youcef@blashaqa.dz", "repair-services", "كهربائي منازل — إصلاح الأعطال", 1500, 6000, "job", [wid("Médéa")]);
  svc("demo.logo@blashaqa.dz", "digital-services", "تصميم Logo احترافي", 6000, 15000, "job");
  svc("demo.move@blashaqa.dz", "repair-services", "نقل أثاث بين الولايات", 12000, 30000, "job", [wid("Alger"), wid("Blida")]);
  console.log(`Demo data created. All demo accounts use password: ${DEMO_PASSWORD}`);
}
var DEMO_PASSWORD = "Demo12345", wid = (fr) => db.prepare("SELECT code FROM wilayas WHERE name_fr=?").get(fr)?.code, cid = (wfr, cfr) => db.prepare("SELECT c.id FROM communes c JOIN wilayas w ON w.code=c.wilaya_code WHERE w.name_fr=? AND c.name_fr=?").get(wfr, cfr)?.id ?? null;
var init_seed_demo = __esm(() => {
  init_db();
  init_security();
});

// server/http.js
init_config();
init_db();
init_security();
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize as pnormalize, resolve as resolve3, sep } from "node:path";

// server/embedded.js
var EMBEDDED = {
  "sw.js": { path: "sw.js", buf: Buffer.from("Ly8gTWluaW1hbCBzZXJ2aWNlIHdvcmtlcjogbWFrZXMgdGhlIGFwcCBpbnN0YWxsYWJsZSBhbmQgc2hvd3MgYSBmcmllbmRseSBwYWdlIHdoZW4gb2ZmbGluZS4gQVBJIGNhbGxzIGFyZSBuZXZlciBjYWNoZWQuCmNvbnN0IENBQ0hFID0gJ2JzLXNoZWxsLXYxJzsKc2VsZi5hZGRFdmVudExpc3RlbmVyKCdpbnN0YWxsJywgKGUpID0+IHsgZS53YWl0VW50aWwoY2FjaGVzLm9wZW4oQ0FDSEUpLnRoZW4oKGMpID0+IGMuYWRkQWxsKFsnLycsICcvY3NzL2FwcC5jc3MnLCAnL2ljb24uc3ZnJ10pKS50aGVuKCgpID0+IHNlbGYuc2tpcFdhaXRpbmcoKSkpOyB9KTsKc2VsZi5hZGRFdmVudExpc3RlbmVyKCdhY3RpdmF0ZScsIChlKSA9PiB7IGUud2FpdFVudGlsKGNhY2hlcy5rZXlzKCkudGhlbigoa3MpID0+IFByb21pc2UuYWxsKGtzLmZpbHRlcigoaykgPT4gayAhPT0gQ0FDSEUpLm1hcCgoaykgPT4gY2FjaGVzLmRlbGV0ZShrKSkpKS50aGVuKCgpID0+IHNlbGYuY2xpZW50cy5jbGFpbSgpKSk7IH0pOwpzZWxmLmFkZEV2ZW50TGlzdGVuZXIoJ2ZldGNoJywgKGUpID0+IHsKICBjb25zdCB1ID0gbmV3IFVSTChlLnJlcXVlc3QudXJsKTsKICBpZiAoZS5yZXF1ZXN0Lm1ldGhvZCAhPT0gJ0dFVCcgfHwgdS5vcmlnaW4gIT09IGxvY2F0aW9uLm9yaWdpbiB8fCB1LnBhdGhuYW1lLnN0YXJ0c1dpdGgoJy9hcGkvJykgfHwgdS5wYXRobmFtZS5zdGFydHNXaXRoKCcvdXBsb2Fkcy8nKSkgcmV0dXJuOwogIGUucmVzcG9uZFdpdGgoZmV0Y2goZS5yZXF1ZXN0KS50aGVuKChyKSA9PiB7IGlmIChyLm9rKSB7IGNvbnN0IGNvcHkgPSByLmNsb25lKCk7IGNhY2hlcy5vcGVuKENBQ0hFKS50aGVuKChjKSA9PiBjLnB1dChlLnJlcXVlc3QsIGNvcHkpKTsgfSByZXR1cm4gcjsgfSkuY2F0Y2goKCkgPT4gY2FjaGVzLm1hdGNoKGUucmVxdWVzdCkudGhlbigobSkgPT4gbSB8fCBjYWNoZXMubWF0Y2goJy8nKSkpKTsKfSk7Cg==", "base64") },
  "index.html": { path: "index.html", buf: Buffer.from("PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImFyIiBkaXI9InJ0bCI+CjxoZWFkPgogIDxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KICA8bWV0YSBuYW1lPSJ2aWV3cG9ydCIgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFsLXNjYWxlPTEsIHZpZXdwb3J0LWZpdD1jb3ZlciI+CiAgPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMwQjBCMEIiPgogIDx0aXRsZT7YqNmE2Kcg2LTZgtmJIOKAlCDZgtmI2YQg2YjYp9i0INiq2K3Yqtin2KzYjCDZiNiu2YTZitmH2Kcg2LnZhNmK2YbYpzwvdGl0bGU+CiAgPG1ldGEgbmFtZT0iZGVzY3JpcHRpb24iIGNvbnRlbnQ9Itio2YTYpyDYtNmC2Yk6INmC2YjZhCDZiNin2LQg2KrYrdiq2KfYrNiMINmI2K7ZhNmK2YfYpyDYudmE2YrZhtinLiDZhdmG2LXYqSDYsNmD2YrYqSDZgdmKINin2YTYrNiy2KfYptixINiq2KjYrdirINi52YbZgyDZiNiq2YLYp9ix2YYg2KfZhNi52LHZiNi2LiI+CiAgPGxpbmsgcmVsPSJpY29uIiBocmVmPSIvaWNvbi5zdmciIHR5cGU9ImltYWdlL3N2Zyt4bWwiPgogIDxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb25zL2ljb24tMTkyLnBuZyI+CiAgPGxpbmsgcmVsPSJtYW5pZmVzdCIgaHJlZj0iL21hbmlmZXN0LndlYm1hbmlmZXN0Ij4KICA8bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9Ii9jc3MvYXBwLmNzcyI+CjwvaGVhZD4KPGJvZHk+CiAgPGRpdiBpZD0iYXBwIj48L2Rpdj4KICA8ZGl2IGlkPSJ0b2FzdHMiIGFyaWEtbGl2ZT0icG9saXRlIj48L2Rpdj4KICA8c2NyaXB0IHR5cGU9Im1vZHVsZSIgc3JjPSIvanMvYXBwLmpzIj48L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==", "base64") },
  "icons/maskable-512.png": { path: "icons/maskable-512.png", buf: Buffer.from("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", "base64") },
  "icons/icon-192.png": { path: "icons/icon-192.png", buf: Buffer.from("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", "base64") },
  "icons/icon-512.png": { path: "icons/icon-512.png", buf: Buffer.from("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", "base64") },
  "css/app.css": { path: "css/app.css", buf: Buffer.from("OnJvb3QgewogIC0tZ29sZDogI2YyYjcwNTsgLS1nb2xkLTYwMDogI2Q5OWUwMDsgLS1nb2xkLTEwMDogI2ZmZjRjYzsgLS1nb2xkLTUwOiAjZmZmYWVhOwogIC0tZ3JlZW46ICMwZTNiMmM7IC0tZ3JlZW4tNzAwOiAjMGEyYzIxOyAtLWdyZWVuLTEwMDogI2RjZWZlNjsKICAtLWJsYWNrOiAjMGIwYjBiOyAtLWluazogIzE3MTcxNzsgLS1tdXRlZDogIzZiNmI2NjsgLS1iZzogI2ZhZjhmMzsgLS1jYXJkOiAjZmZmOyAtLWxpbmU6ICNlY2U3ZGE7CiAgLS1kYW5nZXI6ICNjMDM5MmI7IC0tb2s6ICMxZThhNWE7IC0td2FybjogI2I5NzcwZTsKICAtLXI6IDE4cHg7IC0tci1zbTogMTJweDsgLS1zaGFkb3c6IDAgNnB4IDI0cHggcmdiYSgxMSwgMTEsIDExLCAuMDcpOyAtLXNoYWRvdy1sZzogMCAxOHB4IDUwcHggcmdiYSgxMSwgMTEsIDExLCAuMTgpOwogIC0tZm9udDogIlNlZ29lIFVJIiwgIk5vdG8gTmFza2ggQXJhYmljIiwgIk5vdG8gU2FucyBBcmFiaWMiLCBUYWhvbWEsIHN5c3RlbS11aSwgLWFwcGxlLXN5c3RlbSwgIkhlbHZldGljYSBOZXVlIiwgQXJpYWwsIHNhbnMtc2VyaWY7Cn0KKiB7IGJveC1zaXppbmc6IGJvcmRlci1ib3g7IC13ZWJraXQtdGFwLWhpZ2hsaWdodC1jb2xvcjogdHJhbnNwYXJlbnQ7IH0KaHRtbCwgYm9keSB7IG1hcmdpbjogMDsgcGFkZGluZzogMDsgfQpib2R5IHsgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQpOyBiYWNrZ3JvdW5kOiB2YXIoLS1iZyk7IGNvbG9yOiB2YXIoLS1pbmspOyBsaW5lLWhlaWdodDogMS41NTsgZm9udC1zaXplOiAxNnB4OyBtaW4taGVpZ2h0OiAxMDB2aDsgfQpidXR0b24sIGlucHV0LCBzZWxlY3QsIHRleHRhcmVhIHsgZm9udDogaW5oZXJpdDsgY29sb3I6IGluaGVyaXQ7IH0KYSB7IGNvbG9yOiBpbmhlcml0OyB0ZXh0LWRlY29yYXRpb246IG5vbmU7IH0KaDEsIGgyLCBoMywgaDQgeyBtYXJnaW46IDA7IGxpbmUtaGVpZ2h0OiAxLjI1OyB9Ci5oaWRkZW4geyBkaXNwbGF5OiBub25lICFpbXBvcnRhbnQ7IH0KCi8qIC0tLS0tLS0tLS0gc2hlbGwgLS0tLS0tLS0tLSAqLwojYXBwIHsgbWluLWhlaWdodDogMTAwdmg7IGRpc3BsYXk6IGZsZXg7IGp1c3RpZnktY29udGVudDogY2VudGVyOyB9Ci5zaGVsbCB7IHdpZHRoOiAxMDAlOyBtYXgtd2lkdGg6IDUyMHB4OyBtaW4taGVpZ2h0OiAxMDB2aDsgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgYmFja2dyb3VuZDogdmFyKC0tYmcpOyBwb3NpdGlvbjogcmVsYXRpdmU7IH0KLnNoZWxsLndpZGUgeyBtYXgtd2lkdGg6IDExMjBweDsgfQpAbWVkaWEgKG1pbi13aWR0aDogNTYwcHgpIHsgLnNoZWxsOm5vdCgud2lkZSk6bm90KC5iYXJlKSB7IGJveC1zaGFkb3c6IDAgMCAwIDFweCB2YXIoLS1saW5lKSwgdmFyKC0tc2hhZG93LWxnKTsgfSB9Ci52aWV3IHsgZmxleDogMTsgcGFkZGluZzogMTZweCAxNnB4IDk2cHg7IH0KLnZpZXcuZmx1c2ggeyBwYWRkaW5nOiAwIDAgOTZweDsgfQoudG9wYmFyIHsgcG9zaXRpb246IHN0aWNreTsgdG9wOiAwOyB6LWluZGV4OiAyMDsgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiAxMHB4OyBwYWRkaW5nOiAxMnB4IDE2cHg7IGJhY2tncm91bmQ6IHJnYmEoMjUwLCAyNDgsIDI0MywgLjkyKTsgYmFja2Ryb3AtZmlsdGVyOiBibHVyKDEwcHgpOyBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tbGluZSk7IH0KLnRvcGJhciBoMSB7IGZvbnQtc2l6ZTogMThweDsgZmxleDogMTsgfQouaWNvbmJ0biB7IHdpZHRoOiA0MHB4OyBoZWlnaHQ6IDQwcHg7IGJvcmRlci1yYWRpdXM6IDEycHg7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWxpbmUpOyBiYWNrZ3JvdW5kOiB2YXIoLS1jYXJkKTsgZGlzcGxheTogZ3JpZDsgcGxhY2UtaXRlbXM6IGNlbnRlcjsgY3Vyc29yOiBwb2ludGVyOyBmb250LXNpemU6IDE4cHg7IHBvc2l0aW9uOiByZWxhdGl2ZTsgfQouaWNvbmJ0biAuZG90IHsgcG9zaXRpb246IGFic29sdXRlOyB0b3A6IC01cHg7IGluc2V0LWlubGluZS1lbmQ6IC01cHg7IG1pbi13aWR0aDogMThweDsgaGVpZ2h0OiAxOHB4OyBwYWRkaW5nOiAwIDVweDsgYm9yZGVyLXJhZGl1czogOXB4OyBiYWNrZ3JvdW5kOiB2YXIoLS1kYW5nZXIpOyBjb2xvcjogI2ZmZjsgZm9udC1zaXplOiAxMXB4OyBkaXNwbGF5OiBncmlkOyBwbGFjZS1pdGVtczogY2VudGVyOyBmb250LXdlaWdodDogNzAwOyB9CgovKiBib3R0b20gdGFiIGJhciAqLwoudGFiYmFyIHsgcG9zaXRpb246IGZpeGVkOyBib3R0b206IDA7IGluc2V0LWlubGluZTogMDsgei1pbmRleDogMzA7IGRpc3BsYXk6IGZsZXg7IGp1c3RpZnktY29udGVudDogY2VudGVyOyBwb2ludGVyLWV2ZW50czogbm9uZTsgfQoudGFiYmFyID4gZGl2IHsgd2lkdGg6IDEwMCU7IG1heC13aWR0aDogNTIwcHg7IGRpc3BsYXk6IGZsZXg7IGJhY2tncm91bmQ6IHZhcigtLWJsYWNrKTsgcGFkZGluZzogOHB4IDhweCBjYWxjKDhweCArIGVudihzYWZlLWFyZWEtaW5zZXQtYm90dG9tKSk7IGJvcmRlci1yYWRpdXM6IDIycHggMjJweCAwIDA7IHBvaW50ZXItZXZlbnRzOiBhdXRvOyB9Ci50YWJiYXIgYSB7IGZsZXg6IDE7IHRleHQtYWxpZ246IGNlbnRlcjsgY29sb3I6ICNiOGIyYTA7IGZvbnQtc2l6ZTogMTFweDsgcGFkZGluZzogNnB4IDA7IGJvcmRlci1yYWRpdXM6IDE0cHg7IHBvc2l0aW9uOiByZWxhdGl2ZTsgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgZ2FwOiAycHg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IH0KLnRhYmJhciBhIC5pYyB7IGZvbnQtc2l6ZTogMjBweDsgbGluZS1oZWlnaHQ6IDE7IH0KLnRhYmJhciBhLm9uIHsgY29sb3I6IHZhcigtLWdvbGQpOyB9Ci50YWJiYXIgYSAuZG90IHsgcG9zaXRpb246IGFic29sdXRlOyB0b3A6IDA7IGluc2V0LWlubGluZS1zdGFydDogNTUlOyBiYWNrZ3JvdW5kOiB2YXIoLS1kYW5nZXIpOyBjb2xvcjogI2ZmZjsgYm9yZGVyLXJhZGl1czogOXB4OyBtaW4td2lkdGg6IDE2cHg7IGhlaWdodDogMTZweDsgZm9udC1zaXplOiAxMHB4OyBkaXNwbGF5OiBncmlkOyBwbGFjZS1pdGVtczogY2VudGVyOyBwYWRkaW5nOiAwIDRweDsgfQoKLyogLS0tLS0tLS0tLSBlbGVtZW50cyAtLS0tLS0tLS0tICovCi5jYXJkIHsgYmFja2dyb3VuZDogdmFyKC0tY2FyZCk7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWxpbmUpOyBib3JkZXItcmFkaXVzOiB2YXIoLS1yKTsgcGFkZGluZzogMTZweDsgYm94LXNoYWRvdzogdmFyKC0tc2hhZG93KTsgfQouY2FyZCArIC5jYXJkLCAuc3RhY2sgPiAqICsgKiB7IG1hcmdpbi10b3A6IDEycHg7IH0KLnJvdyB7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogMTBweDsgfQoucm93LnNwIHsganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuOyB9Ci5yb3cud3JhcCB7IGZsZXgtd3JhcDogd3JhcDsgfQouY29sIHsgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgZ2FwOiA4cHg7IH0KLmdyb3cgeyBmbGV4OiAxOyBtaW4td2lkdGg6IDA7IH0KLm11dGVkIHsgY29sb3I6IHZhcigtLW11dGVkKTsgfQouc21hbGwgeyBmb250LXNpemU6IDEzcHg7IH0KLnRpbnkgeyBmb250LXNpemU6IDEycHg7IH0KLmIgeyBmb250LXdlaWdodDogNzAwOyB9Ci5jZW50ZXIgeyB0ZXh0LWFsaWduOiBjZW50ZXI7IH0KLmx0ciB7IGRpcmVjdGlvbjogbHRyOyB1bmljb2RlLWJpZGk6IGVtYmVkOyBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7IH0KLm10IHsgbWFyZ2luLXRvcDogMTJweDsgfSAubXQyIHsgbWFyZ2luLXRvcDogMjBweDsgfSAubWIgeyBtYXJnaW4tYm90dG9tOiAxMnB4OyB9Ci5kaXZpZGVyIHsgaGVpZ2h0OiAxcHg7IGJhY2tncm91bmQ6IHZhcigtLWxpbmUpOyBtYXJnaW46IDEycHggMDsgfQoKLmJ0biB7IGRpc3BsYXk6IGlubGluZS1mbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgZ2FwOiA4cHg7IG1pbi1oZWlnaHQ6IDQ4cHg7IHBhZGRpbmc6IDAgMjBweDsgYm9yZGVyOiAwOyBib3JkZXItcmFkaXVzOiAxNHB4OyBiYWNrZ3JvdW5kOiB2YXIoLS1nb2xkKTsgY29sb3I6IHZhcigtLWJsYWNrKTsgZm9udC13ZWlnaHQ6IDgwMDsgY3Vyc29yOiBwb2ludGVyOyB0cmFuc2l0aW9uOiB0cmFuc2Zvcm0gLjA4cywgYmFja2dyb3VuZCAuMTVzLCBvcGFjaXR5IC4xNXM7IHRleHQtYWxpZ246IGNlbnRlcjsgfQouYnRuOmhvdmVyIHsgYmFja2dyb3VuZDogdmFyKC0tZ29sZC02MDApOyB9Ci5idG46YWN0aXZlIHsgdHJhbnNmb3JtOiBzY2FsZSguOTgpOyB9Ci5idG5bZGlzYWJsZWRdIHsgb3BhY2l0eTogLjU1OyBjdXJzb3I6IG5vdC1hbGxvd2VkOyB9Ci5idG4uYmxvY2sgeyB3aWR0aDogMTAwJTsgfQouYnRuLmRhcmsgeyBiYWNrZ3JvdW5kOiB2YXIoLS1ibGFjayk7IGNvbG9yOiB2YXIoLS1nb2xkKTsgfQouYnRuLmdyZWVuIHsgYmFja2dyb3VuZDogdmFyKC0tZ3JlZW4pOyBjb2xvcjogI2ZmZjsgfQouYnRuLmdob3N0IHsgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7IGJvcmRlcjogMS41cHggc29saWQgdmFyKC0tbGluZSk7IGNvbG9yOiB2YXIoLS1pbmspOyB9Ci5idG4uZ2hvc3Q6aG92ZXIgeyBiYWNrZ3JvdW5kOiB2YXIoLS1nb2xkLTUwKTsgfQouYnRuLmRhbmdlciB7IGJhY2tncm91bmQ6ICNmZGVjZWE7IGNvbG9yOiB2YXIoLS1kYW5nZXIpOyB9Ci5idG4uc20geyBtaW4taGVpZ2h0OiAzOHB4OyBwYWRkaW5nOiAwIDE0cHg7IGZvbnQtc2l6ZTogMTRweDsgYm9yZGVyLXJhZGl1czogMTJweDsgfQoubGlua2J0biB7IGJhY2tncm91bmQ6IG5vbmU7IGJvcmRlcjogMDsgY29sb3I6IHZhcigtLWdyZWVuKTsgZm9udC13ZWlnaHQ6IDcwMDsgY3Vyc29yOiBwb2ludGVyOyBwYWRkaW5nOiA2cHg7IH0KCi5maWVsZCB7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGdhcDogNnB4OyBtYXJnaW4tYm90dG9tOiAxMnB4OyB9Ci5maWVsZCBsYWJlbCB7IGZvbnQtc2l6ZTogMTRweDsgZm9udC13ZWlnaHQ6IDcwMDsgfQouaW5wdXQsIHNlbGVjdC5pbnB1dCwgdGV4dGFyZWEuaW5wdXQgeyB3aWR0aDogMTAwJTsgbWluLWhlaWdodDogNDhweDsgcGFkZGluZzogMTBweCAxNHB4OyBib3JkZXItcmFkaXVzOiAxNHB4OyBib3JkZXI6IDEuNXB4IHNvbGlkIHZhcigtLWxpbmUpOyBiYWNrZ3JvdW5kOiAjZmZmOyBvdXRsaW5lOiBub25lOyB0cmFuc2l0aW9uOiBib3JkZXItY29sb3IgLjE1cywgYm94LXNoYWRvdyAuMTVzOyB9Ci5pbnB1dDpmb2N1cyB7IGJvcmRlci1jb2xvcjogdmFyKC0tZ29sZCk7IGJveC1zaGFkb3c6IDAgMCAwIDRweCByZ2JhKDI0MiwgMTgzLCA1LCAuMjIpOyB9CnRleHRhcmVhLmlucHV0IHsgbWluLWhlaWdodDogOTZweDsgcmVzaXplOiB2ZXJ0aWNhbDsgfQouZXJyIHsgY29sb3I6IHZhcigtLWRhbmdlcik7IGZvbnQtc2l6ZTogMTNweDsgbWFyZ2luLXRvcDogNHB4OyB9CgouYmFkZ2UgeyBkaXNwbGF5OiBpbmxpbmUtZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiA0cHg7IHBhZGRpbmc6IDJweCAxMHB4OyBib3JkZXItcmFkaXVzOiA5OTlweDsgZm9udC1zaXplOiAxMnB4OyBmb250LXdlaWdodDogNzAwOyBiYWNrZ3JvdW5kOiAjZWVlOyBjb2xvcjogIzQ0NDsgd2hpdGUtc3BhY2U6IG5vd3JhcDsgfQouYmFkZ2UuZ29sZCB7IGJhY2tncm91bmQ6IHZhcigtLWdvbGQtMTAwKTsgY29sb3I6ICM3YTVhMDA7IH0KLmJhZGdlLmdyZWVuIHsgYmFja2dyb3VuZDogdmFyKC0tZ3JlZW4tMTAwKTsgY29sb3I6IHZhcigtLWdyZWVuKTsgfQouYmFkZ2UucmVkIHsgYmFja2dyb3VuZDogI2ZkZWNlYTsgY29sb3I6IHZhcigtLWRhbmdlcik7IH0KLmJhZGdlLmRhcmsgeyBiYWNrZ3JvdW5kOiB2YXIoLS1ibGFjayk7IGNvbG9yOiB2YXIoLS1nb2xkKTsgfQoudmVyaWZpZWQgeyBjb2xvcjogdmFyKC0tb2spOyBmb250LXdlaWdodDogNzAwOyBmb250LXNpemU6IDEzcHg7IH0KLnN0YXJzIHsgY29sb3I6IHZhcigtLWdvbGQtNjAwKTsgZm9udC13ZWlnaHQ6IDcwMDsgbGV0dGVyLXNwYWNpbmc6IC41cHg7IH0KCi5jaGlwcyB7IGRpc3BsYXk6IGZsZXg7IGZsZXgtd3JhcDogd3JhcDsgZ2FwOiA4cHg7IH0KLmNoaXAgeyBwYWRkaW5nOiA4cHggMTRweDsgYm9yZGVyLXJhZGl1czogOTk5cHg7IGJhY2tncm91bmQ6IHJnYmEoMjU1LCAyNTUsIDI1NSwgLjEpOyBjb2xvcjogI2YzZWZlMDsgZm9udC1zaXplOiAxNHB4OyBib3JkZXI6IDFweCBzb2xpZCByZ2JhKDI1NSwgMjU1LCAyNTUsIC4xOCk7IGN1cnNvcjogcG9pbnRlcjsgfQouY2hpcDpob3ZlciB7IGJhY2tncm91bmQ6IHJnYmEoMjQyLCAxODMsIDUsIC4yNSk7IH0KLmNoaXAubGlnaHQgeyBiYWNrZ3JvdW5kOiAjZmZmOyBjb2xvcjogdmFyKC0taW5rKTsgYm9yZGVyLWNvbG9yOiB2YXIoLS1saW5lKTsgfQouY2hpcC5vbiB7IGJhY2tncm91bmQ6IHZhcigtLWdvbGQpOyBjb2xvcjogdmFyKC0tYmxhY2spOyBib3JkZXItY29sb3I6IHZhcigtLWdvbGQpOyBmb250LXdlaWdodDogNzAwOyB9CgovKiAtLS0tLS0tLS0tIGJyYW5kIC0tLS0tLS0tLS0gKi8KLmJyYW5kIHsgZGlzcGxheTogaW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogMTBweDsgfQouYnJhbmQgc3ZnIHsgd2lkdGg6IDM4cHg7IGhlaWdodDogMzhweDsgfQouYnJhbmQgLm5hbWUgeyBmb250LXNpemU6IDI2cHg7IGZvbnQtd2VpZ2h0OiA5MDA7IGxldHRlci1zcGFjaW5nOiAtLjVweDsgfQouZ29sZC10ZXh0IHsgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDkwZGVnLCAjZmZkMzRkLCAjZjJiNzA1IDQ1JSwgI2ZmZTg5YSk7IC13ZWJraXQtYmFja2dyb3VuZC1jbGlwOiB0ZXh0OyBiYWNrZ3JvdW5kLWNsaXA6IHRleHQ7IGNvbG9yOiB0cmFuc3BhcmVudDsgfQoKLyogLS0tLS0tLS0tLSBob21lIC0tLS0tLS0tLS0gKi8KLmhlcm8geyBiYWNrZ3JvdW5kOiByYWRpYWwtZ3JhZGllbnQoMTIwJSA5MCUgYXQgMTAwJSAwJSwgIzFiNWE0MyAwJSwgdmFyKC0tZ3JlZW4pIDM4JSwgdmFyKC0tYmxhY2spIDEwMCUpOyBjb2xvcjogI2ZmZjsgcGFkZGluZzogMjJweCAxOHB4IDM0cHg7IGJvcmRlci1yYWRpdXM6IDAgMCAzMnB4IDMycHg7IHBvc2l0aW9uOiByZWxhdGl2ZTsgb3ZlcmZsb3c6IGhpZGRlbjsgfQouaGVybzo6YWZ0ZXIgeyBjb250ZW50OiAiIjsgcG9zaXRpb246IGFic29sdXRlOyB3aWR0aDogMjYwcHg7IGhlaWdodDogMjYwcHg7IGJvcmRlci1yYWRpdXM6IDUwJTsgYmFja2dyb3VuZDogcmFkaWFsLWdyYWRpZW50KGNpcmNsZSwgcmdiYSgyNDIsIDE4MywgNSwgLjI4KSwgdHJhbnNwYXJlbnQgNjUlKTsgaW5zZXQtaW5saW5lLXN0YXJ0OiAtOTBweDsgYm90dG9tOiAtMTIwcHg7IHBvaW50ZXItZXZlbnRzOiBub25lOyB9Ci5oZXJvIC50YWdsaW5lIHsgZm9udC1zaXplOiAyMnB4OyBmb250LXdlaWdodDogODAwOyBtYXJnaW46IDE4cHggMCAxNHB4OyBsaW5lLWhlaWdodDogMS4zNTsgfQouYXNrYm94IHsgYmFja2dyb3VuZDogI2ZmZjsgY29sb3I6IHZhcigtLWluayk7IGJvcmRlci1yYWRpdXM6IDIycHg7IHBhZGRpbmc6IDEycHg7IGJveC1zaGFkb3c6IHZhcigtLXNoYWRvdy1sZyk7IHBvc2l0aW9uOiByZWxhdGl2ZTsgei1pbmRleDogMTsgfQouYXNrYm94IHRleHRhcmVhIHsgd2lkdGg6IDEwMCU7IGJvcmRlcjogMDsgb3V0bGluZTogMDsgcmVzaXplOiBub25lOyBtaW4taGVpZ2h0OiA4NHB4OyBmb250LXNpemU6IDE4cHg7IGJhY2tncm91bmQ6IHRyYW5zcGFyZW50OyBwYWRkaW5nOiA2cHggOHB4OyB9Ci5hc2tib3ggLmJ0biB7IHdpZHRoOiAxMDAlOyBmb250LXNpemU6IDE3cHg7IG1pbi1oZWlnaHQ6IDUycHg7IH0KLmV4YW1wbGVzIHsgbWFyZ2luLXRvcDogMTRweDsgcG9zaXRpb246IHJlbGF0aXZlOyB6LWluZGV4OiAxOyB9Ci5jYXRzIHsgZGlzcGxheTogZ3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiByZXBlYXQoMywgMWZyKTsgZ2FwOiAxMHB4OyB9Ci5jYXQgeyBiYWNrZ3JvdW5kOiAjZmZmOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1saW5lKTsgYm9yZGVyLXJhZGl1czogMTZweDsgcGFkZGluZzogMTRweCA2cHg7IHRleHQtYWxpZ246IGNlbnRlcjsgY3Vyc29yOiBwb2ludGVyOyBmb250LXNpemU6IDEzcHg7IGZvbnQtd2VpZ2h0OiA3MDA7IHRyYW5zaXRpb246IC4xNXM7IH0KLmNhdDpob3ZlciB7IGJvcmRlci1jb2xvcjogdmFyKC0tZ29sZCk7IHRyYW5zZm9ybTogdHJhbnNsYXRlWSgtMnB4KTsgYm94LXNoYWRvdzogdmFyKC0tc2hhZG93KTsgfQouY2F0IC5lIHsgZm9udC1zaXplOiAyNnB4OyBkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogNHB4OyB9Ci5zZWN0aW9uLXRpdGxlIHsgZm9udC1zaXplOiAxN3B4OyBmb250LXdlaWdodDogODAwOyBtYXJnaW46IDIycHggMCAxMnB4OyB9Ci5ob3cgeyBkaXNwbGF5OiBncmlkOyBnYXA6IDEwcHg7IH0KLmhvdyAuc3RlcCB7IGRpc3BsYXk6IGZsZXg7IGdhcDogMTJweDsgYWxpZ24taXRlbXM6IGZsZXgtc3RhcnQ7IH0KLmhvdyAubiB7IHdpZHRoOiAzMHB4OyBoZWlnaHQ6IDMwcHg7IGJvcmRlci1yYWRpdXM6IDEwcHg7IGJhY2tncm91bmQ6IHZhcigtLWdvbGQpOyBjb2xvcjogdmFyKC0tYmxhY2spOyBkaXNwbGF5OiBncmlkOyBwbGFjZS1pdGVtczogY2VudGVyOyBmb250LXdlaWdodDogOTAwOyBmbGV4OiBub25lOyB9CgovKiAtLS0tLS0tLS0tIHVuZGVyc3RhbmRpbmcgLS0tLS0tLS0tLSAqLwoudW5kZXJzdG9vZCB7IGJvcmRlcjogMnB4IHNvbGlkIHZhcigtLWdvbGQpOyBiYWNrZ3JvdW5kOiB2YXIoLS1nb2xkLTUwKTsgfQoua3YgeyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDhweDsgcGFkZGluZzogNnB4IDA7IGZvbnQtc2l6ZTogMTZweDsgfQoua3YgLmsgeyB3aWR0aDogMjhweDsgdGV4dC1hbGlnbjogY2VudGVyOyBmb250LXNpemU6IDE4cHg7IH0KLmFpLWJ1YmJsZSB7IGJhY2tncm91bmQ6IHZhcigtLWJsYWNrKTsgY29sb3I6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDE4cHggMThweCAxOHB4IDRweDsgcGFkZGluZzogMTRweCAxNnB4OyB9CltkaXI9InJ0bCJdIC5haS1idWJibGUgeyBib3JkZXItcmFkaXVzOiAxOHB4IDE4cHggNHB4IDE4cHg7IH0KLmFpLWJ1YmJsZSAud2hvIHsgY29sb3I6IHZhcigtLWdvbGQpOyBmb250LXdlaWdodDogODAwOyBmb250LXNpemU6IDEzcHg7IG1hcmdpbi1ib3R0b206IDRweDsgfQoKLyogLS0tLS0tLS0tLSBBSSBzZWFyY2hpbmcgLS0tLS0tLS0tLSAqLwouc2VhcmNoaW5nIHsgbWluLWhlaWdodDogMTAwdmg7IGJhY2tncm91bmQ6IHJhZGlhbC1ncmFkaWVudCgxMjAlIDgwJSBhdCA1MCUgMCUsICMxNzUwM2IgMCUsIHZhcigtLWJsYWNrKSA3MCUpOyBjb2xvcjogI2ZmZjsgcGFkZGluZzogMjhweCAyMnB4IDQwcHg7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGFsaWduLWl0ZW1zOiBjZW50ZXI7IH0KLm9yYiB7IHdpZHRoOiAxMjhweDsgaGVpZ2h0OiAxMjhweDsgYm9yZGVyLXJhZGl1czogNTAlOyBtYXJnaW46IDMwcHggMCAyMnB4OyBwb3NpdGlvbjogcmVsYXRpdmU7IGRpc3BsYXk6IGdyaWQ7IHBsYWNlLWl0ZW1zOiBjZW50ZXI7IGZvbnQtc2l6ZTogNTJweDsgYmFja2dyb3VuZDogcmFkaWFsLWdyYWRpZW50KGNpcmNsZSBhdCAzNSUgMzAlLCAjZmZlMjdhLCB2YXIoLS1nb2xkKSA1NSUsICM5YTZmMDApOyBib3gtc2hhZG93OiAwIDAgMCAwIHJnYmEoMjQyLCAxODMsIDUsIC41KTsgYW5pbWF0aW9uOiBwdWxzZSAxLjhzIGluZmluaXRlOyB9Ci5vcmIuZG9uZSB7IGFuaW1hdGlvbjogbm9uZTsgYmFja2dyb3VuZDogcmFkaWFsLWdyYWRpZW50KGNpcmNsZSBhdCAzNSUgMzAlLCAjN2JlMGFlLCAjMWU4YTVhIDYwJSwgIzBlM2IyYyk7IGJveC1zaGFkb3c6IDAgMCA0MHB4IHJnYmEoMzAsIDEzOCwgOTAsIC41KTsgfQpAa2V5ZnJhbWVzIHB1bHNlIHsgMCUgeyBib3gtc2hhZG93OiAwIDAgMCAwIHJnYmEoMjQyLCAxODMsIDUsIC41KTsgfSA3MCUgeyBib3gtc2hhZG93OiAwIDAgMCAzNHB4IHJnYmEoMjQyLCAxODMsIDUsIDApOyB9IDEwMCUgeyBib3gtc2hhZG93OiAwIDAgMCAwIHJnYmEoMjQyLCAxODMsIDUsIDApOyB9IH0KLnN0ZXBzIHsgd2lkdGg6IDEwMCU7IG1heC13aWR0aDogMzgwcHg7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGdhcDogMTBweDsgbWFyZ2luLXRvcDogMTBweDsgfQouc3RwIHsgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiAxMnB4OyBwYWRkaW5nOiAxMnB4IDE0cHg7IGJvcmRlci1yYWRpdXM6IDE0cHg7IGJhY2tncm91bmQ6IHJnYmEoMjU1LCAyNTUsIDI1NSwgLjA2KTsgYm9yZGVyOiAxcHggc29saWQgcmdiYSgyNTUsIDI1NSwgMjU1LCAuMDgpOyBvcGFjaXR5OiAuNDU7IHRyYW5zaXRpb246IC4zczsgfQouc3RwIC5pYyB7IHdpZHRoOiAzNHB4OyBoZWlnaHQ6IDM0cHg7IGJvcmRlci1yYWRpdXM6IDUwJTsgZGlzcGxheTogZ3JpZDsgcGxhY2UtaXRlbXM6IGNlbnRlcjsgYmFja2dyb3VuZDogcmdiYSgyNTUsIDI1NSwgMjU1LCAuMSk7IGZvbnQtc2l6ZTogMTZweDsgZmxleDogbm9uZTsgfQouc3RwLmFjdGl2ZSB7IG9wYWNpdHk6IDE7IGJhY2tncm91bmQ6IHJnYmEoMjQyLCAxODMsIDUsIC4xNCk7IGJvcmRlci1jb2xvcjogcmdiYSgyNDIsIDE4MywgNSwgLjUpOyB9Ci5zdHAuYWN0aXZlIC5pYyB7IGJhY2tncm91bmQ6IHZhcigtLWdvbGQpOyBhbmltYXRpb246IGJvYiAxcyBpbmZpbml0ZSBhbHRlcm5hdGU7IH0KLnN0cC5kb25lIHsgb3BhY2l0eTogMTsgfQouc3RwLmRvbmUgLmljIHsgYmFja2dyb3VuZDogdmFyKC0tb2spOyB9CkBrZXlmcmFtZXMgYm9iIHsgdG8geyB0cmFuc2Zvcm06IHNjYWxlKDEuMTIpOyB9IH0KLmJhciB7IHdpZHRoOiAxMDAlOyBtYXgtd2lkdGg6IDM4MHB4OyBoZWlnaHQ6IDZweDsgYmFja2dyb3VuZDogcmdiYSgyNTUsIDI1NSwgMjU1LCAuMTIpOyBib3JkZXItcmFkaXVzOiAzcHg7IG1hcmdpbi10b3A6IDIwcHg7IG92ZXJmbG93OiBoaWRkZW47IH0KLmJhciA+IGkgeyBkaXNwbGF5OiBibG9jazsgaGVpZ2h0OiAxMDAlOyBiYWNrZ3JvdW5kOiBsaW5lYXItZ3JhZGllbnQoOTBkZWcsIHZhcigtLWdvbGQpLCAjZmZlMjdhKTsgdHJhbnNpdGlvbjogd2lkdGggLjVzOyB9CgovKiAtLS0tLS0tLS0tIG9mZmVycyAtLS0tLS0tLS0tICovCi5vZmZlciB7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGdhcDogMTBweDsgcG9zaXRpb246IHJlbGF0aXZlOyB9Ci5vZmZlci5iZXN0IHsgYm9yZGVyOiAycHggc29saWQgdmFyKC0tZ29sZCk7IH0KLm9mZmVyIC5yaWJib24geyBwb3NpdGlvbjogYWJzb2x1dGU7IHRvcDogLTExcHg7IGluc2V0LWlubGluZS1zdGFydDogMTRweDsgYmFja2dyb3VuZDogdmFyKC0tZ29sZCk7IGNvbG9yOiB2YXIoLS1ibGFjayk7IGZvbnQtc2l6ZTogMTJweDsgZm9udC13ZWlnaHQ6IDkwMDsgcGFkZGluZzogM3B4IDEycHg7IGJvcmRlci1yYWRpdXM6IDk5OXB4OyB9Ci5vZmZlciAuaW1nIHsgd2lkdGg6IDg0cHg7IGhlaWdodDogODRweDsgYm9yZGVyLXJhZGl1czogMTRweDsgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDEzNWRlZywgdmFyKC0tZ29sZC0xMDApLCB2YXIoLS1ncmVlbi0xMDApKTsgZGlzcGxheTogZ3JpZDsgcGxhY2UtaXRlbXM6IGNlbnRlcjsgZm9udC1zaXplOiAzNHB4OyBmbGV4OiBub25lOyBvdmVyZmxvdzogaGlkZGVuOyB9Ci5vZmZlciAuaW1nIGltZyB7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IG9iamVjdC1maXQ6IGNvdmVyOyB9Ci5wcmljZSB7IGZvbnQtc2l6ZTogMjJweDsgZm9udC13ZWlnaHQ6IDkwMDsgfQoucHJpY2Ugc21hbGwgeyBmb250LXNpemU6IDEzcHg7IGZvbnQtd2VpZ2h0OiA3MDA7IGNvbG9yOiB2YXIoLS1tdXRlZCk7IH0KLndhcm5ib3ggeyBiYWNrZ3JvdW5kOiAjZmZmNmU1OyBib3JkZXI6IDFweCBzb2xpZCAjZjNkY2E0OyBjb2xvcjogIzdhNTMwMDsgYm9yZGVyLXJhZGl1czogMTJweDsgcGFkZGluZzogOHB4IDEycHg7IGZvbnQtc2l6ZTogMTNweDsgfQouYnJlYWtkb3duIHsgd2lkdGg6IDEwMCU7IGJvcmRlci1jb2xsYXBzZTogY29sbGFwc2U7IGZvbnQtc2l6ZTogMTVweDsgfQouYnJlYWtkb3duIHRkIHsgcGFkZGluZzogNnB4IDA7IH0KLmJyZWFrZG93biB0ZDpsYXN0LWNoaWxkIHsgdGV4dC1hbGlnbjogZW5kOyBmb250LXdlaWdodDogNzAwOyB9Ci5icmVha2Rvd24gdHIudG90YWwgdGQgeyBib3JkZXItdG9wOiAycHggc29saWQgdmFyKC0tYmxhY2spOyBmb250LXNpemU6IDE4cHg7IGZvbnQtd2VpZ2h0OiA5MDA7IHBhZGRpbmctdG9wOiAxMHB4OyB9Ci5jbXAtd3JhcCB7IG92ZXJmbG93LXg6IGF1dG87IGJvcmRlci1yYWRpdXM6IHZhcigtLXIpOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1saW5lKTsgYmFja2dyb3VuZDogI2ZmZjsgfQp0YWJsZS5jbXAgeyB3aWR0aDogMTAwJTsgYm9yZGVyLWNvbGxhcHNlOiBjb2xsYXBzZTsgbWluLXdpZHRoOiA1MjBweDsgfQp0YWJsZS5jbXAgdGgsIHRhYmxlLmNtcCB0ZCB7IHBhZGRpbmc6IDEycHggMTBweDsgdGV4dC1hbGlnbjogY2VudGVyOyBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tbGluZSk7IGZvbnQtc2l6ZTogMTRweDsgdmVydGljYWwtYWxpZ246IG1pZGRsZTsgfQp0YWJsZS5jbXAgdGg6Zmlyc3QtY2hpbGQsIHRhYmxlLmNtcCB0ZDpmaXJzdC1jaGlsZCB7IHRleHQtYWxpZ246IHN0YXJ0OyBmb250LXdlaWdodDogODAwOyBiYWNrZ3JvdW5kOiB2YXIoLS1nb2xkLTUwKTsgcG9zaXRpb246IHN0aWNreTsgaW5zZXQtaW5saW5lLXN0YXJ0OiAwOyB9CnRhYmxlLmNtcCB0ZC53aW4geyBiYWNrZ3JvdW5kOiB2YXIoLS1ncmVlbi0xMDApOyBmb250LXdlaWdodDogODAwOyB9CnRhYmxlLmNtcCB0aGVhZCB0aCB7IGJhY2tncm91bmQ6IHZhcigtLWJsYWNrKTsgY29sb3I6IHZhcigtLWdvbGQpOyB9CgovKiBzdGF0dXMgKi8KLmRvdC1zIHsgd2lkdGg6IDEwcHg7IGhlaWdodDogMTBweDsgYm9yZGVyLXJhZGl1czogNTAlOyBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7IH0KLnN0LU5FVywgLnN0LVNFQVJDSElORyB7IGJhY2tncm91bmQ6ICNlNWE4MDA7IH0gLnN0LU9GRkVSU19GT1VORCB7IGJhY2tncm91bmQ6ICMxZThhNWE7IH0gLnN0LUNPTVBBUklORywgLnN0LVVTRVJfU0VMRUNURUQsIC5zdC1JTl9QUk9HUkVTUyB7IGJhY2tncm91bmQ6ICMyYTZmZGI7IH0gLnN0LUNPTVBMRVRFRCB7IGJhY2tncm91bmQ6ICMyMjI7IH0gLnN0LUNBTkNFTExFRCB7IGJhY2tncm91bmQ6ICNiYmI7IH0KLnRpbWVsaW5lIHsgZGlzcGxheTogZmxleDsgZ2FwOiA0cHg7IG1hcmdpbjogMTBweCAwIDRweDsgfQoudGltZWxpbmUgaSB7IGZsZXg6IDE7IGhlaWdodDogNXB4OyBib3JkZXItcmFkaXVzOiAzcHg7IGJhY2tncm91bmQ6IHZhcigtLWxpbmUpOyB9Ci50aW1lbGluZSBpLm9uIHsgYmFja2dyb3VuZDogdmFyKC0tZ29sZCk7IH0KCi8qIGNoYXQgKi8KLmNoYXQgeyBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBnYXA6IDhweDsgcGFkZGluZzogMTJweCA0cHggNHB4OyB9Ci5tc2cgeyBtYXgtd2lkdGg6IDgyJTsgcGFkZGluZzogMTBweCAxNHB4OyBib3JkZXItcmFkaXVzOiAxOHB4OyBmb250LXNpemU6IDE1cHg7IHdvcmQtd3JhcDogYnJlYWstd29yZDsgd2hpdGUtc3BhY2U6IHByZS13cmFwOyB9Ci5tc2cubWUgeyBhbGlnbi1zZWxmOiBmbGV4LWVuZDsgYmFja2dyb3VuZDogdmFyKC0tYmxhY2spOyBjb2xvcjogI2ZmZjsgYm9yZGVyLWVuZC1lbmQtcmFkaXVzOiA0cHg7IH0KLm1zZy50aGVtIHsgYWxpZ24tc2VsZjogZmxleC1zdGFydDsgYmFja2dyb3VuZDogI2ZmZjsgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tbGluZSk7IGJvcmRlci1lbmQtc3RhcnQtcmFkaXVzOiA0cHg7IH0KLm1zZyBpbWcgeyBtYXgtd2lkdGg6IDIyMHB4OyBib3JkZXItcmFkaXVzOiAxMnB4OyBkaXNwbGF5OiBibG9jazsgfQoubXNnIC50IHsgZm9udC1zaXplOiAxMXB4OyBvcGFjaXR5OiAuNjsgbWFyZ2luLXRvcDogNHB4OyB9Ci5jb21wb3NlciB7IHBvc2l0aW9uOiBmaXhlZDsgYm90dG9tOiAwOyBpbnNldC1pbmxpbmU6IDA7IGRpc3BsYXk6IGZsZXg7IGp1c3RpZnktY29udGVudDogY2VudGVyOyB6LWluZGV4OiA0MDsgfQouY29tcG9zZXIgPiBkaXYgeyB3aWR0aDogMTAwJTsgbWF4LXdpZHRoOiA1MjBweDsgZGlzcGxheTogZmxleDsgZ2FwOiA4cHg7IHBhZGRpbmc6IDEwcHggMTJweCBjYWxjKDEwcHggKyBlbnYoc2FmZS1hcmVhLWluc2V0LWJvdHRvbSkpOyBiYWNrZ3JvdW5kOiAjZmZmOyBib3JkZXItdG9wOiAxcHggc29saWQgdmFyKC0tbGluZSk7IH0KLmNvbXBvc2VyIC5pbnB1dCB7IG1pbi1oZWlnaHQ6IDQ0cHg7IGJvcmRlci1yYWRpdXM6IDIycHg7IH0KCi8qIG1pc2MgKi8KLmVtcHR5IHsgdGV4dC1hbGlnbjogY2VudGVyOyBwYWRkaW5nOiA0MHB4IDIwcHg7IGNvbG9yOiB2YXIoLS1tdXRlZCk7IH0KLmVtcHR5IC5lIHsgZm9udC1zaXplOiA0OHB4OyBkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogOHB4OyB9Ci5saXN0LWl0ZW0geyBkaXNwbGF5OiBmbGV4OyBnYXA6IDEycHg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IHBhZGRpbmc6IDE0cHg7IGJhY2tncm91bmQ6ICNmZmY7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWxpbmUpOyBib3JkZXItcmFkaXVzOiAxNnB4OyBjdXJzb3I6IHBvaW50ZXI7IH0KLmxpc3QtaXRlbSArIC5saXN0LWl0ZW0geyBtYXJnaW4tdG9wOiAxMHB4OyB9Ci5saXN0LWl0ZW0udW5yZWFkIHsgYm9yZGVyLWNvbG9yOiB2YXIoLS1nb2xkKTsgYmFja2dyb3VuZDogdmFyKC0tZ29sZC01MCk7IH0KLmF2YXRhciB7IHdpZHRoOiA0NnB4OyBoZWlnaHQ6IDQ2cHg7IGJvcmRlci1yYWRpdXM6IDUwJTsgYmFja2dyb3VuZDogdmFyKC0tZ3JlZW4pOyBjb2xvcjogdmFyKC0tZ29sZCk7IGRpc3BsYXk6IGdyaWQ7IHBsYWNlLWl0ZW1zOiBjZW50ZXI7IGZvbnQtd2VpZ2h0OiA5MDA7IGZsZXg6IG5vbmU7IH0KLnRhYnMgeyBkaXNwbGF5OiBmbGV4OyBnYXA6IDZweDsgb3ZlcmZsb3cteDogYXV0bzsgcGFkZGluZy1ib3R0b206IDZweDsgbWFyZ2luLWJvdHRvbTogMTJweDsgc2Nyb2xsYmFyLXdpZHRoOiBub25lOyB9Ci50YWJzOjotd2Via2l0LXNjcm9sbGJhciB7IGRpc3BsYXk6IG5vbmU7IH0KLnRhYiB7IHBhZGRpbmc6IDlweCAxNnB4OyBib3JkZXItcmFkaXVzOiA5OTlweDsgYmFja2dyb3VuZDogI2ZmZjsgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tbGluZSk7IGZvbnQtd2VpZ2h0OiA3MDA7IGZvbnQtc2l6ZTogMTRweDsgd2hpdGUtc3BhY2U6IG5vd3JhcDsgY3Vyc29yOiBwb2ludGVyOyB9Ci50YWIub24geyBiYWNrZ3JvdW5kOiB2YXIoLS1ibGFjayk7IGNvbG9yOiB2YXIoLS1nb2xkKTsgYm9yZGVyLWNvbG9yOiB2YXIoLS1ibGFjayk7IH0KLnN0YXQtZ3JpZCB7IGRpc3BsYXk6IGdyaWQ7IGdyaWQtdGVtcGxhdGUtY29sdW1uczogcmVwZWF0KDIsIDFmcik7IGdhcDogMTBweDsgfQpAbWVkaWEgKG1pbi13aWR0aDogNzAwcHgpIHsgLnN0YXQtZ3JpZCB7IGdyaWQtdGVtcGxhdGUtY29sdW1uczogcmVwZWF0KDQsIDFmcik7IH0gfQouc3RhdCB7IGJhY2tncm91bmQ6ICNmZmY7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWxpbmUpOyBib3JkZXItcmFkaXVzOiAxNnB4OyBwYWRkaW5nOiAxNHB4OyB9Ci5zdGF0IC5uIHsgZm9udC1zaXplOiAyNHB4OyBmb250LXdlaWdodDogOTAwOyB9Ci5zdGF0LmhsIHsgYmFja2dyb3VuZDogdmFyKC0tYmxhY2spOyBjb2xvcjogI2ZmZjsgfSAuc3RhdC5obCAubiB7IGNvbG9yOiB2YXIoLS1nb2xkKTsgfQoudGJsIHsgd2lkdGg6IDEwMCU7IGJvcmRlci1jb2xsYXBzZTogY29sbGFwc2U7IGJhY2tncm91bmQ6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDE0cHg7IG92ZXJmbG93OiBoaWRkZW47IGZvbnQtc2l6ZTogMTRweDsgfQoudGJsIHRoLCAudGJsIHRkIHsgcGFkZGluZzogMTBweCAxMnB4OyB0ZXh0LWFsaWduOiBzdGFydDsgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkIHZhcigtLWxpbmUpOyB2ZXJ0aWNhbC1hbGlnbjogdG9wOyB9Ci50YmwgdGggeyBiYWNrZ3JvdW5kOiB2YXIoLS1ibGFjayk7IGNvbG9yOiB2YXIoLS1nb2xkKTsgZm9udC13ZWlnaHQ6IDcwMDsgfQoudGJsd3JhcCB7IG92ZXJmbG93LXg6IGF1dG87IGJvcmRlci1yYWRpdXM6IDE0cHg7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWxpbmUpOyB9CgovKiBtb2RhbCAqLwoub3ZlcmxheSB7IHBvc2l0aW9uOiBmaXhlZDsgaW5zZXQ6IDA7IGJhY2tncm91bmQ6IHJnYmEoMCwgMCwgMCwgLjU1KTsgei1pbmRleDogMTAwOyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogZmxleC1lbmQ7IGp1c3RpZnktY29udGVudDogY2VudGVyOyB9Ci5zaGVldCB7IHdpZHRoOiAxMDAlOyBtYXgtd2lkdGg6IDUyMHB4OyBtYXgtaGVpZ2h0OiA5MnZoOyBvdmVyZmxvdzogYXV0bzsgYmFja2dyb3VuZDogdmFyKC0tYmcpOyBib3JkZXItcmFkaXVzOiAyNnB4IDI2cHggMCAwOyBwYWRkaW5nOiAyMHB4IDE4cHggY2FsYygyNHB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20pKTsgYW5pbWF0aW9uOiB1cCAuMjJzIGVhc2U7IH0KQGtleWZyYW1lcyB1cCB7IGZyb20geyB0cmFuc2Zvcm06IHRyYW5zbGF0ZVkoNDBweCk7IG9wYWNpdHk6IDA7IH0gfQouZ3JhYmJlciB7IHdpZHRoOiA0NHB4OyBoZWlnaHQ6IDVweDsgYmFja2dyb3VuZDogI2Q4ZDJjMDsgYm9yZGVyLXJhZGl1czogM3B4OyBtYXJnaW46IC04cHggYXV0byAxNHB4OyB9CiN0b2FzdHMgeyBwb3NpdGlvbjogZml4ZWQ7IHRvcDogMTRweDsgaW5zZXQtaW5saW5lOiAwOyBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDhweDsgei1pbmRleDogMjAwOyBwb2ludGVyLWV2ZW50czogbm9uZTsgfQoudG9hc3QgeyBiYWNrZ3JvdW5kOiB2YXIoLS1ibGFjayk7IGNvbG9yOiAjZmZmOyBwYWRkaW5nOiAxMnB4IDE4cHg7IGJvcmRlci1yYWRpdXM6IDE0cHg7IGJveC1zaGFkb3c6IHZhcigtLXNoYWRvdy1sZyk7IG1heC13aWR0aDogOTJ2dzsgYW5pbWF0aW9uOiB1cCAuMnM7IGZvbnQtc2l6ZTogMTVweDsgfQoudG9hc3QuZXJyIHsgYmFja2dyb3VuZDogdmFyKC0tZGFuZ2VyKTsgfSAudG9hc3Qub2sgeyBiYWNrZ3JvdW5kOiB2YXIoLS1ncmVlbik7IH0KCi8qIHNwbGFzaCAvIG9uYm9hcmRpbmcgLyBhdXRoICovCi5zcGxhc2ggeyBtaW4taGVpZ2h0OiAxMDB2aDsgZGlzcGxheTogZ3JpZDsgcGxhY2UtaXRlbXM6IGNlbnRlcjsgYmFja2dyb3VuZDogcmFkaWFsLWdyYWRpZW50KDEwMCUgODAlIGF0IDUwJSAyMCUsICMxNzUwM2IsIHZhcigtLWJsYWNrKSk7IGNvbG9yOiAjZmZmOyB0ZXh0LWFsaWduOiBjZW50ZXI7IHBhZGRpbmc6IDIwcHg7IH0KLnNwbGFzaCAuYnJhbmQgLm5hbWUgeyBmb250LXNpemU6IDQ2cHg7IH0gLnNwbGFzaCBzdmcgeyB3aWR0aDogNzRweDsgaGVpZ2h0OiA3NHB4OyBhbmltYXRpb246IHBvcCAuNnMgZWFzZTsgfQpAa2V5ZnJhbWVzIHBvcCB7IGZyb20geyB0cmFuc2Zvcm06IHNjYWxlKC40KSByb3RhdGUoLTEyZGVnKTsgb3BhY2l0eTogMDsgfSB9Ci5vbmIgeyBtaW4taGVpZ2h0OiAxMDB2aDsgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgYmFja2dyb3VuZDogdmFyKC0tYmxhY2spOyBjb2xvcjogI2ZmZjsgcGFkZGluZzogMjhweCAyNHB4IDMwcHg7IH0KLm9uYiAuYXJ0IHsgZmxleDogMTsgZGlzcGxheTogZ3JpZDsgcGxhY2UtaXRlbXM6IGNlbnRlcjsgZm9udC1zaXplOiAxMTBweDsgfQoub25iIGgyIHsgZm9udC1zaXplOiAyOHB4OyBtYXJnaW4tYm90dG9tOiAxMHB4OyB9IC5vbmIgcCB7IGNvbG9yOiAjY2ZjOWI2OyBmb250LXNpemU6IDE3cHg7IG1hcmdpbjogMCAwIDIycHg7IH0KLmRvdHMgeyBkaXNwbGF5OiBmbGV4OyBnYXA6IDZweDsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7IG1hcmdpbi1ib3R0b206IDE4cHg7IH0KLmRvdHMgaSB7IHdpZHRoOiA4cHg7IGhlaWdodDogOHB4OyBib3JkZXItcmFkaXVzOiA0cHg7IGJhY2tncm91bmQ6ICM0NDQ7IH0gLmRvdHMgaS5vbiB7IHdpZHRoOiAyNnB4OyBiYWNrZ3JvdW5kOiB2YXIoLS1nb2xkKTsgfQouYXV0aHdyYXAgeyBtaW4taGVpZ2h0OiAxMDB2aDsgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgfQouYXV0aGhlYWQgeyBiYWNrZ3JvdW5kOiBsaW5lYXItZ3JhZGllbnQoMTYwZGVnLCB2YXIoLS1ncmVlbiksIHZhcigtLWJsYWNrKSk7IGNvbG9yOiAjZmZmOyBwYWRkaW5nOiAzNnB4IDIycHggNDRweDsgYm9yZGVyLXJhZGl1czogMCAwIDMycHggMzJweDsgfQouYXV0aGJvZHkgeyBwYWRkaW5nOiAyMnB4IDE4cHggNDBweDsgbWFyZ2luLXRvcDogLTIycHg7IH0KLnNlZyB7IGRpc3BsYXk6IGZsZXg7IGJhY2tncm91bmQ6ICNlZWU5ZGE7IGJvcmRlci1yYWRpdXM6IDE0cHg7IHBhZGRpbmc6IDRweDsgbWFyZ2luLWJvdHRvbTogMTRweDsgfQouc2VnIGJ1dHRvbiB7IGZsZXg6IDE7IGJvcmRlcjogMDsgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7IHBhZGRpbmc6IDEwcHg7IGJvcmRlci1yYWRpdXM6IDExcHg7IGZvbnQtd2VpZ2h0OiA4MDA7IGN1cnNvcjogcG9pbnRlcjsgfQouc2VnIGJ1dHRvbi5vbiB7IGJhY2tncm91bmQ6IHZhcigtLWJsYWNrKTsgY29sb3I6IHZhcigtLWdvbGQpOyB9Ci5sYW5nc3dpdGNoIHsgZGlzcGxheTogZmxleDsgZ2FwOiA2cHg7IH0KLmxhbmdzd2l0Y2ggYnV0dG9uIHsgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tbGluZSk7IGJhY2tncm91bmQ6ICNmZmY7IGJvcmRlci1yYWRpdXM6IDEwcHg7IHBhZGRpbmc6IDZweCAxMnB4OyBjdXJzb3I6IHBvaW50ZXI7IGZvbnQtd2VpZ2h0OiA3MDA7IH0KLmxhbmdzd2l0Y2ggYnV0dG9uLm9uIHsgYmFja2dyb3VuZDogdmFyKC0tYmxhY2spOyBjb2xvcjogdmFyKC0tZ29sZCk7IGJvcmRlci1jb2xvcjogdmFyKC0tYmxhY2spOyB9Ci5zcGluIHsgd2lkdGg6IDIycHg7IGhlaWdodDogMjJweDsgYm9yZGVyOiAzcHggc29saWQgcmdiYSgwLCAwLCAwLCAuMTUpOyBib3JkZXItdG9wLWNvbG9yOiB2YXIoLS1ibGFjayk7IGJvcmRlci1yYWRpdXM6IDUwJTsgYW5pbWF0aW9uOiByb3QgLjdzIGxpbmVhciBpbmZpbml0ZTsgZGlzcGxheTogaW5saW5lLWJsb2NrOyB9CkBrZXlmcmFtZXMgcm90IHsgdG8geyB0cmFuc2Zvcm06IHJvdGF0ZSgzNjBkZWcpOyB9IH0KLnNrZWxldG9uIHsgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDkwZGVnLCAjZWVlOWRhIDI1JSwgI2Y2ZjJlNiAzNyUsICNlZWU5ZGEgNjMlKTsgYmFja2dyb3VuZC1zaXplOiA0MDAlIDEwMCU7IGFuaW1hdGlvbjogc2sgMS4zcyBpbmZpbml0ZTsgYm9yZGVyLXJhZGl1czogMTRweDsgaGVpZ2h0OiA5MHB4OyBtYXJnaW4tYm90dG9tOiAxMnB4OyB9CkBrZXlmcmFtZXMgc2sgeyB0byB7IGJhY2tncm91bmQtcG9zaXRpb246IC00MDAlIDA7IH0gfQouc3RhcnBpY2sgeyBkaXNwbGF5OiBmbGV4OyBnYXA6IDZweDsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7IGZvbnQtc2l6ZTogMzhweDsgfQouc3RhcnBpY2sgYnV0dG9uIHsgYmFja2dyb3VuZDogbm9uZTsgYm9yZGVyOiAwOyBjdXJzb3I6IHBvaW50ZXI7IGNvbG9yOiAjZDhkMmMwOyBwYWRkaW5nOiAwOyB9IC5zdGFycGljayBidXR0b24ub24geyBjb2xvcjogdmFyKC0tZ29sZCk7IH0KLnNpZGViYXItYWRtaW4geyBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmcjsgZ2FwOiAxNHB4OyB9CkBtZWRpYSAobWluLXdpZHRoOiA5MDBweCkgeyAuc2lkZWJhci1hZG1pbiB7IGdyaWQtdGVtcGxhdGUtY29sdW1uczogMjIwcHggMWZyOyB9IC5zaWRlYmFyLWFkbWluIC50YWJzIHsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgb3ZlcmZsb3c6IHZpc2libGU7IH0gfQo=", "base64") },
  "icon.svg": { path: "icon.svg", buf: Buffer.from("PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByeD0iMjQiIGZpbGw9IiMwQjBCMEIiLz48cmVjdCB4PSI4IiB5PSI4IiB3aWR0aD0iODAiIGhlaWdodD0iODAiIHJ4PSIxOCIgZmlsbD0iI0YyQjcwNSIvPjxwYXRoIGQ9Ik0yOCA1MGwxNCAxNCAyNy0zMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMEUzQjJDIiBzdHJva2Utd2lkdGg9IjEwIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4K", "base64") },
  "manifest.webmanifest": { path: "manifest.webmanifest", buf: Buffer.from("ewogICJuYW1lIjogItio2YTYpyDYtNmC2Ykg4oCUINmC2YjZhCDZiNin2LQg2KrYrdiq2KfYrNiMINmI2K7ZhNmK2YfYpyDYudmE2YrZhtinIiwKICAic2hvcnRfbmFtZSI6ICLYqNmE2Kcg2LTZgtmJIiwKICAiZGVzY3JpcHRpb24iOiAi2YLZiNmEINmI2KfYtCDYqtit2KrYp9is2Iwg2YjYrtmE2YrZh9inINi52YTZitmG2KcuIiwKICAiaWQiOiAiLyIsCiAgInN0YXJ0X3VybCI6ICIvIiwKICAic2NvcGUiOiAiLyIsCiAgImRpc3BsYXkiOiAic3RhbmRhbG9uZSIsCiAgIm9yaWVudGF0aW9uIjogInBvcnRyYWl0IiwKICAiYmFja2dyb3VuZF9jb2xvciI6ICIjMEIwQjBCIiwKICAidGhlbWVfY29sb3IiOiAiIzBCMEIwQiIsCiAgImxhbmciOiAiYXItRFoiLAogICJkaXIiOiAicnRsIiwKICAiaWNvbnMiOiBbCiAgICB7ICJzcmMiOiAiL2ljb25zL2ljb24tMTkyLnBuZyIsICJzaXplcyI6ICIxOTJ4MTkyIiwgInR5cGUiOiAiaW1hZ2UvcG5nIiwgInB1cnBvc2UiOiAiYW55IiB9LAogICAgeyAic3JjIjogIi9pY29ucy9pY29uLTUxMi5wbmciLCAic2l6ZXMiOiAiNTEyeDUxMiIsICJ0eXBlIjogImltYWdlL3BuZyIsICJwdXJwb3NlIjogImFueSIgfSwKICAgIHsgInNyYyI6ICIvaWNvbnMvbWFza2FibGUtNTEyLnBuZyIsICJzaXplcyI6ICI1MTJ4NTEyIiwgInR5cGUiOiAiaW1hZ2UvcG5nIiwgInB1cnBvc2UiOiAibWFza2FibGUiIH0KICBdCn0K", "base64") },
  "js/i18n.js": { path: "js/i18n.js", buf: Buffer.from("aW1wb3J0IGFyIGZyb20gJy4vaTE4bi9hci5qcyc7CmltcG9ydCBmciBmcm9tICcuL2kxOG4vZnIuanMnOwppbXBvcnQgZW4gZnJvbSAnLi9pMThuL2VuLmpzJzsKCmNvbnN0IERJQ1RTID0geyAnYXItRFonOiBhciwgJ2ZyLURaJzogZnIsIGVuIH07CmV4cG9ydCBjb25zdCBMT0NBTEVTID0gW1snYXItRFonLCAn2KfZhNi52LHYqNmK2KknXSwgWydmci1EWicsICdGcmFuw6dhaXMnXSwgWydlbicsICdFbmdsaXNoJ11dOwpsZXQgbG9jYWxlID0gJ2FyLURaJzsKdHJ5IHsgbG9jYWxlID0gbG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2JzX2xvY2FsZScpIHx8ICdhci1EWic7IH0gY2F0Y2ggeyAvKiAqLyB9CmlmICghRElDVFNbbG9jYWxlXSkgbG9jYWxlID0gJ2FyLURaJzsKCmV4cG9ydCBjb25zdCBnZXRMb2NhbGUgPSAoKSA9PiBsb2NhbGU7CmV4cG9ydCBjb25zdCBsYW5nID0gKCkgPT4gbG9jYWxlLnNsaWNlKDAsIDIpOyAgICAgICAgICAgICAgICAgLy8gYXIgfCBmciB8IGVuCmV4cG9ydCBjb25zdCBpc1J0bCA9ICgpID0+IGxvY2FsZSA9PT0gJ2FyLURaJzsKCmV4cG9ydCBmdW5jdGlvbiBzZXRMb2NhbGUobCkgewogIGlmICghRElDVFNbbF0pIHJldHVybjsKICBsb2NhbGUgPSBsOwogIHRyeSB7IGxvY2FsU3RvcmFnZS5zZXRJdGVtKCdic19sb2NhbGUnLCBsKTsgfSBjYXRjaCB7IC8qICovIH0KICBhcHBseURpcigpOwp9CmV4cG9ydCBmdW5jdGlvbiBhcHBseURpcigpIHsKICBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQubGFuZyA9IGxhbmcoKTsKICBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuZGlyID0gaXNSdGwoKSA/ICdydGwnIDogJ2x0cic7Cn0KCmV4cG9ydCBmdW5jdGlvbiB0KGtleSwgdmFycykgewogIGxldCBzID0gRElDVFNbbG9jYWxlXVtrZXldID8/IERJQ1RTWydhci1EWiddW2tleV0gPz8ga2V5OwogIGlmICh2YXJzKSBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyh2YXJzKSkgcyA9IHMucmVwbGFjZUFsbChgeyR7a319YCwgU3RyaW5nKHYpKTsKICByZXR1cm4gczsKfQoKLyoqIExvY2FsaXNlZCBuYW1lIGZvciBEQiByb3dzIHRoYXQgY2FycnkgbmFtZV9hciAvIG5hbWVfZnIgKC8gbmFtZV9lbikuICovCmV4cG9ydCBmdW5jdGlvbiBuYW1lT2Yocm93KSB7CiAgaWYgKCFyb3cpIHJldHVybiAnJzsKICBjb25zdCBsID0gbGFuZygpOwogIHJldHVybiByb3dbYG5hbWVfJHtsfWBdIHx8IHJvdy5uYW1lX2ZyIHx8IHJvdy5uYW1lX2FyIHx8IHJvdy5uYW1lIHx8ICcnOwp9CgpleHBvcnQgY29uc3QgbmYgPSAobikgPT4gYFx1MjA2NiR7TnVtYmVyKG4gPz8gMCkudG9Mb2NhbGVTdHJpbmcoJ2ZyLUZSJykucmVwbGFjZSgvW1x1MjAyZlx1MDBhMF0vZywgJyAnKX1cdTIwNjlgOyAvLyBMVFIgaXNvbGF0ZToga2VlcHMgIjg1IDAwMCIgaW4gcmVhZGluZyBvcmRlciBpbnNpZGUgUlRMIHRleHQKZXhwb3J0IGNvbnN0IG1vbmV5ID0gKG4pID0+IGAke25mKG4pfSAke3QoJ2N1cnJlbmN5Jyl9YDsKCmV4cG9ydCBmdW5jdGlvbiBhZ28oaXNvKSB7CiAgY29uc3QgcyA9IE1hdGgubWF4KDAsIChEYXRlLm5vdygpIC0gbmV3IERhdGUoaXNvKS5nZXRUaW1lKCkpIC8gMTAwMCk7CiAgY29uc3QgcnRmID0gbmV3IEludGwuUmVsYXRpdmVUaW1lRm9ybWF0KGxhbmcoKSA9PT0gJ2FyJyA/ICdhci1EWi11LW51LWxhdG4nIDogbG9jYWxlLCB7IG51bWVyaWM6ICdhdXRvJyB9KTsKICBpZiAocyA8IDYwKSByZXR1cm4gdCgnanVzdF9ub3cnKTsKICBpZiAocyA8IDM2MDApIHJldHVybiBydGYuZm9ybWF0KC1NYXRoLmZsb29yKHMgLyA2MCksICdtaW51dGUnKTsKICBpZiAocyA8IDg2NDAwKSByZXR1cm4gcnRmLmZvcm1hdCgtTWF0aC5mbG9vcihzIC8gMzYwMCksICdob3VyJyk7CiAgaWYgKHMgPCA4NjQwMCAqIDMwKSByZXR1cm4gcnRmLmZvcm1hdCgtTWF0aC5mbG9vcihzIC8gODY0MDApLCAnZGF5Jyk7CiAgcmV0dXJuIG5ldyBEYXRlKGlzbykudG9Mb2NhbGVEYXRlU3RyaW5nKGxhbmcoKSA9PT0gJ2FyJyA/ICdhci1EWi11LW51LWxhdG4nIDogbG9jYWxlKTsKfQphcHBseURpcigpOwo=", "base64") },
  "js/core.js": { path: "js/core.js", buf: Buffer.from("Ly8gU2hhcmVkIGNsaWVudCBzdGF0ZSBhbmQgbmF2aWdhdGlvbiBoZWxwZXJzIChubyBwYWdlIGltcG9ydHMg4oaSIG5vIGltcG9ydCBjeWNsZXMpLgppbXBvcnQgeyBHRVQsIGdldFRva2VuLCBzZXRUb2tlbiwgc2V0VW5hdXRob3JpemVkSGFuZGxlciB9IGZyb20gJy4vYXBpLmpzJzsKaW1wb3J0IHsgc2V0TG9jYWxlIH0gZnJvbSAnLi9pMThuLmpzJzsKCmV4cG9ydCBjb25zdCBzdGF0ZSA9IHsgdXNlcjogbnVsbCwgbWV0YTogbnVsbCwgdW5yZWFkOiAwLCBwcm92aWRlcjogbnVsbCB9OwoKbGV0IHJlbmRlckZuID0gKCkgPT4ge307CmV4cG9ydCBjb25zdCBzZXRSZW5kZXJlciA9IChmbikgPT4geyByZW5kZXJGbiA9IGZuOyB9OwpleHBvcnQgY29uc3QgcmVuZGVyID0gKCkgPT4gcmVuZGVyRm4oKTsKCmV4cG9ydCBjb25zdCBnbyA9IChwYXRoKSA9PiB7IGlmIChsb2NhdGlvbi5oYXNoID09PSAnIycgKyBwYXRoKSByZW5kZXIoKTsgZWxzZSBsb2NhdGlvbi5oYXNoID0gcGF0aDsgfTsKZXhwb3J0IGNvbnN0IGhvbWVQYXRoID0gKCkgPT4gKHN0YXRlLnVzZXI/LnJvbGUgPT09ICdwcm92aWRlcicgPyAnL3Byb3ZpZGVyJyA6IHN0YXRlLnVzZXI/LnJvbGUgPT09ICdhZG1pbicgPyAnL2FkbWluJyA6ICcvJyk7CgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFNlc3Npb24oKSB7CiAgaWYgKCFzdGF0ZS5tZXRhKSBzdGF0ZS5tZXRhID0gYXdhaXQgR0VUKCcvYXBpL21ldGEnKTsKICBpZiAoIWdldFRva2VuKCkpIHsgc3RhdGUudXNlciA9IG51bGw7IHJldHVybjsgfQogIHRyeSB7CiAgICBjb25zdCBtZSA9IGF3YWl0IEdFVCgnL2FwaS9tZScpOwogICAgc3RhdGUudXNlciA9IG1lLnVzZXI7IHN0YXRlLnVucmVhZCA9IG1lLnVucmVhZDsgc3RhdGUucHJvdmlkZXIgPSBtZS5wcm92aWRlcjsKICB9IGNhdGNoIHsgc3RhdGUudXNlciA9IG51bGw7IHNldFRva2VuKG51bGwpOyB9Cn0KCmV4cG9ydCBmdW5jdGlvbiBwYWludEJhZGdlcygpIHsKICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdbZGF0YS11bnJlYWRdJykuZm9yRWFjaCgoZWwpID0+IHsgZWwudGV4dENvbnRlbnQgPSBzdGF0ZS51bnJlYWQgPiA5OSA/ICc5OSsnIDogc3RhdGUudW5yZWFkOyBlbC5jbGFzc0xpc3QudG9nZ2xlKCdoaWRkZW4nLCAhc3RhdGUudW5yZWFkKTsgfSk7Cn0KZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hVbnJlYWQoKSB7CiAgdHJ5IHsgY29uc3QgbWUgPSBhd2FpdCBHRVQoJy9hcGkvbWUnKTsgc3RhdGUudW5yZWFkID0gbWUudW5yZWFkOyBzdGF0ZS5wcm92aWRlciA9IG1lLnByb3ZpZGVyOyBwYWludEJhZGdlcygpOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH0KfQpleHBvcnQgZnVuY3Rpb24gbG9nb3V0KCkgeyBzZXRUb2tlbihudWxsKTsgc3RhdGUudXNlciA9IG51bGw7IHN0YXRlLnByb3ZpZGVyID0gbnVsbDsgZ28oJy9sb2dpbicpOyB9CnNldFVuYXV0aG9yaXplZEhhbmRsZXIoKCkgPT4geyBzdGF0ZS51c2VyID0gbnVsbDsgc2V0VG9rZW4obnVsbCk7IGlmICghbG9jYXRpb24uaGFzaC5zdGFydHNXaXRoKCcjL2xvZ2luJykgJiYgIWxvY2F0aW9uLmhhc2guc3RhcnRzV2l0aCgnIy9yZWdpc3RlcicpKSBnbygnL2xvZ2luJyk7IH0pOwpleHBvcnQgZnVuY3Rpb24gY2hhbmdlTG9jYWxlKGwpIHsgc2V0TG9jYWxlKGwpOyByZW5kZXIoKTsgfQo=", "base64") },
  "js/app.js": { path: "js/app.js", buf: Buffer.from("aW1wb3J0IHsgZ2V0VG9rZW4gfSBmcm9tICcuL2FwaS5qcyc7CmltcG9ydCB7IGgsIGNsZWFyLCB0b2FzdCwgZXJyTXNnLCB0LCBicmFuZCB9IGZyb20gJy4vdWkuanMnOwppbXBvcnQgeyBhcHBseURpciB9IGZyb20gJy4vaTE4bi5qcyc7CmltcG9ydCB7IHN0YXRlLCBnbywgaG9tZVBhdGgsIGxvYWRTZXNzaW9uLCByZWZyZXNoVW5yZWFkLCBwYWludEJhZGdlcywgc2V0UmVuZGVyZXIgfSBmcm9tICcuL2NvcmUuanMnOwppbXBvcnQgeyBwdWJsaWNSb3V0ZXMgfSBmcm9tICcuL3BhZ2VzL3B1YmxpYy5qcyc7CmltcG9ydCB7IHVzZXJSb3V0ZXMgfSBmcm9tICcuL3BhZ2VzL3VzZXIuanMnOwppbXBvcnQgeyBwcm92aWRlclJvdXRlcyB9IGZyb20gJy4vcGFnZXMvcHJvdmlkZXIuanMnOwppbXBvcnQgeyBhZG1pblJvdXRlcyB9IGZyb20gJy4vcGFnZXMvYWRtaW4uanMnOwoKY29uc3Qgcm91dGVzID0gWy4uLnB1YmxpY1JvdXRlcywgLi4udXNlclJvdXRlcywgLi4ucHJvdmlkZXJSb3V0ZXMsIC4uLmFkbWluUm91dGVzXS5tYXAoKFtwYXR0ZXJuLCBoYW5kbGVyLCBvcHRzID0ge31dKSA9PiB7CiAgY29uc3Qga2V5cyA9IFtdOwogIGNvbnN0IHJlID0gbmV3IFJlZ0V4cCgnXicgKyBwYXR0ZXJuLnJlcGxhY2UoLzooW2EtekEtWl0rKS9nLCAoXywgaykgPT4geyBrZXlzLnB1c2goayk7IHJldHVybiAnKFteL10rKSc7IH0pICsgJyQnKTsKICByZXR1cm4geyByZSwga2V5cywgaGFuZGxlciwgb3B0cyB9Owp9KTsKCi8vIC0tLS0tLS0tLS0gbGF5b3V0IC0tLS0tLS0tLS0KZnVuY3Rpb24gdGFic0Zvcihyb2xlKSB7CiAgaWYgKHJvbGUgPT09ICdwcm92aWRlcicpIHJldHVybiBbWycvcHJvdmlkZXInLCAn8J+TiicsICduYXZfZGFzaGJvYXJkJ10sIFsnL3Byb3ZpZGVyL3JlcXVlc3RzJywgJ/Cfk6UnLCAnbmF2X2luY29taW5nJ10sIFsnL3Byb3ZpZGVyL29yZGVycycsICfwn6e+JywgJ25hdl9vcmRlcnMnXSwgWycvcHJvdmlkZXIvY2F0YWxvZycsICfwn4+377iPJywgJ25hdl9jYXRhbG9nJ10sIFsnL3Byb2ZpbGUnLCAn8J+RpCcsICduYXZfcHJvZmlsZSddXTsKICBpZiAocm9sZSA9PT0gJ2FkbWluJykgcmV0dXJuIFtdOwogIHJldHVybiBbWycvJywgJ/Cfj6AnLCAnbmF2X2hvbWUnXSwgWycvcmVxdWVzdHMnLCAn8J+TiycsICduYXZfcmVxdWVzdHMnXSwgWycvY2hhdHMnLCAn8J+SrCcsICduYXZfY2hhdCddLCBbJy9wcm9maWxlJywgJ/CfkaQnLCAnbmF2X3Byb2ZpbGUnXV07Cn0KCmxldCBjbGVhbnVwID0gbnVsbDsKbGV0IHJlbmRlclRva2VuID0gMDsKCmFzeW5jIGZ1bmN0aW9uIHJlbmRlcigpIHsKICBjb25zdCBteSA9ICsrcmVuZGVyVG9rZW47CiAgaWYgKGNsZWFudXApIHsgdHJ5IHsgY2xlYW51cCgpOyB9IGNhdGNoIHsgLyogKi8gfSBjbGVhbnVwID0gbnVsbDsgfQogIGNvbnN0IGFwcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhcHAnKTsKICBjb25zdCBwYXRoID0gbG9jYXRpb24uaGFzaC5zbGljZSgxKS5zcGxpdCgnPycpWzBdIHx8ICcvJzsKICBjb25zdCBxdWVyeSA9IE9iamVjdC5mcm9tRW50cmllcyhuZXcgVVJMU2VhcmNoUGFyYW1zKGxvY2F0aW9uLmhhc2guc3BsaXQoJz8nKVsxXSB8fCAnJykpOwogIGFwcGx5RGlyKCk7CgogIGlmICghc3RhdGUubWV0YSB8fCAoZ2V0VG9rZW4oKSAmJiAhc3RhdGUudXNlcikpIHsgdHJ5IHsgYXdhaXQgbG9hZFNlc3Npb24oKTsgfSBjYXRjaCB7IC8qIGhhbmRsZWQgYmVsb3cgKi8gfSB9CiAgaWYgKG15ICE9PSByZW5kZXJUb2tlbikgcmV0dXJuOwoKICBjb25zdCByID0gcm91dGVzLmZpbmQoKHgpID0+IHgucmUudGVzdChwYXRoKSk7CiAgaWYgKCFyKSByZXR1cm4gZ28oc3RhdGUudXNlciA/IGhvbWVQYXRoKCkgOiAnL2xvZ2luJyk7CiAgY29uc3QgbSA9IHIucmUuZXhlYyhwYXRoKTsKICBjb25zdCBwYXJhbXMgPSBPYmplY3QuZnJvbUVudHJpZXMoci5rZXlzLm1hcCgoaywgaSkgPT4gW2ssIGRlY29kZVVSSUNvbXBvbmVudChtW2kgKyAxXSldKSk7CgogIGlmIChyLm9wdHMuYXV0aCAhPT0gZmFsc2UgJiYgIXN0YXRlLnVzZXIpIHJldHVybiBnbygnL2xvZ2luJyk7CiAgaWYgKHIub3B0cy5yb2xlcyAmJiAhci5vcHRzLnJvbGVzLmluY2x1ZGVzKHN0YXRlLnVzZXI/LnJvbGUpKSByZXR1cm4gZ28oaG9tZVBhdGgoKSk7CiAgaWYgKHIub3B0cy5ndWVzdE9ubHkgJiYgc3RhdGUudXNlcikgcmV0dXJuIGdvKGhvbWVQYXRoKCkpOwogIC8vIHJvbGUgaG9tZSByZWRpcmVjdHMKICBpZiAocGF0aCA9PT0gJy8nICYmIHN0YXRlLnVzZXI/LnJvbGUgPT09ICdwcm92aWRlcicpIHJldHVybiBnbygnL3Byb3ZpZGVyJyk7CiAgaWYgKHBhdGggPT09ICcvJyAmJiBzdGF0ZS51c2VyPy5yb2xlID09PSAnYWRtaW4nKSByZXR1cm4gZ28oJy9hZG1pbicpOwoKICBjbGVhcihhcHApLmFwcGVuZChoKCdkaXYnLCB7IGNsYXNzOiAnc2hlbGwgYmFyZScgfSwgaCgnZGl2JywgeyBjbGFzczogJ3ZpZXcnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdjZW50ZXIgbXQyJyB9LCBoKCdzcGFuJywgeyBjbGFzczogJ3NwaW4nIH0pKSkpKTsKICBsZXQgcGFnZTsKICB0cnkgeyBwYWdlID0gYXdhaXQgci5oYW5kbGVyKHsgcGFyYW1zLCBxdWVyeSwgc3RhdGUsIGdvIH0pOyB9CiAgY2F0Y2ggKGUpIHsKICAgIGlmIChteSAhPT0gcmVuZGVyVG9rZW4pIHJldHVybjsKICAgIGNsZWFyKGFwcCkuYXBwZW5kKGgoJ2RpdicsIHsgY2xhc3M6ICdzaGVsbCcgfSwgaCgnZGl2JywgeyBjbGFzczogJ3ZpZXcgY2VudGVyIG10MicgfSwgaCgncCcsIG51bGwsIGVyck1zZyhlKSksIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4nLCBvbkNsaWNrOiAoKSA9PiByZW5kZXIoKSB9LCB0KCdiYWNrJykpKSkpOwogICAgcmV0dXJuOwogIH0KICBpZiAobXkgIT09IHJlbmRlclRva2VuKSByZXR1cm47CiAgY2xlYW51cCA9IHBhZ2UuY2xlYW51cCB8fCBudWxsOwoKICBjb25zdCB0YWJzID0gc3RhdGUudXNlciAmJiAhcGFnZS5iYXJlID8gdGFic0ZvcihzdGF0ZS51c2VyLnJvbGUpIDogW107CiAgY29uc3Qgc2hlbGwgPSBoKCdkaXYnLCB7IGNsYXNzOiBgc2hlbGwke3BhZ2Uud2lkZSA/ICcgd2lkZScgOiAnJ30ke3BhZ2UuYmFyZSA/ICcgYmFyZScgOiAnJ31gIH0pOwogIGlmIChwYWdlLmJhcmUpIHNoZWxsLmFwcGVuZChwYWdlLmJvZHkpOwogIGVsc2UgewogICAgaWYgKHBhZ2UudGl0bGUgIT09IGZhbHNlKSBzaGVsbC5hcHBlbmQoCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICd0b3BiYXInIH0sCiAgICAgICAgcGFnZS5iYWNrICYmIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdpY29uYnRuJywgJ2FyaWEtbGFiZWwnOiB0KCdiYWNrJyksIG9uQ2xpY2s6ICgpID0+IChwYWdlLmJhY2sgPT09IHRydWUgPyBoaXN0b3J5LmJhY2soKSA6IGdvKHBhZ2UuYmFjaykpIH0sIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5kaXIgPT09ICdydGwnID8gJ+KGkicgOiAn4oaQJyksCiAgICAgICAgaCgnaDEnLCBudWxsLCBwYWdlLnRpdGxlIHx8IGJyYW5kKDMwKSksCiAgICAgICAgcGFnZS5hY3Rpb25zLAogICAgICAgIHN0YXRlLnVzZXIgJiYgaCgnYScsIHsgY2xhc3M6ICdpY29uYnRuJywgaHJlZjogJyMvbm90aWZpY2F0aW9ucycsICdhcmlhLWxhYmVsJzogdCgnbm90aWZpY2F0aW9ucycpIH0sICfwn5SUJywgaCgnc3BhbicsIHsgY2xhc3M6ICdkb3QgaGlkZGVuJywgJ2RhdGEtdW5yZWFkJzogJycgfSkpKSk7CiAgICBzaGVsbC5hcHBlbmQoaCgnZGl2JywgeyBjbGFzczogYHZpZXcke3BhZ2UuZmx1c2ggPyAnIGZsdXNoJyA6ICcnfWAgfSwgcGFnZS5ib2R5KSk7CiAgICBpZiAodGFicy5sZW5ndGgpIHsKICAgICAgY29uc3QgaGVyZSA9IHBhdGg7CiAgICAgIHNoZWxsLmFwcGVuZChoKCduYXYnLCB7IGNsYXNzOiAndGFiYmFyJyB9LCBoKCdkaXYnLCBudWxsLCB0YWJzLm1hcCgoW3AsIGljLCBsYl0pID0+CiAgICAgICAgaCgnYScsIHsgaHJlZjogJyMnICsgcCwgY2xhc3M6IChwID09PSAnLycgPyBoZXJlID09PSAnLycgOiBoZXJlID09PSBwIHx8IChwICE9PSAnL3Byb3ZpZGVyJyAmJiBoZXJlLnN0YXJ0c1dpdGgocCArICcvJykpKSA/ICdvbicgOiAnJyB9LAogICAgICAgICAgaCgnc3BhbicsIHsgY2xhc3M6ICdpYycgfSwgaWMpLCB0KGxiKSwgcCA9PT0gJy9jaGF0cycgJiYgaCgnc3BhbicsIHsgY2xhc3M6ICdkb3QgaGlkZGVuJywgJ2RhdGEtdW5yZWFkLWNoYXQnOiAnJyB9KSkpKSkpOwogICAgfQogIH0KICBjbGVhcihhcHApLmFwcGVuZChzaGVsbCk7CiAgcGFpbnRCYWRnZXMoKTsKICB3aW5kb3cuc2Nyb2xsVG8oMCwgMCk7CiAgaWYgKHN0YXRlLnVzZXIpIHJlZnJlc2hVbnJlYWQoKTsKfQoKc2V0UmVuZGVyZXIocmVuZGVyKTsKd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2hhc2hjaGFuZ2UnLCByZW5kZXIpOwp3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignRE9NQ29udGVudExvYWRlZCcsIHJlbmRlcik7CmlmIChkb2N1bWVudC5yZWFkeVN0YXRlICE9PSAnbG9hZGluZycpIHJlbmRlcigpOwovLyBiYWNrZ3JvdW5kIHBvbGwgZm9yIG5vdGlmaWNhdGlvbiBiYWRnZQpzZXRJbnRlcnZhbCgoKSA9PiB7IGlmIChzdGF0ZS51c2VyICYmICFkb2N1bWVudC5oaWRkZW4pIHJlZnJlc2hVbnJlYWQoKTsgfSwgMzAwMDApOwoKLy8gaW5zdGFsbGFibGUgUFdBIChBbmRyb2lkOiBDaHJvbWUgbWVudSDihpIgIkluc3RhbGwgYXBwIikKaWYgKCdzZXJ2aWNlV29ya2VyJyBpbiBuYXZpZ2F0b3IpIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgKCkgPT4gbmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIucmVnaXN0ZXIoJy9zdy5qcycpLmNhdGNoKCgpID0+IHt9KSk7Cg==", "base64") },
  "js/ui.js": { path: "js/ui.js", buf: Buffer.from("Ly8gVGlueSBET00gdG9vbGtpdC4gRXZlcnl0aGluZyB1c2VyLXByb3ZpZGVkIGdvZXMgdGhyb3VnaCB0ZXh0Q29udGVudCDihpIgbm8gSFRNTCBpbmplY3Rpb24gcG9zc2libGUuCmltcG9ydCB7IHQsIG5mLCBtb25leSwgbmFtZU9mLCBsYW5nIH0gZnJvbSAnLi9pMThuLmpzJzsKCmV4cG9ydCBmdW5jdGlvbiBoKHRhZywgcHJvcHMsIC4uLmNoaWxkcmVuKSB7CiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7CiAgaWYgKHByb3BzKSB7CiAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhwcm9wcykpIHsKICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCB8fCB2ID09PSBudWxsIHx8IHYgPT09IGZhbHNlKSBjb250aW51ZTsKICAgICAgaWYgKGsgPT09ICdjbGFzcycpIGVsLmNsYXNzTmFtZSA9IHY7CiAgICAgIGVsc2UgaWYgKGsgPT09ICdzdHlsZScgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnKSBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCB2KTsKICAgICAgZWxzZSBpZiAoay5zdGFydHNXaXRoKCdvbicpICYmIHR5cGVvZiB2ID09PSAnZnVuY3Rpb24nKSBlbC5hZGRFdmVudExpc3RlbmVyKGsuc2xpY2UoMikudG9Mb3dlckNhc2UoKSwgdik7CiAgICAgIGVsc2UgaWYgKGsgPT09ICd2YWx1ZScpIGVsLnZhbHVlID0gdjsKICAgICAgZWxzZSBpZiAoayA9PT0gJ2NoZWNrZWQnIHx8IGsgPT09ICdkaXNhYmxlZCcgfHwgayA9PT0gJ3NlbGVjdGVkJykgZWxba10gPSAhIXY7CiAgICAgIGVsc2UgZWwuc2V0QXR0cmlidXRlKGssIHYgPT09IHRydWUgPyAnJyA6IHYpOwogICAgfQogIH0KICBhcHBlbmQoZWwsIGNoaWxkcmVuKTsKICByZXR1cm4gZWw7Cn0KZnVuY3Rpb24gYXBwZW5kKGVsLCBjaGlsZHJlbikgewogIGZvciAoY29uc3QgYyBvZiBjaGlsZHJlbi5mbGF0KEluZmluaXR5KSkgewogICAgaWYgKGMgPT09IG51bGwgfHwgYyA9PT0gdW5kZWZpbmVkIHx8IGMgPT09IGZhbHNlKSBjb250aW51ZTsKICAgIGVsLmFwcGVuZChjIGluc3RhbmNlb2YgTm9kZSA/IGMgOiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShTdHJpbmcoYykpKTsKICB9Cn0KZXhwb3J0IGNvbnN0ICQgPSAoc2VsLCByb290ID0gZG9jdW1lbnQpID0+IHJvb3QucXVlcnlTZWxlY3RvcihzZWwpOwpleHBvcnQgY29uc3QgY2xlYXIgPSAoZWwpID0+IHsgd2hpbGUgKGVsLmZpcnN0Q2hpbGQpIGVsLnJlbW92ZUNoaWxkKGVsLmZpcnN0Q2hpbGQpOyByZXR1cm4gZWw7IH07CgpleHBvcnQgZnVuY3Rpb24gdG9hc3QobXNnLCBraW5kID0gJycpIHsKICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG9hc3RzJyk7CiAgY29uc3QgZWwgPSBoKCdkaXYnLCB7IGNsYXNzOiBgdG9hc3QgJHtraW5kfWAgfSwgbXNnKTsKICBib3guYXBwZW5kKGVsKTsKICBzZXRUaW1lb3V0KCgpID0+IGVsLnJlbW92ZSgpLCAzODAwKTsKfQpleHBvcnQgY29uc3QgZXJyTXNnID0gKGUpID0+IHsKICBpZiAoZT8uc3RhdHVzID09PSAwKSByZXR1cm4gdCgnZXJyX25ldHdvcmsnKTsKICByZXR1cm4gZT8ubWVzc2FnZSAmJiBlLm1lc3NhZ2UgIT09ICdlcnJvcicgPyBlLm1lc3NhZ2UgOiB0KCdlcnJfZ2VuZXJpYycpOwp9OwoKZXhwb3J0IGZ1bmN0aW9uIG1vZGFsKGJ1aWxkKSB7CiAgY29uc3QgY2xvc2UgPSAoKSA9PiBvdi5yZW1vdmUoKTsKICBjb25zdCBzaGVldCA9IGgoJ2RpdicsIHsgY2xhc3M6ICdzaGVldCcgfSwgaCgnZGl2JywgeyBjbGFzczogJ2dyYWJiZXInIH0pKTsKICBjb25zdCBvdiA9IGgoJ2RpdicsIHsgY2xhc3M6ICdvdmVybGF5Jywgb25DbGljazogKGUpID0+IHsgaWYgKGUudGFyZ2V0ID09PSBvdikgY2xvc2UoKTsgfSB9LCBzaGVldCk7CiAgZG9jdW1lbnQuYm9keS5hcHBlbmQob3YpOwogIGJ1aWxkKHNoZWV0LCBjbG9zZSk7CiAgcmV0dXJuIGNsb3NlOwp9CmV4cG9ydCBmdW5jdGlvbiBjb25maXJtQm94KG1lc3NhZ2UsIG9rTGFiZWwgPSB0KCdjb25maXJtJykpIHsKICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsKICAgIG1vZGFsKChzLCBjbG9zZSkgPT4gewogICAgICBzLmFwcGVuZChoKCdwJywgeyBjbGFzczogJ2InLCBzdHlsZTogeyBmb250U2l6ZTogJzE3cHgnIH0gfSwgbWVzc2FnZSksCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBtdDInIH0sCiAgICAgICAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGdob3N0IGdyb3cnLCBvbkNsaWNrOiAoKSA9PiB7IGNsb3NlKCk7IHJlc29sdmUoZmFsc2UpOyB9IH0sIHQoJ2NhbmNlbCcpKSwKICAgICAgICAgIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZ3JvdycsIG9uQ2xpY2s6ICgpID0+IHsgY2xvc2UoKTsgcmVzb2x2ZSh0cnVlKTsgfSB9LCBva0xhYmVsKSkpOwogICAgfSk7CiAgfSk7Cn0KCi8vIC0tLS0gc21hbGwgY29tcG9uZW50cyAtLS0tCmV4cG9ydCBmdW5jdGlvbiBsb2dvU3ZnKHNpemUgPSAzOCkgewogIGNvbnN0IG5zID0gJ2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJzsKICBjb25zdCBzdmcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMobnMsICdzdmcnKTsKICBzdmcuc2V0QXR0cmlidXRlKCd2aWV3Qm94JywgJzAgMCA5NiA5NicpOyBzdmcuc2V0QXR0cmlidXRlKCd3aWR0aCcsIHNpemUpOyBzdmcuc2V0QXR0cmlidXRlKCdoZWlnaHQnLCBzaXplKTsKICBzdmcuaW5uZXJIVE1MID0gJzxyZWN0IHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiIgcng9IjI0IiBmaWxsPSIjMEIwQjBCIi8+PHJlY3QgeD0iOCIgeT0iOCIgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiByeD0iMTgiIGZpbGw9IiNGMkI3MDUiLz48cGF0aCBkPSJNMjggNTBsMTQgMTQgMjctMzAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzBFM0IyQyIgc3Ryb2tlLXdpZHRoPSIxMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+JzsKICByZXR1cm4gc3ZnOwp9CmV4cG9ydCBjb25zdCBicmFuZCA9IChzaXplID0gMzgpID0+IGgoJ3NwYW4nLCB7IGNsYXNzOiAnYnJhbmQnIH0sIGxvZ29Tdmcoc2l6ZSksIGgoJ3NwYW4nLCB7IGNsYXNzOiAnbmFtZSBnb2xkLXRleHQnIH0sIHQoJ2FwcF9uYW1lJykpKTsKCmV4cG9ydCBjb25zdCBzdGFycyA9IChhdmcsIGNvdW50KSA9PiAoY291bnQgPyBoKCdzcGFuJywgeyBjbGFzczogJ3N0YXJzJyB9LCBg4q2QICR7TnVtYmVyKGF2ZykudG9GaXhlZCgxKX1gLCBoKCdzcGFuJywgeyBjbGFzczogJ211dGVkIHRpbnknIH0sIGAgKCR7Y291bnR9KWApKSA6IGgoJ3NwYW4nLCB7IGNsYXNzOiAnbXV0ZWQgdGlueScgfSwgdCgnbm9fcmV2aWV3cycpKSk7CmV4cG9ydCBjb25zdCB2ZXJpZmllZEJhZGdlID0gKHYpID0+ICh2ID8gaCgnc3BhbicsIHsgY2xhc3M6ICd2ZXJpZmllZCcgfSwgYOKckyAke3QoJ3ZlcmlmaWVkX3NlbGxlcicpfWApIDogaCgnc3BhbicsIHsgY2xhc3M6ICdtdXRlZCB0aW55JyB9LCB0KCdub3RfdmVyaWZpZWQnKSkpOwoKY29uc3QgU1RBVFVTX1NURVBTID0gWydORVcnLCAnU0VBUkNISU5HJywgJ09GRkVSU19GT1VORCcsICdDT01QQVJJTkcnLCAnVVNFUl9TRUxFQ1RFRCcsICdJTl9QUk9HUkVTUycsICdDT01QTEVURUQnXTsKZXhwb3J0IGNvbnN0IHN0YXR1c0xhYmVsID0gKHMpID0+IHQoYHN0YXR1c18ke3N9YCk7CmV4cG9ydCBjb25zdCBzdGF0dXNQaWxsID0gKHMpID0+IGgoJ3NwYW4nLCB7IGNsYXNzOiAncm93IHNtYWxsIGInLCBzdHlsZTogeyBnYXA6ICc2cHgnLCBkaXNwbGF5OiAnaW5saW5lLWZsZXgnIH0gfSwgaCgnaScsIHsgY2xhc3M6IGBkb3QtcyBzdC0ke3N9YCB9KSwgc3RhdHVzTGFiZWwocykpOwpleHBvcnQgZnVuY3Rpb24gdGltZWxpbmUoc3RhdHVzKSB7CiAgY29uc3QgaWR4ID0gc3RhdHVzID09PSAnQ0FOQ0VMTEVEJyA/IC0xIDogU1RBVFVTX1NURVBTLmluZGV4T2Yoc3RhdHVzKTsKICByZXR1cm4gaCgnZGl2JywgeyBjbGFzczogJ3RpbWVsaW5lJyB9LCBTVEFUVVNfU1RFUFMuc2xpY2UoMSkubWFwKChfLCBpKSA9PiBoKCdpJywgeyBjbGFzczogaSArIDEgPD0gaWR4ID8gJ29uJyA6ICcnIH0pKSk7Cn0KZXhwb3J0IGNvbnN0IGNvbmRpdGlvbkxhYmVsID0gKGMpID0+IChjID8gdChgY29uZF8ke2N9YCkgOiAnJyk7CgpleHBvcnQgZnVuY3Rpb24gY2F0ZWdvcnlPZihtZXRhLCBzbHVnKSB7IHJldHVybiBtZXRhLmNhdGVnb3JpZXMuZmluZCgoYykgPT4gYy5zbHVnID09PSBzbHVnKTsgfQpleHBvcnQgY29uc3QgY2F0SWNvbiA9IChtZXRhLCBzbHVnKSA9PiBjYXRlZ29yeU9mKG1ldGEsIHNsdWcpPy5pY29uIHx8ICfwn5OmJzsKZXhwb3J0IGNvbnN0IGNhdE5hbWUgPSAobWV0YSwgc2x1ZykgPT4gbmFtZU9mKGNhdGVnb3J5T2YobWV0YSwgc2x1ZykpIHx8IHNsdWc7CgpleHBvcnQgZnVuY3Rpb24gZmllbGQobGFiZWwsIGlucHV0LCBoaW50KSB7CiAgcmV0dXJuIGgoJ2RpdicsIHsgY2xhc3M6ICdmaWVsZCcgfSwgbGFiZWwgJiYgaCgnbGFiZWwnLCBudWxsLCBsYWJlbCksIGlucHV0LCBoaW50ICYmIGgoJ2RpdicsIHsgY2xhc3M6ICdtdXRlZCB0aW55JyB9LCBoaW50KSk7Cn0KZXhwb3J0IGZ1bmN0aW9uIHNlbGVjdChvcHRpb25zLCB2YWx1ZSwgcHJvcHMgPSB7fSkgewogIGNvbnN0IGVsID0gaCgnc2VsZWN0JywgeyBjbGFzczogJ2lucHV0JywgLi4ucHJvcHMgfSwgb3B0aW9ucy5tYXAoKFt2LCBsXSkgPT4gaCgnb3B0aW9uJywgeyB2YWx1ZTogdiwgc2VsZWN0ZWQ6IFN0cmluZyh2KSA9PT0gU3RyaW5nKHZhbHVlID8/ICcnKSB9LCBsKSkpOwogIHJldHVybiBlbDsKfQpleHBvcnQgZnVuY3Rpb24gZW1wdHlTdGF0ZShlbW9qaSwgdGV4dCwgYWN0aW9uKSB7CiAgcmV0dXJuIGgoJ2RpdicsIHsgY2xhc3M6ICdlbXB0eScgfSwgaCgnc3BhbicsIHsgY2xhc3M6ICdlJyB9LCBlbW9qaSksIGgoJ2RpdicsIG51bGwsIHRleHQpLCBhY3Rpb24gJiYgaCgnZGl2JywgeyBjbGFzczogJ210MicgfSwgYWN0aW9uKSk7Cn0KZXhwb3J0IGNvbnN0IHNrZWxldG9uID0gKG4gPSAzKSA9PiBoKCdkaXYnLCBudWxsLCBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuIH0sICgpID0+IGgoJ2RpdicsIHsgY2xhc3M6ICdza2VsZXRvbicgfSkpKTsKCmV4cG9ydCBhc3luYyBmdW5jdGlvbiBndWFyZGVkKGJ0biwgZm4pIHsKICBpZiAoYnRuLmRpc2FibGVkKSByZXR1cm47CiAgY29uc3Qgb2xkID0gYnRuLnRleHRDb250ZW50OyBidG4uZGlzYWJsZWQgPSB0cnVlOwogIHRyeSB7IHJldHVybiBhd2FpdCBmbigpOyB9CiAgY2F0Y2ggKGUpIHsgdG9hc3QoZXJyTXNnKGUpLCAnZXJyJyk7IH0KICBmaW5hbGx5IHsgYnRuLmRpc2FibGVkID0gZmFsc2U7IGlmICghYnRuLmlzQ29ubmVjdGVkKSByZXR1cm47IGlmIChidG4udGV4dENvbnRlbnQgPT09ICcnKSBidG4udGV4dENvbnRlbnQgPSBvbGQ7IH0KfQpleHBvcnQgeyB0LCBuZiwgbW9uZXksIG5hbWVPZiwgbGFuZyB9Owo=", "base64") },
  "js/api.js": { path: "js/api.js", buf: Buffer.from("Ly8gVGhpbiBmZXRjaCB3cmFwcGVyLiBUaGUgSldULWxpa2UgdG9rZW4gbGl2ZXMgaW4gbG9jYWxTdG9yYWdlOyBhbGwgc2VjcmV0cyBzdGF5IG9uIHRoZSBzZXJ2ZXIuCmNvbnN0IEtFWSA9ICdic190b2tlbic7CmxldCBtZW1Ub2tlbiA9IG51bGw7CmV4cG9ydCBjb25zdCBnZXRUb2tlbiA9ICgpID0+IHsgaWYgKG1lbVRva2VuKSByZXR1cm4gbWVtVG9rZW47IHRyeSB7IHJldHVybiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShLRVkpOyB9IGNhdGNoIHsgcmV0dXJuIG51bGw7IH0gfTsKZXhwb3J0IGNvbnN0IHNldFRva2VuID0gKHQpID0+IHsgbWVtVG9rZW4gPSB0IHx8IG51bGw7IHRyeSB7IHQgPyBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShLRVksIHQpIDogbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oS0VZKTsgfSBjYXRjaCB7IC8qIHByaXZhdGUgbW9kZSAqLyB9IH07CgpleHBvcnQgY2xhc3MgQXBpRXJyb3IgZXh0ZW5kcyBFcnJvciB7CiAgY29uc3RydWN0b3Ioc3RhdHVzLCBtZXNzYWdlLCBjb2RlKSB7IHN1cGVyKG1lc3NhZ2UpOyB0aGlzLnN0YXR1cyA9IHN0YXR1czsgdGhpcy5jb2RlID0gY29kZTsgfQp9CgpsZXQgb25VbmF1dGhvcml6ZWQgPSAoKSA9PiB7fTsKZXhwb3J0IGNvbnN0IHNldFVuYXV0aG9yaXplZEhhbmRsZXIgPSAoZm4pID0+IHsgb25VbmF1dGhvcml6ZWQgPSBmbjsgfTsKCmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhcGkobWV0aG9kLCBwYXRoLCBib2R5KSB7CiAgY29uc3QgaGVhZGVycyA9IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9OwogIGNvbnN0IHQgPSBnZXRUb2tlbigpOwogIGlmICh0KSBoZWFkZXJzLkF1dGhvcml6YXRpb24gPSBgQmVhcmVyICR7dH1gOwogIGxldCByZXM7CiAgdHJ5IHsgcmVzID0gYXdhaXQgZmV0Y2gocGF0aCwgeyBtZXRob2QsIGhlYWRlcnMsIGJvZHk6IGJvZHkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IEpTT04uc3RyaW5naWZ5KGJvZHkpIH0pOyB9CiAgY2F0Y2ggeyB0aHJvdyBuZXcgQXBpRXJyb3IoMCwgJ29mZmxpbmUnLCAnbmV0d29yaycpOyB9CiAgbGV0IGRhdGEgPSBudWxsOwogIHRyeSB7IGRhdGEgPSBhd2FpdCByZXMuanNvbigpOyB9IGNhdGNoIHsgLyogZW1wdHkgKi8gfQogIGlmICghcmVzLm9rKSB7CiAgICBpZiAocmVzLnN0YXR1cyA9PT0gNDAxICYmIHQpIG9uVW5hdXRob3JpemVkKCk7CiAgICB0aHJvdyBuZXcgQXBpRXJyb3IocmVzLnN0YXR1cywgZGF0YT8uZXJyb3IgfHwgJ2Vycm9yJywgZGF0YT8uY29kZSk7CiAgfQogIHJldHVybiBkYXRhOwp9CmV4cG9ydCBjb25zdCBHRVQgPSAocCkgPT4gYXBpKCdHRVQnLCBwKTsKZXhwb3J0IGNvbnN0IFBPU1QgPSAocCwgYiA9IHt9KSA9PiBhcGkoJ1BPU1QnLCBwLCBiKTsKZXhwb3J0IGNvbnN0IFBBVENIID0gKHAsIGIgPSB7fSkgPT4gYXBpKCdQQVRDSCcsIHAsIGIpOwpleHBvcnQgY29uc3QgREVMRVRFID0gKHApID0+IGFwaSgnREVMRVRFJywgcCk7CgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBsb2FkSW1hZ2UoZmlsZSkgewogIGlmIChmaWxlLnNpemUgPiA2XzAwMF8wMDApIHRocm93IG5ldyBBcGlFcnJvcig0MDAsICdiaWcnLCAndG9vX2xhcmdlJyk7CiAgY29uc3QgZGF0YVVybCA9IGF3YWl0IGRvd25zY2FsZShmaWxlKTsKICByZXR1cm4gUE9TVCgnL2FwaS91cGxvYWQnLCB7IGRhdGE6IGRhdGFVcmwgfSk7Cn0KCi8vIHNocmluayBiaWcgcGhvbmUgcGhvdG9zIGluIHRoZSBicm93c2VyIGJlZm9yZSB1cGxvYWQgKG1heCAxMjgwcHgsIEpQRUcgMC44MikKZnVuY3Rpb24gZG93bnNjYWxlKGZpbGUpIHsKICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgY29uc3QgaW1nID0gbmV3IEltYWdlKCk7CiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGZpbGUpOwogICAgaW1nLm9ubG9hZCA9ICgpID0+IHsKICAgICAgY29uc3QgbWF4ID0gMTI4MDsgY29uc3QgcyA9IE1hdGgubWluKDEsIG1heCAvIE1hdGgubWF4KGltZy53aWR0aCwgaW1nLmhlaWdodCkpOwogICAgICBjb25zdCBjID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7IGMud2lkdGggPSBNYXRoLnJvdW5kKGltZy53aWR0aCAqIHMpOyBjLmhlaWdodCA9IE1hdGgucm91bmQoaW1nLmhlaWdodCAqIHMpOwogICAgICBjLmdldENvbnRleHQoJzJkJykuZHJhd0ltYWdlKGltZywgMCwgMCwgYy53aWR0aCwgYy5oZWlnaHQpOwogICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7CiAgICAgIHJlc29sdmUoYy50b0RhdGFVUkwoJ2ltYWdlL2pwZWcnLCAwLjgyKSk7CiAgICB9OwogICAgaW1nLm9uZXJyb3IgPSAoKSA9PiB7IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTsgcmVqZWN0KG5ldyBBcGlFcnJvcig0MDAsICdiYWQgaW1hZ2UnLCAnYmFkX3R5cGUnKSk7IH07CiAgICBpbWcuc3JjID0gdXJsOwogIH0pOwp9Cg==", "base64") },
  "js/pages/provider.js": { path: "js/pages/provider.js", buf: Buffer.from("aW1wb3J0IHsgR0VULCBQT1NULCBQQVRDSCwgREVMRVRFLCB1cGxvYWRJbWFnZSB9IGZyb20gJy4uL2FwaS5qcyc7CmltcG9ydCB7IGgsIHQsIG5mLCBtb25leSwgbmFtZU9mLCB0b2FzdCwgZXJyTXNnLCBndWFyZGVkLCBtb2RhbCwgY29uZmlybUJveCwgZmllbGQsIHNlbGVjdCwgZW1wdHlTdGF0ZSwgc3RhdHVzUGlsbCwgY29uZGl0aW9uTGFiZWwsIGNhdEljb24sIGNhdE5hbWUsIHN0YXJzIH0gZnJvbSAnLi4vdWkuanMnOwppbXBvcnQgeyBhZ28gfSBmcm9tICcuLi9pMThuLmpzJzsKaW1wb3J0IHsgc3RhdGUsIGdvIH0gZnJvbSAnLi4vY29yZS5qcyc7CmltcG9ydCB7IHJldmlld1NoZWV0LCBjaGF0UGFnZSwgY2hhdHNQYWdlIH0gZnJvbSAnLi91c2VyLmpzJzsKCmNvbnN0IFJPTEVTID0geyByb2xlczogWydwcm92aWRlciddIH07CgpmdW5jdGlvbiBhcHByb3ZhbEJhbm5lcihzKSB7CiAgaWYgKHMuYXBwcm92YWxfc3RhdHVzID09PSAnYXBwcm92ZWQnKSByZXR1cm4gbnVsbDsKICByZXR1cm4gaCgnZGl2JywgeyBjbGFzczogcy5hcHByb3ZhbF9zdGF0dXMgPT09ICdwZW5kaW5nJyA/ICd3YXJuYm94JyA6ICdjYXJkJywgc3R5bGU6IHsgbWFyZ2luQm90dG9tOiAnMTJweCcgfSB9LCBzLmFwcHJvdmFsX3N0YXR1cyA9PT0gJ3BlbmRpbmcnID8gYOKPsyAke3QoJ2F3YWl0aW5nX2FwcHJvdmFsJyl9YCA6IGDim5QgJHt0KCdyZWplY3RlZF9hY2NvdW50Jyl9YCk7Cn0KCmFzeW5jIGZ1bmN0aW9uIGRhc2hib2FyZCgpIHsKICBjb25zdCBzID0gYXdhaXQgR0VUKCcvYXBpL3Byb3ZpZGVyL3N0YXRzJyk7CiAgY29uc3Qgc3RhdCA9IChuLCBsYWJlbCwgaGwpID0+IGgoJ2RpdicsIHsgY2xhc3M6IGBzdGF0JHtobCA/ICcgaGwnIDogJyd9YCB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnbicgfSwgbiksIGgoJ2RpdicsIHsgY2xhc3M6ICdzbWFsbCBtdXRlZCcgfSwgbGFiZWwpKTsKICBjb25zdCBib2R5ID0gaCgnZGl2JywgeyBjbGFzczogJ3N0YWNrJyB9LCBhcHByb3ZhbEJhbm5lcihzKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgc3AnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cnIH0sIHN0YXRlLnByb3ZpZGVyPy52ZXJpZmllZCB8fCBzLnZlcmlmaWVkID8gaCgnc3BhbicsIHsgY2xhc3M6ICdiYWRnZSBncmVlbicgfSwgYOKckyAke3QoJ3ZlcmlmaWVkX3NlbGxlcicpfWApIDogaCgnc3BhbicsIHsgY2xhc3M6ICdiYWRnZScgfSwgdCgnbm90X3ZlcmlmaWVkJykpLCBzdGFycyhzLnJhdGluZ19hdmcsIHMucmF0aW5nX2NvdW50KSksCiAgICAgIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZ2hvc3Qgc20nLCBvbkNsaWNrOiAoKSA9PiBnbygnL3Byb3ZpZGVyL3Byb2ZpbGUnKSB9LCB0KCdlZGl0JykpKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdzdGF0LWdyaWQnIH0sIHN0YXQobW9uZXkocy5lYXJuaW5nc190b3RhbCksIHQoJ2Vhcm5pbmdzJyksIHRydWUpLCBzdGF0KG1vbmV5KHMuZWFybmluZ3NfMzBkKSwgdCgnZWFybmluZ3NfMzAnKSksIHN0YXQobW9uZXkocy5wZW5kaW5nX2Ftb3VudCksIHQoJ3BlbmRpbmdfYW1vdW50JykpLAogICAgICBzdGF0KHMuY29tcGxldGVkX29yZGVycywgdCgnY29tcGxldGVkX29yZGVycycpKSwgc3RhdChzLm9mZmVyc19zZW50LCB0KCdvZmZlcnNfc2VudCcpKSwgc3RhdChzLm9mZmVyc193b24sIHQoJ29mZmVyc193b24nKSkpLAogICAgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBibG9jaycsIG9uQ2xpY2s6ICgpID0+IGdvKCcvcHJvdmlkZXIvcmVxdWVzdHMnKSB9LCBg8J+TpSAke3QoJ2luY29taW5nX3JlcXVlc3RzJyl9YCkpOwogIHJldHVybiB7IHRpdGxlOiB0KCdwcm92X2Rhc2hib2FyZCcpLCBib2R5IH07Cn0KCmFzeW5jIGZ1bmN0aW9uIGluY29taW5nKCkgewogIGxldCBkOwogIHRyeSB7IGQgPSBhd2FpdCBHRVQoJy9hcGkvcHJvdmlkZXIvcmVxdWVzdHMnKTsgfSBjYXRjaCAoZSkgeyBpZiAoZS5jb2RlID09PSAnbm90X2FwcHJvdmVkJykgcmV0dXJuIHsgdGl0bGU6IHQoJ2luY29taW5nX3JlcXVlc3RzJyksIGJvZHk6IGgoJ2RpdicsIHsgY2xhc3M6ICd3YXJuYm94JyB9LCBg4o+zICR7dCgnYXdhaXRpbmdfYXBwcm92YWwnKX1gKSB9OyB0aHJvdyBlOyB9CiAgY29uc3QgYm9keSA9IGQucmVxdWVzdHMubGVuZ3RoID8gZC5yZXF1ZXN0cy5tYXAoKHIpID0+IGgoJ2RpdicsIHsgY2xhc3M6ICdsaXN0LWl0ZW0nLCBvbkNsaWNrOiAoKSA9PiBnbyhgL3Byb3ZpZGVyL3JlcXVlc3QvJHtyLmlkfWApIH0sCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnYXZhdGFyJyB9LCBjYXRJY29uKHN0YXRlLm1ldGEsIHIuY2F0ZWdvcnkpKSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgc3AnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiJyB9LCB0KCdyZXF1ZXN0X24nLCB7IG46IHIubnVtYmVyIH0pKSwgci5teV9vZmZlcl9pZCA/IGgoJ3NwYW4nLCB7IGNsYXNzOiAnYmFkZ2UgZ3JlZW4nIH0sIGDinJMgJHt0KCdteV9vZmZlcicpfWApIDogbnVsbCksCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdzbWFsbCcgfSwgci5yYXdfdGV4dCksIGgoJ2RpdicsIHsgY2xhc3M6ICdzbWFsbCBtdXRlZCcgfSwgW3IubG9jYXRpb25fbGFiZWwgJiYgYPCfk40gJHtyLmxvY2F0aW9uX2xhYmVsfWAsIHIuYnVkZ2V0X21heCAmJiBg8J+SsCAke21vbmV5KHIuYnVkZ2V0X21heCl9YCwgYWdvKHIuY3JlYXRlZF9hdCldLmZpbHRlcihCb29sZWFuKS5qb2luKCcg4oCiICcpKSkpKSA6IGVtcHR5U3RhdGUoJ/Cfk6UnLCB0KCdub19pbmNvbWluZycpKTsKICByZXR1cm4geyB0aXRsZTogdCgnaW5jb21pbmdfcmVxdWVzdHMnKSwgYm9keSB9Owp9Cgphc3luYyBmdW5jdGlvbiByZXF1ZXN0RGV0YWlsKHsgcGFyYW1zIH0pIHsKICBjb25zdCBkID0gYXdhaXQgR0VUKGAvYXBpL3Byb3ZpZGVyL3JlcXVlc3RzLyR7cGFyYW1zLmlkfWApOyBjb25zdCByID0gZC5yZXF1ZXN0OwogIGNvbnN0IHRpdGxlID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCB2YWx1ZTogci5wcm9kdWN0X29yX3NlcnZpY2UgfHwgJycgfSk7IGNvbnN0IHByaWNlID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCB0eXBlOiAnbnVtYmVyJywgaW5wdXRtb2RlOiAnbnVtZXJpYycsIG1pbjogMSB9KTsKICBjb25zdCBkZWxpdmVyeSA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgdHlwZTogJ251bWJlcicsIGlucHV0bW9kZTogJ251bWVyaWMnLCBtaW46IDAsIHZhbHVlOiAwIH0pOyBjb25zdCB0aW1lID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCBwbGFjZWhvbGRlcjogJzI0aCAvIDMgam91cnPigKYnIH0pOwogIGNvbnN0IGRlc2MgPSBoKCd0ZXh0YXJlYScsIHsgY2xhc3M6ICdpbnB1dCcgfSk7CiAgY29uc3QgY29uZCA9IHNlbGVjdChbWycnLCB0KCdjb25kX2FueScpXSwgWyduZXcnLCB0KCdjb25kX25ldycpXSwgWyd1c2VkX2V4Y2VsbGVudCcsIHQoJ2NvbmRfdXNlZF9leGNlbGxlbnQnKV0sIFsndXNlZF9nb29kJywgdCgnY29uZF91c2VkX2dvb2QnKV0sIFsndXNlZF9mYWlyJywgdCgnY29uZF91c2VkX2ZhaXInKV1dLCAnJyk7CiAgbGV0IGltYWdlID0gbnVsbDsgY29uc3QgZmlsZSA9IGgoJ2lucHV0JywgeyB0eXBlOiAnZmlsZScsIGFjY2VwdDogJ2ltYWdlLyonLCBjbGFzczogJ2hpZGRlbicgfSk7IGNvbnN0IGltZ0luZm8gPSBoKCdzcGFuJywgeyBjbGFzczogJ3NtYWxsIG11dGVkJyB9KTsKICBmaWxlLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIGFzeW5jICgpID0+IHsgdHJ5IHsgaW1hZ2UgPSAoYXdhaXQgdXBsb2FkSW1hZ2UoZmlsZS5maWxlc1swXSkpLnVybDsgaW1nSW5mby50ZXh0Q29udGVudCA9ICfinJMnOyB9IGNhdGNoIChlKSB7IHRvYXN0KGVyck1zZyhlKSwgJ2VycicpOyB9IH0pOwogIGNvbnN0IGJvZHkgPSBoKCdkaXYnLCB7IGNsYXNzOiAnc3RhY2snIH0sCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnY2FyZCcgfSwgaCgnZGl2JywgeyBjbGFzczogJ2InIH0sIGAke3QoJ2N1c3RvbWVyX3JlcXVlc3QnKX0gIyR7ci5udW1iZXJ9YCksIGgoJ3AnLCBudWxsLCBgwqske3IucmF3X3RleHR9wrtgKSwgaCgnZGl2JywgeyBjbGFzczogJ3NtYWxsIG11dGVkJyB9LCBbci5sb2NhdGlvbl9sYWJlbCAmJiBg8J+TjSAke3IubG9jYXRpb25fbGFiZWx9YCwgci5idWRnZXRfbWF4ICE9IG51bGwgJiYgYPCfkrAgJHt0KCdidWRnZXRfdXBfdG8nLCB7IHY6IG1vbmV5KHIuYnVkZ2V0X21heCkgfSl9YCwgYCR7ZC5vZmZlcnNfY291bnR9ICR7dCgnb2ZmZXJzX2NvdW50JywgeyBuOiAnJyB9KX1gXS5maWx0ZXIoQm9vbGVhbikuam9pbignIOKAoiAnKSkpLAogICAgZC5teV9vZmZlcnMubGVuZ3RoID8gaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiIG1iJyB9LCBg4pyTICR7dCgnbXlfb2ZmZXInKX1gKSwgZC5teV9vZmZlcnMubWFwKChvKSA9PiBoKCdkaXYnLCB7IGNsYXNzOiAncm93IHNwJyB9LCBoKCdkaXYnLCBudWxsLCBvLnRpdGxlLCBoKCdkaXYnLCB7IGNsYXNzOiAnYicgfSwgbW9uZXkoby5wcmljZSkpKSwKICAgICAgby5zdGF0dXMgPT09ICdhY3RpdmUnICYmIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZGFuZ2VyIHNtJywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7IGF3YWl0IERFTEVURShgL2FwaS9wcm92aWRlci9vZmZlcnMvJHtvLmlkfWApOyBnbyhgL3Byb3ZpZGVyL3JlcXVlc3QvJHtyLmlkfT9yPSR7RGF0ZS5ub3coKX1gKTsgfSkgfSwgdCgnd2l0aGRyYXcnKSkpKSwKICAgICAgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBnaG9zdCBibG9jayBtdCcsIG9uQ2xpY2s6ICgpID0+IGdvKGAvcHJvdmlkZXIvY2hhdC8ke3IuaWR9LyR7c3RhdGUucHJvdmlkZXIuaWR9YCkgfSwgYPCfkqwgJHt0KCdjaGF0Jyl9YCkpCiAgICAgIDogaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiIG1iJyB9LCB0KCdzZW5kX29mZmVyJykpLCBmaWVsZCh0KCdvZmZlcl90aXRsZScpLCB0aXRsZSksIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBmaWVsZCh0KCdvZmZlcl9wcmljZScpLCBwcmljZSkpLCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgZmllbGQodCgnb2ZmZXJfZGVsaXZlcnknKSwgZGVsaXZlcnkpKSksCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdycgfSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGZpZWxkKHQoJ29mZmVyX3RpbWUnKSwgdGltZSkpLCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgZmllbGQodCgnY29uZGl0aW9uJyksIGNvbmQpKSksIGZpZWxkKHQoJ29mZmVyX2Rlc2MnKSwgZGVzYyksCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBtYicgfSwgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBnaG9zdCBzbScsIG9uQ2xpY2s6ICgpID0+IGZpbGUuY2xpY2soKSB9LCBg8J+TtyAke3QoJ3Bob3RvcycpfWApLCBpbWdJbmZvLCBmaWxlKSwKICAgICAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7CiAgICAgICAgICBhd2FpdCBQT1NUKGAvYXBpL3Byb3ZpZGVyL3JlcXVlc3RzLyR7ci5pZH0vb2ZmZXJzYCwgeyB0aXRsZTogdGl0bGUudmFsdWUsIHByaWNlOiBOdW1iZXIocHJpY2UudmFsdWUpLCBkZWxpdmVyeV9wcmljZTogTnVtYmVyKGRlbGl2ZXJ5LnZhbHVlIHx8IDApLCBlc3RpbWF0ZWRfdGltZTogdGltZS52YWx1ZSwgY29uZGl0aW9uOiBjb25kLnZhbHVlIHx8IHVuZGVmaW5lZCwgZGVzY3JpcHRpb246IGRlc2MudmFsdWUsIGltYWdlX3VybDogaW1hZ2UgfHwgdW5kZWZpbmVkIH0pOwogICAgICAgICAgdG9hc3QodCgnb2ZmZXJfc2VudCcpLCAnb2snKTsgZ28oYC9wcm92aWRlci9yZXF1ZXN0LyR7ci5pZH0/cj0ke0RhdGUubm93KCl9YCk7IH0pIH0sIHQoJ3NlbmRfb2ZmZXInKSkpKTsKICByZXR1cm4geyB0aXRsZTogdCgncmVxdWVzdF9uJywgeyBuOiByLm51bWJlciB9KSwgYmFjazogJy9wcm92aWRlci9yZXF1ZXN0cycsIGJvZHkgfTsKfQoKYXN5bmMgZnVuY3Rpb24gb3JkZXJzKCkgewogIGNvbnN0IHsgb3JkZXJzOiBsaXN0IH0gPSBhd2FpdCBHRVQoJy9hcGkvcHJvdmlkZXIvb3JkZXJzJyk7CiAgY29uc3QgYm9keSA9IGxpc3QubGVuZ3RoID8gbGlzdC5tYXAoKG8pID0+IGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkJyB9LAogICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBzcCcgfSwgaCgnZGl2JywgeyBjbGFzczogJ2InIH0sIHQoJ3JlcXVlc3RfbicsIHsgbjogby5udW1iZXIgfSkpLCBzdGF0dXNQaWxsKG8uc3RhdHVzID09PSAnUEVORElORycgPyAnVVNFUl9TRUxFQ1RFRCcgOiBvLnN0YXR1cykpLAogICAgaCgnZGl2JywgeyBjbGFzczogJ2IgbXQnIH0sIG8ub2ZmZXJfdGl0bGUpLCBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQnIH0sIGAke3QoJ2N1c3RvbWVyJyl9OiAke28uY3VzdG9tZXJfbmFtZX1gKSwKICAgIG8uY3VzdG9tZXJfcGhvbmUgJiYgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBzcCBtdCcgfSwgaCgnc3BhbicsIHsgY2xhc3M6ICdsdHIgYicgfSwgby5jdXN0b21lcl9waG9uZSksIGgoJ2EnLCB7IGNsYXNzOiAnYnRuIHNtJywgaHJlZjogYHRlbDoke28uY3VzdG9tZXJfcGhvbmV9YCB9LCBg8J+TniAke3QoJ2NhbGwnKX1gKSksCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXQnIH0sIGAke3QoJ3NlbGxlcl9wcmljZScpfTogJHttb25leShvLml0ZW1fcHJpY2UpfSDigKIgJHt0KCdkZWxpdmVyeV9mZWUnKX06ICR7bW9uZXkoby5kZWxpdmVyeV9wcmljZSl9YCksIGgoJ2RpdicsIHsgY2xhc3M6ICdiJyB9LCBgJHt0KCd5b3VyX25ldCcpfTogJHttb25leShvLnlvdXJfbmV0KX1gKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgbXQnIH0sCiAgICAgIG8uc3RhdHVzID09PSAnUEVORElORycgJiYgW2goJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gc20gZ3JvdycsIG9uQ2xpY2s6IChlKSA9PiBndWFyZGVkKGUuY3VycmVudFRhcmdldCwgYXN5bmMgKCkgPT4geyBhd2FpdCBQT1NUKGAvYXBpL3Byb3ZpZGVyL29yZGVycy8ke28uaWR9L2FjY2VwdGApOyBnbyhgL3Byb3ZpZGVyL29yZGVycz9yPSR7RGF0ZS5ub3coKX1gKTsgfSkgfSwgdCgnYWNjZXB0X29yZGVyJykpLAogICAgICAgIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZGFuZ2VyIHNtIGdyb3cnLCBvbkNsaWNrOiAoZSkgPT4gZ3VhcmRlZChlLmN1cnJlbnRUYXJnZXQsIGFzeW5jICgpID0+IHsgaWYgKGF3YWl0IGNvbmZpcm1Cb3godCgnZGVjbGluZV9vcmRlcicpKSkgeyBhd2FpdCBQT1NUKGAvYXBpL3Byb3ZpZGVyL29yZGVycy8ke28uaWR9L2RlY2xpbmVgKTsgZ28oYC9wcm92aWRlci9vcmRlcnM/cj0ke0RhdGUubm93KCl9YCk7IH0gfSkgfSwgdCgnZGVjbGluZV9vcmRlcicpKV0sCiAgICAgIG8uc3RhdHVzICE9PSAnQ0FOQ0VMTEVEJyAmJiBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGdob3N0IHNtIGdyb3cnLCBvbkNsaWNrOiAoKSA9PiBnbyhgL3Byb3ZpZGVyL2NoYXQvJHtvLnJlcXVlc3RfaWR9LyR7c3RhdGUucHJvdmlkZXIuaWR9YCkgfSwgYPCfkqwgJHt0KCdjaGF0Jyl9YCksCiAgICAgIG8uc3RhdHVzID09PSAnQ09NUExFVEVEJyAmJiAhby5yZXZpZXdlZCAmJiBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIHNtIGdyb3cnLCBvbkNsaWNrOiAoKSA9PiByZXZpZXdTaGVldChvLmlkLCB0KCdyYXRlX2N1c3RvbWVyJyksICgpID0+IGdvKGAvcHJvdmlkZXIvb3JkZXJzP3I9JHtEYXRlLm5vdygpfWApKSB9LCBg4q2QICR7dCgncmF0ZV9jdXN0b21lcicpfWApKSkpIDogZW1wdHlTdGF0ZSgn8J+nvicsIHQoJ25vX29yZGVycycpKTsKICByZXR1cm4geyB0aXRsZTogdCgnb3JkZXJzJyksIGJvZHkgfTsKfQoKYXN5bmMgZnVuY3Rpb24gY2F0YWxvZygpIHsKICBjb25zdCBbeyBwcm9kdWN0cyB9LCB7IHNlcnZpY2VzIH1dID0gYXdhaXQgUHJvbWlzZS5hbGwoW0dFVCgnL2FwaS9wcm92aWRlci9wcm9kdWN0cycpLCBHRVQoJy9hcGkvcHJvdmlkZXIvc2VydmljZXMnKV0pOwogIGNvbnN0IGNhdE9wdHMgPSBzdGF0ZS5tZXRhLmNhdGVnb3JpZXMubWFwKChjKSA9PiBbYy5zbHVnLCBgJHtjLmljb259ICR7bmFtZU9mKGMpfWBdKTsKICBjb25zdCBwcm9kdWN0Rm9ybSA9ICgpID0+IG1vZGFsKChzLCBjbG9zZSkgPT4gewogICAgY29uc3QgdGkgPSBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcgfSksIHByID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCB0eXBlOiAnbnVtYmVyJywgbWluOiAxIH0pLCBiciA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JyB9KSwgZGUgPSBoKCd0ZXh0YXJlYScsIHsgY2xhc3M6ICdpbnB1dCcgfSk7CiAgICBjb25zdCBjYSA9IHNlbGVjdChjYXRPcHRzLCAnZWxlY3Ryb25pY3MnKTsgY29uc3QgY28gPSBzZWxlY3QoW1snbmV3JywgdCgnY29uZF9uZXcnKV0sIFsndXNlZF9leGNlbGxlbnQnLCB0KCdjb25kX3VzZWRfZXhjZWxsZW50JyldLCBbJ3VzZWRfZ29vZCcsIHQoJ2NvbmRfdXNlZF9nb29kJyldLCBbJ3VzZWRfZmFpcicsIHQoJ2NvbmRfdXNlZF9mYWlyJyldXSwgJ25ldycpOwogICAgbGV0IGltZyA9IG51bGw7IGNvbnN0IGZpbGUgPSBoKCdpbnB1dCcsIHsgdHlwZTogJ2ZpbGUnLCBhY2NlcHQ6ICdpbWFnZS8qJywgY2xhc3M6ICdoaWRkZW4nIH0pOyBjb25zdCBpbmZvID0gaCgnc3BhbicsIHsgY2xhc3M6ICdzbWFsbCBtdXRlZCcgfSk7CiAgICBmaWxlLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIGFzeW5jICgpID0+IHsgdHJ5IHsgaW1nID0gKGF3YWl0IHVwbG9hZEltYWdlKGZpbGUuZmlsZXNbMF0pKS51cmw7IGluZm8udGV4dENvbnRlbnQgPSAn4pyTJzsgfSBjYXRjaCAoZSkgeyB0b2FzdChlcnJNc2coZSksICdlcnInKTsgfSB9KTsKICAgIHMuYXBwZW5kKGgoJ2gzJywgeyBjbGFzczogJ21iJyB9LCB0KCdhZGRfcHJvZHVjdCcpKSwgZmllbGQodCgndGl0bGUnKSwgdGkpLCBoKCdkaXYnLCB7IGNsYXNzOiAncm93JyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgZmllbGQodCgnY2F0ZWdvcnknKSwgY2EpKSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGZpZWxkKHQoJ2NvbmRpdGlvbicpLCBjbykpKSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdycgfSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGZpZWxkKHQoJ3ByaWNlJyksIHByKSksIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBmaWVsZCh0KCdicmFuZCcpLCBicikpKSwgZmllbGQodCgnZGVzY3JpcHRpb24nKSwgZGUpLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93IG1iJyB9LCBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGdob3N0IHNtJywgb25DbGljazogKCkgPT4gZmlsZS5jbGljaygpIH0sIGDwn5O3ICR7dCgncGhvdG9zJyl9YCksIGluZm8sIGZpbGUpLAogICAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7IGF3YWl0IFBPU1QoJy9hcGkvcHJvdmlkZXIvcHJvZHVjdHMnLCB7IHRpdGxlOiB0aS52YWx1ZSwgcHJpY2U6IE51bWJlcihwci52YWx1ZSksIGJyYW5kOiBici52YWx1ZSwgZGVzY3JpcHRpb246IGRlLnZhbHVlLCBjYXRlZ29yeV9zbHVnOiBjYS52YWx1ZSwgY29uZGl0aW9uOiBjby52YWx1ZSwgaW1hZ2VzOiBpbWcgPyBbaW1nXSA6IFtdIH0pOyBjbG9zZSgpOyBnbyhgL3Byb3ZpZGVyL2NhdGFsb2c/cj0ke0RhdGUubm93KCl9YCk7IH0pIH0sIHQoJ3NhdmUnKSkpOwogIH0pOwogIGNvbnN0IHNlcnZpY2VGb3JtID0gKCkgPT4gbW9kYWwoKHMsIGNsb3NlKSA9PiB7CiAgICBjb25zdCB0aSA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JyB9KSwgcGYgPSBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcsIHR5cGU6ICdudW1iZXInLCBtaW46IDAgfSksIHB0ID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCB0eXBlOiAnbnVtYmVyJywgbWluOiAwIH0pLCBkZSA9IGgoJ3RleHRhcmVhJywgeyBjbGFzczogJ2lucHV0JyB9KTsKICAgIGNvbnN0IGNhID0gc2VsZWN0KGNhdE9wdHMsICdyZXBhaXItc2VydmljZXMnKTsKICAgIHMuYXBwZW5kKGgoJ2gzJywgeyBjbGFzczogJ21iJyB9LCB0KCdhZGRfc2VydmljZScpKSwgZmllbGQodCgndGl0bGUnKSwgdGkpLCBmaWVsZCh0KCdjYXRlZ29yeScpLCBjYSksIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBmaWVsZCh0KCdwcmljZV9mcm9tJyksIHBmKSksIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBmaWVsZCh0KCdwcmljZV90bycpLCBwdCkpKSwgZmllbGQodCgnZGVzY3JpcHRpb24nKSwgZGUpLAogICAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7IGF3YWl0IFBPU1QoJy9hcGkvcHJvdmlkZXIvc2VydmljZXMnLCB7IHRpdGxlOiB0aS52YWx1ZSwgcHJpY2VfZnJvbTogcGYudmFsdWUgPT09ICcnID8gbnVsbCA6IE51bWJlcihwZi52YWx1ZSksIHByaWNlX3RvOiBwdC52YWx1ZSA9PT0gJycgPyBudWxsIDogTnVtYmVyKHB0LnZhbHVlKSwgZGVzY3JpcHRpb246IGRlLnZhbHVlLCBjYXRlZ29yeV9zbHVnOiBjYS52YWx1ZSB9KTsgY2xvc2UoKTsgZ28oYC9wcm92aWRlci9jYXRhbG9nP3I9JHtEYXRlLm5vdygpfWApOyB9KSB9LCB0KCdzYXZlJykpKTsKICB9KTsKICBjb25zdCByb3cgPSAodGl0bGUsIHByaWNlLCBhY3RpdmUsIG9uRGVsKSA9PiBoKCdkaXYnLCB7IGNsYXNzOiAnbGlzdC1pdGVtJywgc3R5bGU6IHsgY3Vyc29yOiAnZGVmYXVsdCcsIG9wYWNpdHk6IGFjdGl2ZSA/IDEgOiAuNSB9IH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnYicgfSwgdGl0bGUpLCBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQnIH0sIHByaWNlKSwgIWFjdGl2ZSAmJiBoKCdzcGFuJywgeyBjbGFzczogJ2JhZGdlJyB9LCB0KCdoaWRkZW4nKSkpLCBhY3RpdmUgJiYgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBkYW5nZXIgc20nLCBvbkNsaWNrOiAoZSkgPT4gZ3VhcmRlZChlLmN1cnJlbnRUYXJnZXQsIG9uRGVsKSB9LCB0KCdkZWxldGUnKSkpOwogIGNvbnN0IGJvZHkgPSBoKCdkaXYnLCB7IGNsYXNzOiAnc3RhY2snIH0sCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93JyB9LCBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGdyb3cnLCBvbkNsaWNrOiBwcm9kdWN0Rm9ybSB9LCBg77yLICR7dCgnYWRkX3Byb2R1Y3QnKX1gKSwgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBkYXJrIGdyb3cnLCBvbkNsaWNrOiBzZXJ2aWNlRm9ybSB9LCBg77yLICR7dCgnYWRkX3NlcnZpY2UnKX1gKSksCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnc2VjdGlvbi10aXRsZScgfSwgdCgncHJvZHVjdHMnKSksIHByb2R1Y3RzLmxlbmd0aCA/IHByb2R1Y3RzLm1hcCgocCkgPT4gcm93KHAudGl0bGUsIGAke21vbmV5KHAucHJpY2UpfSDigKIgJHtjb25kaXRpb25MYWJlbChwLmNvbmRpdGlvbil9YCwgcC5hY3RpdmUsIGFzeW5jICgpID0+IHsgYXdhaXQgREVMRVRFKGAvYXBpL3Byb3ZpZGVyL3Byb2R1Y3RzLyR7cC5pZH1gKTsgZ28oYC9wcm92aWRlci9jYXRhbG9nP3I9JHtEYXRlLm5vdygpfWApOyB9KSkgOiBoKCdkaXYnLCB7IGNsYXNzOiAnbXV0ZWQnIH0sICfigJQnKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdzZWN0aW9uLXRpdGxlJyB9LCB0KCdzZXJ2aWNlcycpKSwgc2VydmljZXMubGVuZ3RoID8gc2VydmljZXMubWFwKCh4KSA9PiByb3coeC50aXRsZSwgeC5wcmljZV9mcm9tICE9IG51bGwgPyBtb25leSh4LnByaWNlX2Zyb20pICsgKHgucHJpY2VfdG8gPyBgIOKAkyAke21vbmV5KHgucHJpY2VfdG8pfWAgOiAnJykgOiAnJywgeC5hY3RpdmUsIGFzeW5jICgpID0+IHsgYXdhaXQgREVMRVRFKGAvYXBpL3Byb3ZpZGVyL3NlcnZpY2VzLyR7eC5pZH1gKTsgZ28oYC9wcm92aWRlci9jYXRhbG9nP3I9JHtEYXRlLm5vdygpfWApOyB9KSkgOiBoKCdkaXYnLCB7IGNsYXNzOiAnbXV0ZWQnIH0sICfigJQnKSk7CiAgcmV0dXJuIHsgdGl0bGU6IHQoJ2NhdGFsb2cnKSwgYm9keSB9Owp9Cgphc3luYyBmdW5jdGlvbiBwcm9maWxlRWRpdCgpIHsKICBjb25zdCB7IHByb3ZpZGVyOiBwIH0gPSBhd2FpdCBHRVQoJy9hcGkvcHJvdmlkZXIvcHJvZmlsZScpOwogIGNvbnN0IGJuID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCB2YWx1ZTogcC5idXNpbmVzc19uYW1lIH0pLCBhYyA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgdmFsdWU6IHAuYWN0aXZpdHkgfHwgJycgfSksIGRlID0gaCgndGV4dGFyZWEnLCB7IGNsYXNzOiAnaW5wdXQnIH0sIHAuZGVzY3JpcHRpb24gfHwgJycpLCB3aCA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgdmFsdWU6IHAud29ya2luZ19ob3VycyB8fCAnJyB9KTsKICBjb25zdCBjYXRzID0gbmV3IFNldChwLmNhdGVnb3J5X3NsdWdzKTsKICBjb25zdCBjaGlwcyA9IGgoJ2RpdicsIHsgY2xhc3M6ICdjaGlwcycgfSwgc3RhdGUubWV0YS5jYXRlZ29yaWVzLm1hcCgoYykgPT4geyBjb25zdCBlbCA9IGgoJ2J1dHRvbicsIHsgdHlwZTogJ2J1dHRvbicsIGNsYXNzOiBgY2hpcCBsaWdodCR7Y2F0cy5oYXMoYy5zbHVnKSA/ICcgb24nIDogJyd9YCwgb25DbGljazogKCkgPT4geyBjYXRzLmhhcyhjLnNsdWcpID8gY2F0cy5kZWxldGUoYy5zbHVnKSA6IGNhdHMuYWRkKGMuc2x1Zyk7IGVsLmNsYXNzTGlzdC50b2dnbGUoJ29uJyk7IH0gfSwgYCR7Yy5pY29ufSAke25hbWVPZihjKX1gKTsgcmV0dXJuIGVsOyB9KSk7CiAgY29uc3QgYm9keSA9IGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkJyB9LCBmaWVsZCh0KCdidXNpbmVzc19uYW1lJyksIGJuKSwgZmllbGQodCgnYWN0aXZpdHknKSwgYWMpLCBmaWVsZCh0KCdkZXNjcmlwdGlvbicpLCBkZSksIGZpZWxkKHQoJ3dvcmtpbmdfaG91cnMnKSwgd2gpLCBmaWVsZCh0KCdjYXRlZ29yaWVzX3NlcnZlZCcpLCBjaGlwcyksCiAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7IGF3YWl0IFBBVENIKCcvYXBpL3Byb3ZpZGVyL3Byb2ZpbGUnLCB7IGJ1c2luZXNzX25hbWU6IGJuLnZhbHVlLCBhY3Rpdml0eTogYWMudmFsdWUsIGRlc2NyaXB0aW9uOiBkZS52YWx1ZSwgd29ya2luZ19ob3Vyczogd2gudmFsdWUsIGNhdGVnb3J5X3NsdWdzOiBbLi4uY2F0c10gfSk7IHRvYXN0KHQoJ3NhdmVkJyksICdvaycpOyBnbygnL3Byb3ZpZGVyJyk7IH0pIH0sIHQoJ3NhdmUnKSkpOwogIHJldHVybiB7IHRpdGxlOiB0KCdwcm9maWxlJyksIGJhY2s6ICcvcHJvdmlkZXInLCBib2R5IH07Cn0KCmV4cG9ydCBjb25zdCBwcm92aWRlclJvdXRlcyA9IFsKICBbJy9wcm92aWRlcicsIGRhc2hib2FyZCwgUk9MRVNdLCBbJy9wcm92aWRlci9yZXF1ZXN0cycsIGluY29taW5nLCBST0xFU10sIFsnL3Byb3ZpZGVyL3JlcXVlc3QvOmlkJywgcmVxdWVzdERldGFpbCwgUk9MRVNdLCBbJy9wcm92aWRlci9vcmRlcnMnLCBvcmRlcnMsIFJPTEVTXSwKICBbJy9wcm92aWRlci9jYXRhbG9nJywgY2F0YWxvZywgUk9MRVNdLCBbJy9wcm92aWRlci9wcm9maWxlJywgcHJvZmlsZUVkaXQsIFJPTEVTXSwgWycvcHJvdmlkZXIvY2hhdC86cmlkLzpwaWQnLCBjaGF0UGFnZSwgUk9MRVNdLCBbJy9wcm92aWRlci9jaGF0cycsIGNoYXRzUGFnZSwgUk9MRVNdLApdOwo=", "base64") },
  "js/pages/user.js": { path: "js/pages/user.js", buf: Buffer.from("aW1wb3J0IHsgR0VULCBQT1NULCBQQVRDSCwgREVMRVRFLCB1cGxvYWRJbWFnZSB9IGZyb20gJy4uL2FwaS5qcyc7CmltcG9ydCB7IGgsIHQsIG5mLCBtb25leSwgbmFtZU9mLCB0b2FzdCwgZXJyTXNnLCBndWFyZGVkLCBtb2RhbCwgY29uZmlybUJveCwgZmllbGQsIHNlbGVjdCwgZW1wdHlTdGF0ZSwgc2tlbGV0b24sIHN0YXJzLCB2ZXJpZmllZEJhZGdlLCBzdGF0dXNQaWxsLCB0aW1lbGluZSwgY29uZGl0aW9uTGFiZWwsIGNhdEljb24sIGNhdE5hbWUsIGJyYW5kIH0gZnJvbSAnLi4vdWkuanMnOwppbXBvcnQgeyBhZ28sIExPQ0FMRVMsIGdldExvY2FsZSB9IGZyb20gJy4uL2kxOG4uanMnOwppbXBvcnQgeyBzdGF0ZSwgZ28sIGxvZ291dCwgY2hhbmdlTG9jYWxlLCByZWZyZXNoVW5yZWFkIH0gZnJvbSAnLi4vY29yZS5qcyc7CgovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gSE9NRSA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KZnVuY3Rpb24gaG9tZSgpIHsKICBjb25zdCB0YSA9IGgoJ3RleHRhcmVhJywgeyBwbGFjZWhvbGRlcjogdCgnYXNrX3BoJyksIHJvd3M6IDMsIG1heGxlbmd0aDogNjAwLCAnYXJpYS1sYWJlbCc6IHQoJ2Fza19waCcpIH0pOwogIGNvbnN0IHN1Ym1pdCA9ICgpID0+IHsgY29uc3QgdiA9IHRhLnZhbHVlLnRyaW0oKTsgaWYgKHYubGVuZ3RoIDwgMikgcmV0dXJuIHRhLmZvY3VzKCk7IGdvKGAvbmV3P3RleHQ9JHtlbmNvZGVVUklDb21wb25lbnQodil9YCk7IH07CiAgdGEuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIChlKSA9PiB7IGlmIChlLmtleSA9PT0gJ0VudGVyJyAmJiAoZS5jdHJsS2V5IHx8IGUubWV0YUtleSkpIHN1Ym1pdCgpOyB9KTsKICBjb25zdCBleCA9IFtbJ2V4X3Bob25lJywgJ2V4X3Bob25lX2Z1bGwnXSwgWydleF9lbGVjdHJpY2lhbicsICdleF9lbGVjdHJpY2lhbl9mdWxsJ10sIFsnZXhfY2FyJywgJ2V4X2Nhcl9mdWxsJ10sIFsnZXhfZnVybml0dXJlJywgJ2V4X2Z1cm5pdHVyZV9mdWxsJ11dOwogIGNvbnN0IGJvZHkgPSBoKCdkaXYnLCBudWxsLAogICAgaCgnZGl2JywgeyBjbGFzczogJ2hlcm8nIH0sCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgc3AnIH0sIGJyYW5kKDM0KSwgaCgnYScsIHsgY2xhc3M6ICdpY29uYnRuJywgaHJlZjogJyMvbm90aWZpY2F0aW9ucycsIHN0eWxlOiB7IGJhY2tncm91bmQ6ICdyZ2JhKDI1NSwyNTUsMjU1LC4xMiknLCBib3JkZXJDb2xvcjogJ3RyYW5zcGFyZW50JyB9IH0sICfwn5SUJywgaCgnc3BhbicsIHsgY2xhc3M6ICdkb3QgaGlkZGVuJywgJ2RhdGEtdW5yZWFkJzogJycgfSkpKSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3RhZ2xpbmUnIH0sIHQoJ3RhZ2xpbmUnKSksCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdhc2tib3gnIH0sIHRhLCBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgb25DbGljazogc3VibWl0IH0sIHQoJ3NlYXJjaF9tZScpKSksCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdleGFtcGxlcyBjaGlwcycgfSwgZXgubWFwKChbcywgZl0pID0+IGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdjaGlwJywgb25DbGljazogKCkgPT4geyB0YS52YWx1ZSA9IHQoZik7IHRhLmZvY3VzKCk7IH0gfSwgdChzKSkpKSksCiAgICBoKCdkaXYnLCB7IHN0eWxlOiB7IHBhZGRpbmc6ICcwIDE2cHgnIH0gfSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3NlY3Rpb24tdGl0bGUnIH0sIHQoJ3F1aWNrX2NhdHMnKSksCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXRzJyB9LCBzdGF0ZS5tZXRhLmNhdGVnb3JpZXMubWFwKChjKSA9PiBoKCdidXR0b24nLCB7IGNsYXNzOiAnY2F0Jywgb25DbGljazogKCkgPT4gZ28oYC9uZXc/Y2F0PSR7Yy5zbHVnfWApIH0sIGgoJ3NwYW4nLCB7IGNsYXNzOiAnZScgfSwgYy5pY29uKSwgbmFtZU9mKGMpKSkpLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnc2VjdGlvbi10aXRsZScgfSwgdCgnaG93X2l0X3dvcmtzJykpLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnaG93IGNhcmQnIH0sIFtbJ2hvdzEnXSwgWydob3cyJ10sIFsnaG93MyddXS5tYXAoKFtrXSwgaSkgPT4gaCgnZGl2JywgeyBjbGFzczogJ3N0ZXAnIH0sIGgoJ3NwYW4nLCB7IGNsYXNzOiAnbicgfSwgaSArIDEpLCBoKCdkaXYnLCBudWxsLCB0KGspKSkpKSkpOwogIHJldHVybiB7IHRpdGxlOiBmYWxzZSwgZmx1c2g6IHRydWUsIGJvZHkgfTsKfQoKLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09IENSRUFURSAvIFVOREVSU1RBTkQgPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CmNvbnN0IENBVF9ISU5UID0geyBjYXJzOiAn2YbYrdiq2KfYrCAnLCB9Owphc3luYyBmdW5jdGlvbiBjcmVhdGVQYWdlKHsgcXVlcnkgfSkgewogIGxldCB0ZXh0ID0gcXVlcnkudGV4dCB8fCAnJzsKICBpZiAoIXRleHQgJiYgcXVlcnkuY2F0KSB7CiAgICBjb25zdCB0YSA9IGgoJ3RleHRhcmVhJywgeyBjbGFzczogJ2lucHV0JywgcGxhY2Vob2xkZXI6IHQoJ2Fza19waCcpLCByb3dzOiA0IH0pOwogICAgcmV0dXJuIHsgdGl0bGU6IHQoJ25ld19yZXF1ZXN0JyksIGJhY2s6ICcvJywgYm9keTogaCgnZGl2JywgbnVsbCwgaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiIG1iJyB9LCBgJHtjYXRJY29uKHN0YXRlLm1ldGEsIHF1ZXJ5LmNhdCl9ICR7Y2F0TmFtZShzdGF0ZS5tZXRhLCBxdWVyeS5jYXQpfWApLCB0YSwKICAgICAgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBibG9jayBtdCcsIG9uQ2xpY2s6ICgpID0+IHRhLnZhbHVlLnRyaW0oKS5sZW5ndGggPiAxICYmIGdvKGAvbmV3P3RleHQ9JHtlbmNvZGVVUklDb21wb25lbnQodGEudmFsdWUudHJpbSgpKX1gKSB9LCB0KCdzZWFyY2hfbWUnKSkpKSB9OwogIH0KICBpZiAoIXRleHQpIHJldHVybiBnbygnLycpLCB7IGJvZHk6IGgoJ2RpdicpIH07CgogIGNvbnN0IGJvZHkgPSBoKCdkaXYnLCB7IGNsYXNzOiAnc3RhY2snIH0pOwogIGxldCBjb21iaW5lZCA9IHRleHQ7IGxldCBvdmVycmlkZXMgPSB7fTsgbGV0IHUgPSBudWxsOwoKICBhc3luYyBmdW5jdGlvbiBhbmFseXNlKGV4dHJhID0gJycpIHsKICAgIGJvZHkucmVwbGFjZUNoaWxkcmVuKGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkIGNlbnRlcicgfSwgaCgnc3BhbicsIHsgY2xhc3M6ICdzcGluJyB9KSwgaCgncCcsIHsgY2xhc3M6ICdtdXRlZCcgfSwgdCgndW5kZXJzdGFuZGluZycpKSkpOwogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgUE9TVCgnL2FwaS9yZXF1ZXN0cy9wYXJzZScsIHsgdGV4dDogZXh0cmEgfHwgY29tYmluZWQsIHByZXZpb3VzOiBleHRyYSA/IGNvbWJpbmVkIDogJycgfSk7CiAgICAgIGNvbWJpbmVkID0gcmVzLmNvbWJpbmVkX3RleHQ7IHUgPSByZXMudW5kZXJzdGFuZGluZzsgb3ZlcnJpZGVzID0ge307CiAgICAgIGRyYXcocmVzLnF1ZXN0aW9uKTsKICAgIH0gY2F0Y2ggKGUpIHsgYm9keS5yZXBsYWNlQ2hpbGRyZW4oaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIGgoJ3AnLCB7IGNsYXNzOiAnZXJyJyB9LCBlcnJNc2coZSkpLCBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGdob3N0Jywgb25DbGljazogKCkgPT4gZ28oJy8nKSB9LCB0KCdiYWNrJykpKSk7IH0KICB9CgogIGZ1bmN0aW9uIGxpbmUoaWNvbiwgaywgdikgeyByZXR1cm4gaCgnZGl2JywgeyBjbGFzczogJ2t2JyB9LCBoKCdzcGFuJywgeyBjbGFzczogJ2snIH0sIGljb24pLCBoKCdzcGFuJywgeyBjbGFzczogJ211dGVkIHNtYWxsJywgc3R5bGU6IHsgbWluV2lkdGg6ICc3NHB4JyB9IH0sIGspLCBoKCdzcGFuJywgeyBjbGFzczogJ2IgZ3JvdycgfSwgdiB8fCB0KCdrX25vdF9zZXQnKSkpOyB9CiAgY29uc3QgYnVkZ2V0VGV4dCA9ICgpID0+IHsKICAgIGNvbnN0IGEgPSBvdmVycmlkZXMuYnVkZ2V0X21pbiA/PyB1LmJ1ZGdldF9taW4sIGIgPSBvdmVycmlkZXMuYnVkZ2V0X21heCA/PyB1LmJ1ZGdldF9tYXg7CiAgICByZXR1cm4gYSAhPSBudWxsICYmIGIgIT0gbnVsbCA/IHQoJ2J1ZGdldF9yYW5nZScsIHsgYTogbW9uZXkoYSksIGI6IG1vbmV5KGIpIH0pIDogYiAhPSBudWxsID8gdCgnYnVkZ2V0X3VwX3RvJywgeyB2OiBtb25leShiKSB9KSA6IGEgIT0gbnVsbCA/IHQoJ2J1ZGdldF9mcm9tJywgeyB2OiBtb25leShhKSB9KSA6ICcnOwogIH07CiAgY29uc3QgZWZmID0gKGspID0+IChvdmVycmlkZXNba10gIT09IHVuZGVmaW5lZCA/IG92ZXJyaWRlc1trXSA6IHVba10pOwogIGNvbnN0IHBsYWNlVGV4dCA9ICgpID0+IHsgY29uc3QgdyA9IGVmZignbG9jYXRpb25fd2lsYXlhJyk7IGlmICghdykgcmV0dXJuICcnOyBjb25zdCBXID0gc3RhdGUubWV0YS53aWxheWFzLmZpbmQoKHgpID0+IHguY29kZSA9PT0gTnVtYmVyKHcpKTsgcmV0dXJuIG5hbWVPZihXKSArIChvdmVycmlkZXMuY29tbXVuZV9uYW1lID8gYNiMICR7b3ZlcnJpZGVzLmNvbW11bmVfbmFtZX1gIDogKHUubG9jYXRpb24gJiYgTnVtYmVyKHcpID09PSB1LmxvY2F0aW9uX3dpbGF5YSA/IGAgKCR7dS5sb2NhdGlvbn0pYCA6ICcnKSk7IH07CgogIGZ1bmN0aW9uIGRyYXcocXVlc3Rpb24pIHsKICAgIGJvZHkucmVwbGFjZUNoaWxkcmVuKCk7CiAgICBpZiAocXVlc3Rpb24pIHsKICAgICAgY29uc3QgYW5zID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCBwbGFjZWhvbGRlcjogdCgnYW5zd2VyX3BoJyksIG9uS2V5ZG93bjogKGUpID0+IHsgaWYgKGUua2V5ID09PSAnRW50ZXInKSBzZW5kKCk7IH0gfSk7CiAgICAgIGNvbnN0IHNlbmQgPSAoKSA9PiB7IGNvbnN0IHYgPSBhbnMudmFsdWUudHJpbSgpOyBpZiAodikgYW5hbHlzZSh2KTsgfTsKICAgICAgYm9keS5hcHBlbmQoCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ2FpLWJ1YmJsZScgfSwgaCgnZGl2JywgeyBjbGFzczogJ3dobycgfSwgYPCfpJYgJHt0KCdhaV9hc2tzJyl9YCksIHF1ZXN0aW9uKSwKICAgICAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93IG10JyB9LCBhbnMsIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4nLCBvbkNsaWNrOiBzZW5kIH0sIHQoJ3NlbmQnKSkpLAogICAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkIHNtYWxsIG11dGVkJyB9LCBgwqske2NvbWJpbmVkfcK7YCkpOwogICAgICBzZXRUaW1lb3V0KCgpID0+IGFucy5mb2N1cygpLCA1MCk7CiAgICAgIHJldHVybjsKICAgIH0KICAgIGNvbnN0IHJlcXMgPSBlZmYoJ3JlcXVpcmVtZW50cycpIHx8IFtdOwogICAgYm9keS5hcHBlbmQoCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkIHVuZGVyc3Rvb2QnIH0sCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ2InLCBzdHlsZTogeyBmb250U2l6ZTogJzE3cHgnLCBtYXJnaW5Cb3R0b206ICc4cHgnIH0gfSwgdCgndW5kZXJzdG9vZCcpKSwKICAgICAgICBsaW5lKGVmZigna2luZCcpID09PSAnc2VydmljZScgPyAn8J+boO+4jycgOiAn8J+bje+4jycsIHQoJ2tfcHJvZHVjdCcpLCBlZmYoJ3Byb2R1Y3Rfb3Jfc2VydmljZScpKSwKICAgICAgICBsaW5lKGNhdEljb24oc3RhdGUubWV0YSwgZWZmKCdjYXRlZ29yeScpKSwgdCgna19jYXRlZ29yeScpLCBjYXROYW1lKHN0YXRlLm1ldGEsIGVmZignY2F0ZWdvcnknKSkpLAogICAgICAgIGxpbmUoJ/Cfk40nLCB0KCdrX2xvY2F0aW9uJyksIHBsYWNlVGV4dCgpKSwKICAgICAgICBsaW5lKCfwn5KwJywgdCgna19idWRnZXQnKSwgYnVkZ2V0VGV4dCgpKSwKICAgICAgICBlZmYoJ2tpbmQnKSAhPT0gJ3NlcnZpY2UnICYmIGxpbmUoJ/Cfj7fvuI8nLCB0KCdrX2NvbmRpdGlvbicpLCBlZmYoJ2NvbmRpdGlvbicpID8gY29uZGl0aW9uTGFiZWwoZWZmKCdjb25kaXRpb24nKSkgOiAnJyksCiAgICAgICAgcmVxcy5sZW5ndGggPiAwICYmIGxpbmUoJ+KcqCcsIHQoJ2tfcmVxdWlyZW1lbnRzJyksIHJlcXMubWFwKChyKSA9PiByLnJlcGxhY2UoL15bYS16XSs6LywgJycpKS5qb2luKCfYjCAnKSkpLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93JyB9LAogICAgICAgIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZ2hvc3QgZ3JvdycsIG9uQ2xpY2s6IGVkaXQgfSwgdCgnZWRpdF9yZXF1ZXN0JykpLAogICAgICAgIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZ3JvdycsIGlkOiAnZ28nLCBvbkNsaWNrOiAoZSkgPT4gZ3VhcmRlZChlLmN1cnJlbnRUYXJnZXQsIGNyZWF0ZSkgfSwgdCgnc2VhcmNoX21lJykpKSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ2NhcmQgc21hbGwgbXV0ZWQnIH0sIGDCqyR7Y29tYmluZWR9wrtgKSk7CiAgfQoKICBmdW5jdGlvbiBlZGl0KCkgewogICAgbW9kYWwoKHMsIGNsb3NlKSA9PiB7CiAgICAgIGNvbnN0IHByb2QgPSBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcsIHZhbHVlOiBlZmYoJ3Byb2R1Y3Rfb3Jfc2VydmljZScpIHx8ICcnIH0pOwogICAgICBjb25zdCBraW5kID0gc2VsZWN0KFtbJ3Byb2R1Y3QnLCB0KCdraW5kX3Byb2R1Y3QnKV0sIFsnc2VydmljZScsIHQoJ2tpbmRfc2VydmljZScpXV0sIGVmZigna2luZCcpKTsKICAgICAgY29uc3QgY2F0ID0gc2VsZWN0KHN0YXRlLm1ldGEuY2F0ZWdvcmllcy5tYXAoKGMpID0+IFtjLnNsdWcsIGAke2MuaWNvbn0gJHtuYW1lT2YoYyl9YF0pLCBlZmYoJ2NhdGVnb3J5JykpOwogICAgICBjb25zdCB3aWwgPSBzZWxlY3QoW1snJywgdCgnYWxsX3dpbGF5YXMnKV0sIC4uLnN0YXRlLm1ldGEud2lsYXlhcy5tYXAoKHcpID0+IFt3LmNvZGUsIGAke1N0cmluZyh3LmNvZGUpLnBhZFN0YXJ0KDIsICcwJyl9IC0gJHtuYW1lT2Yodyl9YF0pXSwgZWZmKCdsb2NhdGlvbl93aWxheWEnKSB8fCAnJyk7CiAgICAgIGNvbnN0IGNvbSA9IHNlbGVjdChbWycnLCB0KCdjaG9vc2UnKV1dLCAnJyk7CiAgICAgIGNvbnN0IGxvYWRDID0gYXN5bmMgKCkgPT4geyBjb20ucmVwbGFjZUNoaWxkcmVuKGgoJ29wdGlvbicsIHsgdmFsdWU6ICcnIH0sIHQoJ2Nob29zZScpKSk7IGlmICghd2lsLnZhbHVlKSByZXR1cm47IChhd2FpdCBHRVQoYC9hcGkvY29tbXVuZXM/d2lsYXlhPSR7d2lsLnZhbHVlfWApKS5mb3JFYWNoKChjKSA9PiBjb20uYXBwZW5kKGgoJ29wdGlvbicsIHsgdmFsdWU6IGMuaWQsIHNlbGVjdGVkOiBOdW1iZXIoZWZmKCdsb2NhdGlvbl9jb21tdW5lJykpID09PSBjLmlkIH0sIG5hbWVPZihjKSkpKTsgfTsKICAgICAgd2lsLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIGxvYWRDKTsgbG9hZEMoKTsKICAgICAgY29uc3QgYm1pbiA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgdHlwZTogJ251bWJlcicsIGlucHV0bW9kZTogJ251bWVyaWMnLCBtaW46IDAsIHZhbHVlOiBlZmYoJ2J1ZGdldF9taW4nKSA/PyAnJyB9KTsKICAgICAgY29uc3QgYm1heCA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgdHlwZTogJ251bWJlcicsIGlucHV0bW9kZTogJ251bWVyaWMnLCBtaW46IDAsIHZhbHVlOiBlZmYoJ2J1ZGdldF9tYXgnKSA/PyAnJyB9KTsKICAgICAgY29uc3QgY29uZCA9IHNlbGVjdChbWycnLCB0KCdjb25kX2FueScpXSwgWyduZXcnLCB0KCdjb25kX25ldycpXSwgWyd1c2VkJywgdCgnY29uZF91c2VkJyldXSwgZWZmKCdjb25kaXRpb24nKSB8fCAnJyk7CiAgICAgIHMuYXBwZW5kKGgoJ2gzJywgeyBjbGFzczogJ21iJyB9LCB0KCdlZGl0X3RpdGxlJykpLCBmaWVsZCh0KCdrX3Byb2R1Y3QnKSwgcHJvZCksIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBmaWVsZCh0KCdraW5kX3Byb2R1Y3QnKSArICcvJyArIHQoJ2tpbmRfc2VydmljZScpLCBraW5kKSksIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBmaWVsZCh0KCdrX2NhdGVnb3J5JyksIGNhdCkpKSwKICAgICAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93JyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgZmllbGQodCgnd2lsYXlhJyksIHdpbCkpLCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgZmllbGQodCgnY29tbXVuZScpLCBjb20pKSksCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdycgfSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGZpZWxkKHQoJ2J1ZGdldF9taW4nKSwgYm1pbikpLCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgZmllbGQodCgnYnVkZ2V0X21heCcpLCBibWF4KSkpLCBmaWVsZCh0KCdrX2NvbmRpdGlvbicpLCBjb25kKSwKICAgICAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgb25DbGljazogKCkgPT4gewogICAgICAgICAgb3ZlcnJpZGVzID0geyBwcm9kdWN0X29yX3NlcnZpY2U6IHByb2QudmFsdWUudHJpbSgpLCBraW5kOiBraW5kLnZhbHVlLCBjYXRlZ29yeTogY2F0LnZhbHVlLCBsb2NhdGlvbl93aWxheWE6IHdpbC52YWx1ZSA/IE51bWJlcih3aWwudmFsdWUpIDogbnVsbCwgbG9jYXRpb25fY29tbXVuZTogY29tLnZhbHVlID8gTnVtYmVyKGNvbS52YWx1ZSkgOiBudWxsLAogICAgICAgICAgICBjb21tdW5lX25hbWU6IGNvbS52YWx1ZSA/IGNvbS5zZWxlY3RlZE9wdGlvbnNbMF0udGV4dENvbnRlbnQgOiAnJywgYnVkZ2V0X21pbjogYm1pbi52YWx1ZSA9PT0gJycgPyBudWxsIDogTnVtYmVyKGJtaW4udmFsdWUpLCBidWRnZXRfbWF4OiBibWF4LnZhbHVlID09PSAnJyA/IG51bGwgOiBOdW1iZXIoYm1heC52YWx1ZSksIGNvbmRpdGlvbjogY29uZC52YWx1ZSwgcmVxdWlyZW1lbnRzOiBlZmYoJ3JlcXVpcmVtZW50cycpIH07CiAgICAgICAgICBjbG9zZSgpOyBkcmF3KG51bGwpOyB9IH0sIHQoJ2FwcGx5JykpKTsKICAgIH0pOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gY3JlYXRlKCkgewogICAgY29uc3QgZmllbGRzID0ge307CiAgICBmb3IgKGNvbnN0IGsgb2YgWydwcm9kdWN0X29yX3NlcnZpY2UnLCAna2luZCcsICdjYXRlZ29yeScsICdsb2NhdGlvbl93aWxheWEnLCAnbG9jYXRpb25fY29tbXVuZScsICdidWRnZXRfbWluJywgJ2J1ZGdldF9tYXgnLCAnY29uZGl0aW9uJ10pIGlmIChvdmVycmlkZXNba10gIT09IHVuZGVmaW5lZCkgZmllbGRzW2tdID0gb3ZlcnJpZGVzW2tdOwogICAgY29uc3QgcmVzID0gYXdhaXQgUE9TVCgnL2FwaS9yZXF1ZXN0cycsIHsgcmF3X3RleHQ6IGNvbWJpbmVkLCBmaWVsZHMgfSk7CiAgICBnbyhgL3NlYXJjaGluZy8ke3Jlcy5pZH1gKTsKICB9CgogIGFuYWx5c2UoKTsKICByZXR1cm4geyB0aXRsZTogdCgnbmV3X3JlcXVlc3QnKSwgYmFjazogJy8nLCBib2R5IH07Cn0KCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSBBSSBTRUFSQ0hJTkcgKHJlYWwgYmFja2VuZCBwcm9ncmVzcykgPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CmNvbnN0IFNURVBTID0gW1snYW5hbHl6aW5nJywgJ/CfpJYnLCAnc3RlcF9hbmFseXppbmcnXSwgWydzZWFyY2hpbmcnLCAn8J+UjicsICdzdGVwX3NlYXJjaGluZyddLCBbJ2NvbXBhcmluZycsICfwn5OKJywgJ3N0ZXBfY29tcGFyaW5nJ10sIFsndmVyaWZ5aW5nJywgJ+KchScsICdzdGVwX3ZlcmlmeWluZyddLCBbJ2RvbmUnLCAn8J+OrycsICdzdGVwX2RvbmUnXV07CmFzeW5jIGZ1bmN0aW9uIHNlYXJjaGluZ1BhZ2UoeyBwYXJhbXMgfSkgewogIGNvbnN0IG9yYiA9IGgoJ2RpdicsIHsgY2xhc3M6ICdvcmInIH0sICfwn6SWJyk7CiAgY29uc3QgbGlzdCA9IGgoJ2RpdicsIHsgY2xhc3M6ICdzdGVwcycgfSk7CiAgY29uc3QgYmFyID0gaCgnaScsIHsgc3R5bGU6IHsgd2lkdGg6ICc0JScgfSB9KTsKICBjb25zdCBtc2cgPSBoKCdkaXYnLCB7IGNsYXNzOiAnYicsIHN0eWxlOiB7IGZvbnRTaXplOiAnMThweCcsIHRleHRBbGlnbjogJ2NlbnRlcicsIG1pbkhlaWdodDogJzI4cHgnIH0gfSk7CiAgY29uc3QgZXh0cmEgPSBoKCdkaXYnLCB7IGNsYXNzOiAnY2VudGVyIG10Jywgc3R5bGU6IHsgd2lkdGg6ICcxMDAlJywgbWF4V2lkdGg6ICczODBweCcgfSB9KTsKICBjb25zdCBib2R5ID0gaCgnZGl2JywgeyBjbGFzczogJ3NlYXJjaGluZycgfSwgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBzcCcsIHN0eWxlOiB7IHdpZHRoOiAnMTAwJScgfSB9LCBicmFuZCgyOCkpLCBvcmIsIG1zZywgbGlzdCwgaCgnZGl2JywgeyBjbGFzczogJ2JhcicgfSwgYmFyKSwgZXh0cmEpOwogIGxldCBzdG9wID0gZmFsc2U7IGxldCBmaW5pc2hlZCA9IGZhbHNlOwoKICBhc3luYyBmdW5jdGlvbiB0aWNrKCkgewogICAgaWYgKHN0b3ApIHJldHVybjsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHAgPSBhd2FpdCBHRVQoYC9hcGkvcmVxdWVzdHMvJHtwYXJhbXMuaWR9L3Byb2dyZXNzYCk7CiAgICAgIGNvbnN0IGlkeCA9IE1hdGgubWF4KDAsIFNURVBTLmZpbmRJbmRleCgocykgPT4gc1swXSA9PT0gcC5zdGVwKSk7CiAgICAgIGNvbnN0IHN0ZXBJZHggPSBwLnN0ZXAgPT09ICdpZGxlJyA/IC0xIDogaWR4OwogICAgICBsaXN0LnJlcGxhY2VDaGlsZHJlbiguLi5TVEVQUy5tYXAoKFtrLCBpYywgbGJdLCBpKSA9PiBoKCdkaXYnLCB7IGNsYXNzOiBgc3RwICR7aSA8IHN0ZXBJZHggfHwgKHAuc3RlcCA9PT0gJ2RvbmUnICYmIGkgPD0gc3RlcElkeCkgPyAnZG9uZScgOiBpID09PSBzdGVwSWR4ID8gJ2FjdGl2ZScgOiAnJ31gIH0sIGgoJ3NwYW4nLCB7IGNsYXNzOiAnaWMnIH0sIGkgPCBzdGVwSWR4IHx8IHAuc3RlcCA9PT0gJ2RvbmUnID8gJ+KckycgOiBpYyksIHQobGIpKSkpOwogICAgICBiYXIuc3R5bGUud2lkdGggPSBgJHtwLnN0ZXAgPT09ICdkb25lJyA/IDEwMCA6IE1hdGgubWF4KDYsICgoc3RlcElkeCArIDAuNSkgLyBTVEVQUy5sZW5ndGgpICogMTAwKX0lYDsKICAgICAgbXNnLnRleHRDb250ZW50ID0gcC5zdGVwID09PSAnaWRsZScgPyB0KCdzdGVwX2lkbGUnKSA6IHQoU1RFUFNbc3RlcElkeF0uYXQoMikpOwogICAgICBpZiAocC5zdGVwID09PSAnZG9uZScgJiYgIWZpbmlzaGVkKSB7CiAgICAgICAgZmluaXNoZWQgPSB0cnVlOyBvcmIuY2xhc3NMaXN0LmFkZCgnZG9uZScpOyBvcmIudGV4dENvbnRlbnQgPSBwLmZvdW5kID8gJ/Cfjq8nIDogJ/CfpLcnOwogICAgICAgIGlmIChwLmZvdW5kKSB7IGV4dHJhLnJlcGxhY2VDaGlsZHJlbihoKCdkaXYnLCB7IGNsYXNzOiAnYmFkZ2UgZ3JlZW4nLCBzdHlsZTogeyBmb250U2l6ZTogJzE1cHgnIH0gfSwgdCgnZm91bmRfbicsIHsgbjogcC5mb3VuZCB9KSkpOyBzZXRUaW1lb3V0KCgpID0+ICFzdG9wICYmIGdvKGAvcmVxdWVzdC8ke3BhcmFtcy5pZH1gKSwgOTAwKTsgfQogICAgICAgIGVsc2UgZXh0cmEucmVwbGFjZUNoaWxkcmVuKGgoJ3AnLCBudWxsLCBwLnN1bW1hcnkgfHwgJycpLCBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrIG10Jywgb25DbGljazogKCkgPT4gZ28oYC9yZXF1ZXN0LyR7cGFyYW1zLmlkfWApIH0sIHQoJ3NlZV9yZXN1bHRzJykpKTsKICAgICAgICByZXR1cm47CiAgICAgIH0KICAgIH0gY2F0Y2ggeyAvKiBrZWVwIHBvbGxpbmcgKi8gfQogICAgc2V0VGltZW91dCh0aWNrLCA0NTApOwogIH0KICB0aWNrKCk7CiAgcmV0dXJuIHsgYmFyZTogdHJ1ZSwgYm9keSwgY2xlYW51cDogKCkgPT4geyBzdG9wID0gdHJ1ZTsgfSB9Owp9CgovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gT0ZGRVIgQ0FSRCA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KZXhwb3J0IGZ1bmN0aW9uIG9mZmVyQ2FyZChvLCB7IGJlc3QsIHNlbGVjdGFibGUsIHNlbGVjdGVkLCBvblRvZ2dsZSwgcmlkLCByZXF1ZXN0IH0pIHsKICBjb25zdCBpbWcgPSBoKCdkaXYnLCB7IGNsYXNzOiAnaW1nJyB9LCBvLmltYWdlX3VybCA/IGgoJ2ltZycsIHsgc3JjOiBvLmltYWdlX3VybCwgYWx0OiAnJyB9KSA6IGNhdEljb24oc3RhdGUubWV0YSwgcmVxdWVzdD8uY2F0ZWdvcnkpKTsKICByZXR1cm4gaCgnZGl2JywgeyBjbGFzczogYGNhcmQgb2ZmZXIke2Jlc3QgPyAnIGJlc3QnIDogJyd9YCB9LAogICAgYmVzdCAmJiBoKCdzcGFuJywgeyBjbGFzczogJ3JpYmJvbicgfSwgYPCfj4YgJHt0KCdiZXN0X29mZmVyJyl9YCksCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93Jywgc3R5bGU6IHsgYWxpZ25JdGVtczogJ2ZsZXgtc3RhcnQnIH0gfSwgaW1nLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdyBjb2wnLCBzdHlsZTogeyBnYXA6ICc0cHgnIH0gfSwKICAgICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnYicgfSwgby50aXRsZSksCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3ByaWNlJyB9LCBuZihvLnByaWNlKSwgJyAnLCBoKCdzbWFsbCcsIG51bGwsIHQoJ2N1cnJlbmN5JykpKSwKICAgICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQnIH0sIFtvLmxvY2F0aW9uX2xhYmVsICYmIGDwn5ONICR7by5sb2NhdGlvbl9sYWJlbH1gLCBvLmNvbmRpdGlvbl9sYWJlbF0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyDigKIgJykpKSwKICAgICAgc2VsZWN0YWJsZSAmJiBoKCdsYWJlbCcsIHsgY2xhc3M6ICdyb3cgc21hbGwnLCBzdHlsZTogeyBnYXA6ICc0cHgnIH0gfSwgaCgnaW5wdXQnLCB7IHR5cGU6ICdjaGVja2JveCcsIGNoZWNrZWQ6IHNlbGVjdGVkLCBvbkNoYW5nZTogKGUpID0+IG9uVG9nZ2xlKG8uaWQsIGUudGFyZ2V0LmNoZWNrZWQpIH0pKSksCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93IHNwIHdyYXAgc21hbGwnIH0sIGgoJ2EnLCB7IGhyZWY6IGAjL3Byb3ZpZGVyLXByb2ZpbGUvJHtvLnByb3ZpZGVyLmlkfWAsIGNsYXNzOiAnYicgfSwgYPCfj6ogJHtvLnByb3ZpZGVyLm5hbWV9YCksIHN0YXJzKG8ucHJvdmlkZXIucmF0aW5nX2F2Zywgby5wcm92aWRlci5yYXRpbmdfY291bnQpLCB2ZXJpZmllZEJhZGdlKG8ucHJvdmlkZXIudmVyaWZpZWQpKSwKICAgIG8uc3RyZW5ndGhzLmxlbmd0aCA+IDAgJiYgaCgnZGl2JywgeyBjbGFzczogJ2NoaXBzJyB9LCBvLnN0cmVuZ3Rocy5zbGljZSgwLCA0KS5tYXAoKHMpID0+IGgoJ3NwYW4nLCB7IGNsYXNzOiAnYmFkZ2UgZ3JlZW4nIH0sIHMpKSksCiAgICBvLndhcm5pbmdzLmxlbmd0aCA+IDAgJiYgaCgnZGl2JywgeyBjbGFzczogJ3dhcm5ib3gnIH0sIG8ud2FybmluZ3Muc2xpY2UoMCwgMikubWFwKCh3KSA9PiBoKCdkaXYnLCBudWxsLCBg4pqg77iPICR7d31gKSkpLAogICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBzbWFsbCBtdXRlZCBzcCcgfSwgaCgnc3BhbicsIG51bGwsIGAke3QoJ2FkZGVkJyl9ICR7YWdvKG8uY3JlYXRlZF9hdCl9YCksIG8uZXN0aW1hdGVkX3RpbWUgJiYgaCgnc3BhbicsIG51bGwsIGDij7EgJHtvLmVzdGltYXRlZF90aW1lfWApKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cnIH0sIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZ2hvc3Qgc20gZ3JvdycsIG9uQ2xpY2s6ICgpID0+IGdvKGAvb2ZmZXIvJHtyaWR9LyR7by5pZH1gKSB9LCB0KCdkZXRhaWxzJykpLAogICAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIHNtIGdyb3cnLCBvbkNsaWNrOiAoKSA9PiBnbyhgL29mZmVyLyR7cmlkfS8ke28uaWR9P2Nob29zZT0xYCkgfSwgdCgnY2hvb3NlX29mZmVyJykpKSk7Cn0KCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSBSRVFVRVNUIERFVEFJTFMgLyBSRVNVTFRTID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQphc3luYyBmdW5jdGlvbiByZXF1ZXN0UGFnZSh7IHBhcmFtcyB9KSB7CiAgY29uc3QgZGF0YSA9IGF3YWl0IEdFVChgL2FwaS9yZXF1ZXN0cy8ke3BhcmFtcy5pZH1gKTsKICBjb25zdCByID0gZGF0YS5yZXF1ZXN0OyBjb25zdCBvZmZlcnMgPSBkYXRhLm9mZmVyczsgY29uc3Qgb3JkZXIgPSBkYXRhLm9yZGVyOwogIGNvbnN0IHBpY2tlZCA9IG5ldyBTZXQoKTsKICBjb25zdCBjYW5QaWNrID0gWydPRkZFUlNfRk9VTkQnLCAnQ09NUEFSSU5HJywgJ1NFQVJDSElORyddLmluY2x1ZGVzKHIuc3RhdHVzKTsKICBjb25zdCBib2R5ID0gaCgnZGl2JywgeyBjbGFzczogJ3N0YWNrJyB9KTsKCiAgLy8gc3VtbWFyeSBoZWFkZXIKICBjb25zdCBidWQgPSByLmJ1ZGdldF9tYXggIT0gbnVsbCA/IHQoJ2J1ZGdldF91cF90bycsIHsgdjogbW9uZXkoci5idWRnZXRfbWF4KSB9KSA6IHIuYnVkZ2V0X21pbiAhPSBudWxsID8gdCgnYnVkZ2V0X2Zyb20nLCB7IHY6IG1vbmV5KHIuYnVkZ2V0X21pbikgfSkgOiAnJzsKICBib2R5LmFwcGVuZChoKCdkaXYnLCB7IGNsYXNzOiAnY2FyZCcgfSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgc3AnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiJyB9LCB0KCdyZXF1ZXN0X24nLCB7IG46IHIubnVtYmVyIH0pKSwgc3RhdHVzUGlsbChyLnN0YXR1cykpLAogICAgdGltZWxpbmUoci5zdGF0dXMpLAogICAgaCgnZGl2JywgeyBjbGFzczogJ210JyB9LCBgwqske3IucmF3X3RleHR9wrtgKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgd3JhcCBzbWFsbCBtdXRlZCBtdCcgfSwgci5sb2NhdGlvbl9sYWJlbCAmJiBoKCdzcGFuJywgbnVsbCwgYPCfk40gJHtyLmxvY2F0aW9uX2xhYmVsfWApLCBidWQgJiYgaCgnc3BhbicsIG51bGwsIGDwn5KwICR7YnVkfWApLCByLmNvbmRpdGlvbiAmJiBoKCdzcGFuJywgbnVsbCwgYPCfj7fvuI8gJHtjb25kaXRpb25MYWJlbChyLmNvbmRpdGlvbil9YCkpLAogICAgci5zdXNwaWNpb3VzICYmIGgoJ2RpdicsIHsgY2xhc3M6ICd3YXJuYm94IG10JyB9LCBg4pqg77iPICR7dCgnc3VzcGljaW91cycpfWApKSk7CgogIC8vIG9yZGVyIHBhbmVsCiAgaWYgKG9yZGVyKSB7CiAgICBjb25zdCBzZWwgPSBvZmZlcnMuZmluZCgobykgPT4gby5pZCA9PT0gb3JkZXIub2ZmZXJfaWQpOwogICAgYm9keS5hcHBlbmQoaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnLCBzdHlsZTogeyBib3JkZXJDb2xvcjogJ3ZhcigtLWdyZWVuKScgfSB9LAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnYiBtYicgfSwgYOKchSAke3NlbD8udGl0bGUgfHwgJyd9YCksCiAgICAgIGJyZWFrZG93blRhYmxlKHsgaXRlbV9wcmljZTogb3JkZXIuaXRlbV9wcmljZSwgZmVlOiBvcmRlci5mZWUsIGRlbGl2ZXJ5X3ByaWNlOiBvcmRlci5kZWxpdmVyeV9wcmljZSwgdG90YWw6IG9yZGVyLnRvdGFsIH0pLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQgbXQnIH0sIGAke3QoJ3Byb3ZpZGVyJyl9OiAke29yZGVyLnByb3ZpZGVyLm5hbWV9IOKAoiAke29yZGVyLnBheW1lbnRfbWV0aG9kID09PSAnY2FzaF9vbl9kZWxpdmVyeScgPyB0KCdwYXlfY29kJykgOiB0KCdwYXlfZGlyZWN0Jyl9YCksCiAgICAgIG9yZGVyLnN0YXR1cyA9PT0gJ1BFTkRJTkcnICYmIGgoJ2RpdicsIHsgY2xhc3M6ICdiYWRnZSBnb2xkIG10JyB9LCBg4o+zICR7dCgnY2hvc2VuJyl9YCksCiAgICAgIG9yZGVyLnByb3ZpZGVyX3Bob25lICYmIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgc3AgbXQnIH0sIGgoJ3NwYW4nLCB7IGNsYXNzOiAnYicgfSwgYCR7dCgncHJvdmlkZXJfcGhvbmUnKX06IGAsIGgoJ3NwYW4nLCB7IGNsYXNzOiAnbHRyJyB9LCBvcmRlci5wcm92aWRlcl9waG9uZSkpLCBoKCdhJywgeyBjbGFzczogJ2J0biBzbScsIGhyZWY6IGB0ZWw6JHtvcmRlci5wcm92aWRlcl9waG9uZX1gIH0sIGDwn5OeICR7dCgnY2FsbCcpfWApKSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBtdCcgfSwgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBnaG9zdCBzbSBncm93Jywgb25DbGljazogKCkgPT4gZ28oYC9jaGF0LyR7ci5pZH0vJHtvcmRlci5wcm92aWRlci5pZH1gKSB9LCBg8J+SrCAke3QoJ2NvbnRhY3RfcHJvdmlkZXInKX1gKSwKICAgICAgICBvcmRlci5zdGF0dXMgPT09ICdJTl9QUk9HUkVTUycgJiYgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBzbSBncm93Jywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7IGF3YWl0IFBPU1QoYC9hcGkvcmVxdWVzdHMvJHtyLmlkfS9jb21wbGV0ZWApOyB0b2FzdCh0KCdzYXZlZCcpLCAnb2snKTsgZ28oYC9yZXF1ZXN0LyR7ci5pZH0/cj0ke0RhdGUubm93KCl9YCk7IH0pIH0sIHQoJ21hcmtfY29tcGxldGUnKSkpLAogICAgICBvcmRlci5zdGF0dXMgPT09ICdDT01QTEVURUQnICYmIChvcmRlci5yZXZpZXdlZCA/IGgoJ2RpdicsIHsgY2xhc3M6ICdiYWRnZSBncmVlbiBtdCcgfSwgdCgncmV2aWV3ZWQnKSkgOiBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrIG10Jywgb25DbGljazogKCkgPT4gcmV2aWV3U2hlZXQob3JkZXIuaWQsIHQoJ3JhdGVfcHJvdmlkZXInKSwgKCkgPT4gZ28oYC9yZXF1ZXN0LyR7ci5pZH0/cj0ke0RhdGUubm93KCl9YCkpIH0sIGDirZAgJHt0KCdyYXRlX3Byb3ZpZGVyJyl9YCkpKSk7CiAgfQoKICAvLyBBSSByZWNvbW1lbmRhdGlvbiArIHN1bW1hcnkKICBpZiAoci5haV9yZWNvbW1lbmRhdGlvbiAmJiAhb3JkZXIpIHsKICAgIGJvZHkuYXBwZW5kKGgoJ2RpdicsIHsgY2xhc3M6ICdhaS1idWJibGUnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICd3aG8nIH0sIGDwn6SWICR7dCgnYWlfcmVjb21tZW5kYXRpb24nKX1gKSwgci5haV9yZWNvbW1lbmRhdGlvbikpOwogIH0KCiAgLy8gb2ZmZXJzCiAgaWYgKCFvcmRlcikgewogICAgaWYgKCFvZmZlcnMubGVuZ3RoKSB7CiAgICAgIGJvZHkuYXBwZW5kKGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkJyB9LCBlbXB0eVN0YXRlKCfwn5SNJywgci5zdGF0dXMgPT09ICdDQU5DRUxMRUQnID8gdCgnc3RhdHVzX0NBTkNFTExFRCcpIDogKHIuYWlfcmVjb21tZW5kYXRpb24gfHwgdCgnbm9fb2ZmZXJzX3lldCcpKSwKICAgICAgICBjYW5QaWNrICYmIGgoJ2RpdicsIHsgY2xhc3M6ICdjb2wnIH0sIGgoJ3AnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQnIH0sIHQoJ3dhaXRpbmdfcHJvdmlkZXJzJykpLCBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuJywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7IGF3YWl0IFBPU1QoYC9hcGkvcmVxdWVzdHMvJHtyLmlkfS9yZXNlYXJjaGApOyBnbyhgL3NlYXJjaGluZy8ke3IuaWR9YCk7IH0pIH0sIGDwn5SEICR7dCgnc2VhcmNoX3dpZGVyJyl9YCkpKSkpOwogICAgfSBlbHNlIHsKICAgICAgY29uc3QgY21wQnRuID0gaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBkYXJrIGJsb2NrIGhpZGRlbicsIG9uQ2xpY2s6ICgpID0+IGdvKGAvY29tcGFyZS8ke3IuaWR9P2lkcz0ke1suLi5waWNrZWRdLmpvaW4oJywnKX1gKSB9KTsKICAgICAgY29uc3QgdXBkID0gKCkgPT4geyBjbXBCdG4uY2xhc3NMaXN0LnRvZ2dsZSgnaGlkZGVuJywgcGlja2VkLnNpemUgPCAyKTsgY21wQnRuLnRleHRDb250ZW50ID0gYOKalu+4jyAke3QoJ2NvbXBhcmVfc2VsZWN0ZWQnLCB7IG46IHBpY2tlZC5zaXplIH0pfWA7IH07CiAgICAgIGJvZHkuYXBwZW5kKGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgc3AnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdzZWN0aW9uLXRpdGxlJywgc3R5bGU6IHsgbWFyZ2luOiAwIH0gfSwgYCR7dCgncmVzdWx0cycpfSAoJHtvZmZlcnMubGVuZ3RofSlgKSwKICAgICAgICBvZmZlcnMubGVuZ3RoID4gMSAmJiBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIHNtIGRhcmsnLCBvbkNsaWNrOiBhc3luYyAoKSA9PiB7IGF3YWl0IFBPU1QoYC9hcGkvcmVxdWVzdHMvJHtyLmlkfS9jb21wYXJlLXZpZXdgKS5jYXRjaCgoKSA9PiB7fSk7IGdvKGAvY29tcGFyZS8ke3IuaWR9P2lkcz0ke29mZmVycy5zbGljZSgwLCA0KS5tYXAoKG8pID0+IG8uaWQpLmpvaW4oJywnKX1gKTsgfSB9LCBg4pqW77iPICR7dCgnY29tcGFyZScpfWApKSwKICAgICAgICAuLi5vZmZlcnMubWFwKChvLCBpKSA9PiBvZmZlckNhcmQobywgeyBiZXN0OiBpID09PSAwICYmIG9mZmVycy5sZW5ndGggPiAxLCBzZWxlY3RhYmxlOiBvZmZlcnMubGVuZ3RoID4gMSAmJiBjYW5QaWNrLCBzZWxlY3RlZDogZmFsc2UsIHJpZDogci5pZCwgcmVxdWVzdDogciwgb25Ub2dnbGU6IChpZCwgb24pID0+IHsgb24gPyBwaWNrZWQuYWRkKGlkKSA6IHBpY2tlZC5kZWxldGUoaWQpOyB1cGQoKTsgfSB9KSksIGNtcEJ0bik7CiAgICAgIGlmIChjYW5QaWNrKSBib2R5LmFwcGVuZChhc2tCb3goci5pZCkpOwogICAgICBpZiAoY2FuUGljaykgYm9keS5hcHBlbmQoaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBnaG9zdCBibG9jaycsIG9uQ2xpY2s6IChlKSA9PiBndWFyZGVkKGUuY3VycmVudFRhcmdldCwgYXN5bmMgKCkgPT4geyBhd2FpdCBQT1NUKGAvYXBpL3JlcXVlc3RzLyR7ci5pZH0vcmVzZWFyY2hgKTsgZ28oYC9zZWFyY2hpbmcvJHtyLmlkfWApOyB9KSB9LCBg8J+UhCAke3QoJ3NlYXJjaF93aWRlcicpfWApKTsKICAgIH0KICB9CiAgaWYgKCFbJ0NPTVBMRVRFRCcsICdDQU5DRUxMRUQnXS5pbmNsdWRlcyhyLnN0YXR1cykpIHsKICAgIGJvZHkuYXBwZW5kKGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZGFuZ2VyIGJsb2NrJywgb25DbGljazogYXN5bmMgKCkgPT4geyBpZiAoYXdhaXQgY29uZmlybUJveCh0KCdjb25maXJtX2NhbmNlbCcpKSkgeyBhd2FpdCBQT1NUKGAvYXBpL3JlcXVlc3RzLyR7ci5pZH0vY2FuY2VsYCk7IHRvYXN0KHQoJ3N0YXR1c19DQU5DRUxMRUQnKSk7IGdvKCcvcmVxdWVzdHMnKTsgfSB9IH0sIHQoJ2NhbmNlbF9yZXF1ZXN0JykpKTsKICB9CiAgLy8gbGl2ZSByZWZyZXNoIHdoaWxlIHN0aWxsIHNlYXJjaGluZyAvIHdhaXRpbmcgZm9yIG9mZmVycwogIGxldCB0aW1lciA9IG51bGw7CiAgaWYgKFsnU0VBUkNISU5HJywgJ09GRkVSU19GT1VORCcsICdDT01QQVJJTkcnLCAnVVNFUl9TRUxFQ1RFRCddLmluY2x1ZGVzKHIuc3RhdHVzKSkgewogICAgY29uc3Qgc2lnID0gSlNPTi5zdHJpbmdpZnkoW3Iuc3RhdHVzLCBvZmZlcnMubGVuZ3RoXSk7CiAgICB0aW1lciA9IHNldEludGVydmFsKGFzeW5jICgpID0+IHsgdHJ5IHsgY29uc3QgZCA9IGF3YWl0IEdFVChgL2FwaS9yZXF1ZXN0cy8ke3IuaWR9L3Byb2dyZXNzYCk7IGlmIChkLnN0YXR1cyAhPT0gci5zdGF0dXMgfHwgZC5mb3VuZCAhPT0gb2ZmZXJzLmxlbmd0aCkgeyBpZiAoZG9jdW1lbnQuYWN0aXZlRWxlbWVudD8udGFnTmFtZSAhPT0gJ0lOUFVUJykgZ28oYC9yZXF1ZXN0LyR7ci5pZH0/cj0ke0RhdGUubm93KCl9YCk7IH0gfSBjYXRjaCB7IC8qICovIH0gfSwgNjAwMCk7CiAgfQogIHJldHVybiB7IHRpdGxlOiB0KCdyZXF1ZXN0X24nLCB7IG46IHIubnVtYmVyIH0pLCBiYWNrOiAnL3JlcXVlc3RzJywgYm9keSwgY2xlYW51cDogKCkgPT4gY2xlYXJJbnRlcnZhbCh0aW1lcikgfTsKfQoKZXhwb3J0IGZ1bmN0aW9uIGJyZWFrZG93blRhYmxlKGIpIHsKICByZXR1cm4gaCgndGFibGUnLCB7IGNsYXNzOiAnYnJlYWtkb3duJyB9LCBoKCd0Ym9keScsIG51bGwsCiAgICBoKCd0cicsIG51bGwsIGgoJ3RkJywgbnVsbCwgdCgnc2VsbGVyX3ByaWNlJykpLCBoKCd0ZCcsIG51bGwsIG1vbmV5KGIuaXRlbV9wcmljZSkpKSwKICAgIGgoJ3RyJywgbnVsbCwgaCgndGQnLCBudWxsLCB0KCdzZXJ2aWNlX2ZlZScpKSwgaCgndGQnLCBudWxsLCBtb25leShiLmZlZSkpKSwKICAgIGgoJ3RyJywgbnVsbCwgaCgndGQnLCBudWxsLCB0KCdkZWxpdmVyeV9mZWUnKSksIGgoJ3RkJywgbnVsbCwgYi5kZWxpdmVyeV9wcmljZSA/IG1vbmV5KGIuZGVsaXZlcnlfcHJpY2UpIDogdCgnZnJlZScpKSksCiAgICBoKCd0cicsIHsgY2xhc3M6ICd0b3RhbCcgfSwgaCgndGQnLCBudWxsLCB0KCdmaW5hbF9wcmljZScpKSwgaCgndGQnLCBudWxsLCBtb25leShiLnRvdGFsKSkpKSk7Cn0KCmZ1bmN0aW9uIGFza0JveChyaWQpIHsKICBjb25zdCBvdXQgPSBoKCdkaXYnKTsgY29uc3QgaW5wID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCBwbGFjZWhvbGRlcjogdCgnYXNrX2FpX3BoJykgfSk7CiAgY29uc3QgYXNrID0gYXN5bmMgKCkgPT4geyBjb25zdCBxID0gaW5wLnZhbHVlLnRyaW0oKTsgaWYgKCFxKSByZXR1cm47IGlucC52YWx1ZSA9ICcnOyBvdXQucmVwbGFjZUNoaWxkcmVuKGgoJ2RpdicsIHsgY2xhc3M6ICdjZW50ZXInIH0sIGgoJ3NwYW4nLCB7IGNsYXNzOiAnc3BpbicgfSkpKTsKICAgIHRyeSB7IGNvbnN0IHIgPSBhd2FpdCBQT1NUKGAvYXBpL3JlcXVlc3RzLyR7cmlkfS9hc2tgLCB7IHF1ZXN0aW9uOiBxIH0pOyBvdXQucmVwbGFjZUNoaWxkcmVuKGgoJ2RpdicsIHsgY2xhc3M6ICdhaS1idWJibGUgbXQnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICd3aG8nIH0sICfwn6SWJyksIHIuYW5zd2VyKSk7IH0gY2F0Y2ggKGUpIHsgb3V0LnJlcGxhY2VDaGlsZHJlbihoKCdkaXYnLCB7IGNsYXNzOiAnZXJyJyB9LCBlcnJNc2coZSkpKTsgfSB9OwogIGlucC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgKGUpID0+IGUua2V5ID09PSAnRW50ZXInICYmIGFzaygpKTsKICByZXR1cm4gaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiIG1iJyB9LCBg8J+SoSAke3QoJ2Fza19haScpfWApLCBoKCdkaXYnLCB7IGNsYXNzOiAncm93JyB9LCBpbnAsIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4nLCBvbkNsaWNrOiBhc2sgfSwgdCgnc2VuZCcpKSksIG91dCk7Cn0KCmV4cG9ydCBmdW5jdGlvbiByZXZpZXdTaGVldChvcmRlcklkLCB0aXRsZSwgZG9uZSkgewogIG1vZGFsKChzLCBjbG9zZSkgPT4gewogICAgbGV0IHJhdGluZyA9IDU7IGNvbnN0IGNvbW1lbnQgPSBoKCd0ZXh0YXJlYScsIHsgY2xhc3M6ICdpbnB1dCcsIHBsYWNlaG9sZGVyOiB0KCd5b3VyX2NvbW1lbnQnKSwgbWF4bGVuZ3RoOiA1MDAgfSk7CiAgICBjb25zdCBwaWNrZXIgPSBoKCdkaXYnLCB7IGNsYXNzOiAnc3RhcnBpY2snIH0pOwogICAgY29uc3QgZHJhdyA9ICgpID0+IHBpY2tlci5yZXBsYWNlQ2hpbGRyZW4oLi4uWzEsIDIsIDMsIDQsIDVdLm1hcCgobikgPT4gaCgnYnV0dG9uJywgeyBjbGFzczogbiA8PSByYXRpbmcgPyAnb24nIDogJycsIG9uQ2xpY2s6ICgpID0+IHsgcmF0aW5nID0gbjsgZHJhdygpOyB9IH0sICfimIUnKSkpOwogICAgZHJhdygpOwogICAgcy5hcHBlbmQoaCgnaDMnLCB7IGNsYXNzOiAnY2VudGVyIG1iJyB9LCB0aXRsZSksIHBpY2tlciwgaCgnZGl2JywgeyBjbGFzczogJ210JyB9LCBjb21tZW50KSwKICAgICAgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBibG9jayBtdCcsIG9uQ2xpY2s6IChlKSA9PiBndWFyZGVkKGUuY3VycmVudFRhcmdldCwgYXN5bmMgKCkgPT4geyBhd2FpdCBQT1NUKGAvYXBpL29yZGVycy8ke29yZGVySWR9L3Jldmlld2AsIHsgcmF0aW5nLCBjb21tZW50OiBjb21tZW50LnZhbHVlIH0pOyBjbG9zZSgpOyB0b2FzdCh0KCd0aGFua3NfcmV2aWV3JyksICdvaycpOyBkb25lPy4oKTsgfSkgfSwgdCgnc3VibWl0X3JldmlldycpKSk7CiAgfSk7Cn0KCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSBPRkZFUiBERVRBSUxTID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQphc3luYyBmdW5jdGlvbiBvZmZlclBhZ2UoeyBwYXJhbXMsIHF1ZXJ5IH0pIHsKICBjb25zdCB7IG9mZmVycywgcmVxdWVzdDogciB9ID0gYXdhaXQgR0VUKGAvYXBpL3JlcXVlc3RzLyR7cGFyYW1zLnJpZH1gKTsKICBjb25zdCBvID0gb2ZmZXJzLmZpbmQoKHgpID0+IHguaWQgPT09IHBhcmFtcy5vaWQpOwogIGlmICghbykgcmV0dXJuIHsgdGl0bGU6IHQoJ2RldGFpbHMnKSwgYmFjazogYC9yZXF1ZXN0LyR7cGFyYW1zLnJpZH1gLCBib2R5OiBlbXB0eVN0YXRlKCfwn6S3JywgdCgnbm9fb2ZmZXJzX3lldCcpKSB9OwogIGxldCBtZXRob2QgPSAnY2FzaF9vbl9kZWxpdmVyeSc7CiAgY29uc3QgY2FuQ2hvb3NlID0gWydPRkZFUlNfRk9VTkQnLCAnQ09NUEFSSU5HJywgJ1NFQVJDSElORyddLmluY2x1ZGVzKHIuc3RhdHVzKSAmJiBvLnN0YXR1cyA9PT0gJ2FjdGl2ZSc7CiAgY29uc3QgYm9keSA9IGgoJ2RpdicsIHsgY2xhc3M6ICdzdGFjaycgfSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkJyB9LAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93Jywgc3R5bGU6IHsgYWxpZ25JdGVtczogJ2ZsZXgtc3RhcnQnIH0gfSwgaCgnZGl2JywgeyBjbGFzczogJ29mZmVyJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnaW1nJyB9LCBvLmltYWdlX3VybCA/IGgoJ2ltZycsIHsgc3JjOiBvLmltYWdlX3VybCwgYWx0OiAnJyB9KSA6IGNhdEljb24oc3RhdGUubWV0YSwgci5jYXRlZ29yeSkpKSwKICAgICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgaCgnaDMnLCBudWxsLCBvLnRpdGxlKSwgaCgnZGl2JywgeyBjbGFzczogJ3NtYWxsIG11dGVkIG10JyB9LCBbby5sb2NhdGlvbl9sYWJlbCAmJiBg8J+TjSAke28ubG9jYXRpb25fbGFiZWx9YCwgby5jb25kaXRpb25fbGFiZWwsIG8uZXN0aW1hdGVkX3RpbWUgJiYgYOKPsSAke28uZXN0aW1hdGVkX3RpbWV9YF0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyDigKIgJykpKSksCiAgICAgIG8uZGVzY3JpcHRpb24gJiYgaCgncCcsIG51bGwsIG8uZGVzY3JpcHRpb24pLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93IHNwIHdyYXAgc21hbGwnIH0sIGgoJ2EnLCB7IGhyZWY6IGAjL3Byb3ZpZGVyLXByb2ZpbGUvJHtvLnByb3ZpZGVyLmlkfWAsIGNsYXNzOiAnYicgfSwgYPCfj6ogJHtvLnByb3ZpZGVyLm5hbWV9YCksIHN0YXJzKG8ucHJvdmlkZXIucmF0aW5nX2F2Zywgby5wcm92aWRlci5yYXRpbmdfY291bnQpLCB2ZXJpZmllZEJhZGdlKG8ucHJvdmlkZXIudmVyaWZpZWQpKSksCiAgICBvLnN0cmVuZ3Rocy5sZW5ndGggPiAwICYmIGgoJ2RpdicsIHsgY2xhc3M6ICdjaGlwcycgfSwgby5zdHJlbmd0aHMubWFwKChzKSA9PiBoKCdzcGFuJywgeyBjbGFzczogJ2JhZGdlIGdyZWVuJyB9LCBg4pyTICR7c31gKSkpLAogICAgby53YXJuaW5ncy5sZW5ndGggPiAwICYmIGgoJ2RpdicsIHsgY2xhc3M6ICd3YXJuYm94JyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnYicgfSwgdCgnd2FybmluZ3MnKSksIG8ud2FybmluZ3MubWFwKCh3KSA9PiBoKCdkaXYnLCBudWxsLCBg4pqg77iPICR7d31gKSkpLAogICAgaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIGJyZWFrZG93blRhYmxlKG8uYnJlYWtkb3duKSwgaCgncCcsIHsgY2xhc3M6ICd0aW55IG11dGVkJyB9LCB0KCdmZWVfbm90ZScpKSkpOwogIGlmIChjYW5DaG9vc2UpIHsKICAgIGNvbnN0IHBheSA9IGgoJ2RpdicsIHsgY2xhc3M6ICdjb2wnIH0sIFtbJ2Nhc2hfb25fZGVsaXZlcnknLCB0KCdwYXlfY29kJyldLCBbJ2RpcmVjdCcsIHQoJ3BheV9kaXJlY3QnKV1dLm1hcCgoW3YsIGxdKSA9PgogICAgICBoKCdsYWJlbCcsIHsgY2xhc3M6ICdyb3cgY2FyZCcsIHN0eWxlOiB7IHBhZGRpbmc6ICcxMnB4JywgY3Vyc29yOiAncG9pbnRlcicgfSB9LCBoKCdpbnB1dCcsIHsgdHlwZTogJ3JhZGlvJywgbmFtZTogJ3BheScsIGNoZWNrZWQ6IHYgPT09IG1ldGhvZCwgb25DaGFuZ2U6ICgpID0+IHsgbWV0aG9kID0gdjsgfSB9KSwgbCkpKTsKICAgIGJvZHkuYXBwZW5kKGgoJ2RpdicsIG51bGwsIGgoJ2RpdicsIHsgY2xhc3M6ICdiIG1iJyB9LCB0KCdwYXltZW50X21ldGhvZCcpKSwgcGF5LCBoKCdwJywgeyBjbGFzczogJ3NtYWxsIG11dGVkJyB9LCB0KCdwYXlfbm90ZScpKSksCiAgICAgIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gYmxvY2snLCBvbkNsaWNrOiAoZSkgPT4gZ3VhcmRlZChlLmN1cnJlbnRUYXJnZXQsIGFzeW5jICgpID0+IHsgYXdhaXQgUE9TVChgL2FwaS9yZXF1ZXN0cy8ke3IuaWR9L3NlbGVjdGAsIHsgb2ZmZXJfaWQ6IG8uaWQsIHBheW1lbnRfbWV0aG9kOiBtZXRob2QgfSk7IHRvYXN0KHQoJ2Nob3NlbicpLCAnb2snKTsgZ28oYC9yZXF1ZXN0LyR7ci5pZH1gKTsgfSkgfSwgYOKchSAke3QoJ2NvbmZpcm1fY2hvaWNlJyl9YCkpOwogICAgaWYgKG8uc291cmNlID09PSAncHJvdmlkZXInKSBib2R5LmFwcGVuZChoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGdob3N0IGJsb2NrJywgb25DbGljazogKCkgPT4gZ28oYC9jaGF0LyR7ci5pZH0vJHtvLnByb3ZpZGVyLmlkfWApIH0sIGDwn5KsICR7dCgnY29udGFjdF9wcm92aWRlcicpfWApKTsKICB9CiAgcmV0dXJuIHsgdGl0bGU6IHQoJ2RldGFpbHMnKSwgYmFjazogYC9yZXF1ZXN0LyR7ci5pZH1gLCBib2R5IH07Cn0KCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSBDT01QQVJFID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQphc3luYyBmdW5jdGlvbiBjb21wYXJlUGFnZSh7IHBhcmFtcywgcXVlcnkgfSkgewogIGNvbnN0IHsgb2ZmZXJzLCByZXF1ZXN0OiByIH0gPSBhd2FpdCBHRVQoYC9hcGkvcmVxdWVzdHMvJHtwYXJhbXMucmlkfWApOwogIGNvbnN0IGlkcyA9IChxdWVyeS5pZHMgfHwgJycpLnNwbGl0KCcsJykuZmlsdGVyKEJvb2xlYW4pOwogIGNvbnN0IGxpc3QgPSAoaWRzLmxlbmd0aCA/IGlkcy5tYXAoKGkpID0+IG9mZmVycy5maW5kKChvKSA9PiBvLmlkID09PSBpKSkuZmlsdGVyKEJvb2xlYW4pIDogb2ZmZXJzKS5zbGljZSgwLCA0KTsKICBpZiAobGlzdC5sZW5ndGggPCAyKSByZXR1cm4geyB0aXRsZTogdCgnY29tcGFyZScpLCBiYWNrOiBgL3JlcXVlc3QvJHtyLmlkfWAsIGJvZHk6IGVtcHR5U3RhdGUoJ+Kalu+4jycsIHQoJ3NlbGVjdF90b19jb21wYXJlJykpIH07CiAgY29uc3QgYmVzdCA9IFsuLi5saXN0XS5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSlbMF07CiAgY29uc3QgbWluVG90YWwgPSBNYXRoLm1pbiguLi5saXN0Lm1hcCgobykgPT4gby5icmVha2Rvd24udG90YWwpKTsKICBjb25zdCBtYXhSYXRpbmcgPSBNYXRoLm1heCguLi5saXN0Lm1hcCgobykgPT4gby5wcm92aWRlci5yYXRpbmdfYXZnIHx8IDApKTsKICBjb25zdCByb3cgPSAobGFiZWwsIGZuLCB3aW4pID0+IGgoJ3RyJywgbnVsbCwgaCgndGQnLCBudWxsLCBsYWJlbCksIC4uLmxpc3QubWFwKChvKSA9PiBoKCd0ZCcsIHsgY2xhc3M6IHdpbj8uKG8pID8gJ3dpbicgOiAnJyB9LCBmbihvKSkpKTsKICBjb25zdCB0YWJsZSA9IGgoJ2RpdicsIHsgY2xhc3M6ICdjbXAtd3JhcCcgfSwgaCgndGFibGUnLCB7IGNsYXNzOiAnY21wJyB9LAogICAgaCgndGhlYWQnLCBudWxsLCBoKCd0cicsIG51bGwsIGgoJ3RoJywgbnVsbCwgJycpLCAuLi5saXN0Lm1hcCgobywgaSkgPT4gaCgndGgnLCBudWxsLCB0KCdvZmZlcl9uJywgeyBuOiBpICsgMSB9KSwgby5pZCA9PT0gYmVzdC5pZCA/ICcg8J+PhicgOiAnJykpKSksCiAgICBoKCd0Ym9keScsIG51bGwsCiAgICAgIHJvdyh0KCdwcm92aWRlcicpLCAobykgPT4gby5wcm92aWRlci5uYW1lKSwKICAgICAgcm93KHQoJ3ByaWNlJyksIChvKSA9PiBuZihvLnByaWNlKSwgKG8pID0+IG8uYnJlYWtkb3duLnRvdGFsID09PSBtaW5Ub3RhbCksCiAgICAgIHJvdyh0KCdkZWxpdmVyeScpLCAobykgPT4gKG8uZGVsaXZlcnlfcHJpY2UgPyBuZihvLmRlbGl2ZXJ5X3ByaWNlKSA6IHQoJ2ZyZWUnKSkpLAogICAgICByb3codCgndG90YWwnKSwgKG8pID0+IG5mKG8uYnJlYWtkb3duLnRvdGFsKSwgKG8pID0+IG8uYnJlYWtkb3duLnRvdGFsID09PSBtaW5Ub3RhbCksCiAgICAgIHJvdyh0KCdjb25kaXRpb24nKSwgKG8pID0+IG8uY29uZGl0aW9uX2xhYmVsIHx8ICfigJQnKSwKICAgICAgcm93KHQoJ2xvY2F0aW9uJyksIChvKSA9PiBvLmxvY2F0aW9uX2xhYmVsIHx8ICfigJQnKSwKICAgICAgcm93KHQoJ3JhdGluZycpLCAobykgPT4gKG8ucHJvdmlkZXIucmF0aW5nX2NvdW50ID8gYCR7by5wcm92aWRlci5yYXRpbmdfYXZnfSDirZAgKCR7by5wcm92aWRlci5yYXRpbmdfY291bnR9KWAgOiAn4oCUJyksIChvKSA9PiBvLnByb3ZpZGVyLnJhdGluZ19hdmcgPT09IG1heFJhdGluZyAmJiBtYXhSYXRpbmcgPiAwKSwKICAgICAgcm93KHQoJ3ZlcmlmaWNhdGlvbicpLCAobykgPT4gKG8ucHJvdmlkZXIudmVyaWZpZWQgPyAn4pyTJyA6ICfinJcnKSwgKG8pID0+IG8ucHJvdmlkZXIudmVyaWZpZWQpLAogICAgICByb3codCgnc2NvcmUnKSwgKG8pID0+IE1hdGgucm91bmQoby5zY29yZSksIChvKSA9PiBvLmlkID09PSBiZXN0LmlkKSwKICAgICAgaCgndHInLCBudWxsLCBoKCd0ZCcsIG51bGwsICcnKSwgLi4ubGlzdC5tYXAoKG8pID0+IGgoJ3RkJywgbnVsbCwgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBzbScsIG9uQ2xpY2s6ICgpID0+IGdvKGAvb2ZmZXIvJHtyLmlkfS8ke28uaWR9P2Nob29zZT0xYCkgfSwgdCgnY2hvb3NlX29mZmVyJykpKSkpKSkpOwogIGNvbnN0IGJvZHkgPSBoKCdkaXYnLCB7IGNsYXNzOiAnc3RhY2snIH0sCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnYWktYnViYmxlJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnd2hvJyB9LCBg8J+kliAke3QoJ2FpX3JlY29tbWVuZGF0aW9uJyl9YCksIHIuYWlfcmVjb21tZW5kYXRpb24gfHwgYCR7YmVzdC50aXRsZX0g4oCUICR7YmVzdC5wcm92aWRlci5uYW1lfWApLAogICAgdGFibGUsCiAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGdyZWVuIGJsb2NrJywgb25DbGljazogKCkgPT4gZ28oYC9vZmZlci8ke3IuaWR9LyR7YmVzdC5pZH0/Y2hvb3NlPTFgKSB9LCBg8J+PhiAke3QoJ3BpY2tfYmVzdCcpfWApKTsKICByZXR1cm4geyB0aXRsZTogdCgnY29tcGFyZScpLCBiYWNrOiBgL3JlcXVlc3QvJHtyLmlkfWAsIGJvZHkgfTsKfQoKLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09IExJU1RTID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQphc3luYyBmdW5jdGlvbiByZXF1ZXN0c1BhZ2UoKSB7CiAgY29uc3QgeyByZXF1ZXN0cyB9ID0gYXdhaXQgR0VUKCcvYXBpL3JlcXVlc3RzJyk7CiAgY29uc3QgYm9keSA9IGgoJ2RpdicsIG51bGwsIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gYmxvY2sgbWInLCBvbkNsaWNrOiAoKSA9PiBnbygnLycpIH0sIGDvvIsgJHt0KCduZXdfcmVxdWVzdCcpfWApLAogICAgcmVxdWVzdHMubGVuZ3RoID8gcmVxdWVzdHMubWFwKChyKSA9PiBoKCdkaXYnLCB7IGNsYXNzOiAnbGlzdC1pdGVtJywgb25DbGljazogKCkgPT4gZ28oci5zdGF0dXMgPT09ICdTRUFSQ0hJTkcnICYmIHIuc2VhcmNoX3N0ZXAgIT09ICdkb25lJyA/IGAvc2VhcmNoaW5nLyR7ci5pZH1gIDogYC9yZXF1ZXN0LyR7ci5pZH1gKSB9LAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBzcCcgfSwgaCgnZGl2JywgeyBjbGFzczogJ2InIH0sIHQoJ3JlcXVlc3RfbicsIHsgbjogci5udW1iZXIgfSkpLCBzdGF0dXNQaWxsKHIuc3RhdHVzKSksCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3NtYWxsJywgc3R5bGU6IHsgbWFyZ2luVG9wOiAnNHB4JyB9IH0sIHIucHJvZHVjdF9vcl9zZXJ2aWNlIHx8IHIucmF3X3RleHQuc2xpY2UoMCwgNjApKSwKICAgICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQnIH0sIHIub2ZmZXJzX2NvdW50ID8gYCR7dCgnb2ZmZXJzX2NvdW50JywgeyBuOiByLm9mZmVyc19jb3VudCB9KX0ke3IuYmVzdF9wcmljZSA/IGAg4oCiICR7bW9uZXkoci5iZXN0X3ByaWNlKX1gIDogJyd9YCA6IHQoJ25vX29mZmVyc195ZXQnKSksIHRpbWVsaW5lKHIuc3RhdHVzKSkpKQogICAgICA6IGVtcHR5U3RhdGUoJ/Cfk4snLCB0KCdub19yZXF1ZXN0cycpKSk7CiAgcmV0dXJuIHsgdGl0bGU6IHQoJ215X3JlcXVlc3RzJyksIGJvZHkgfTsKfQoKYXN5bmMgZnVuY3Rpb24gY2hhdHNQYWdlKCkgewogIGNvbnN0IHsgdGhyZWFkcyB9ID0gYXdhaXQgR0VUKCcvYXBpL3RocmVhZHMnKTsKICBjb25zdCBpc1Byb3YgPSBzdGF0ZS51c2VyLnJvbGUgPT09ICdwcm92aWRlcic7CiAgY29uc3QgYm9keSA9IHRocmVhZHMubGVuZ3RoID8gdGhyZWFkcy5tYXAoKHRoKSA9PiBoKCdkaXYnLCB7IGNsYXNzOiBgbGlzdC1pdGVtJHt0aC51bnJlYWQgPyAnIHVucmVhZCcgOiAnJ31gLCBvbkNsaWNrOiAoKSA9PiBnbyhgJHtpc1Byb3YgPyAnL3Byb3ZpZGVyJyA6ICcnfS9jaGF0LyR7dGgucmVxdWVzdF9pZH0vJHt0aC5wcm92aWRlcl9pZH1gKSB9LAogICAgaCgnZGl2JywgeyBjbGFzczogJ2F2YXRhcicgfSwgKHRoLm90aGVyX25hbWUgfHwgJz8nKS5zbGljZSgwLCAxKSksIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAncm93IHNwJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnYicgfSwgdGgub3RoZXJfbmFtZSksIGgoJ3NwYW4nLCB7IGNsYXNzOiAndGlueSBtdXRlZCcgfSwgdGgubGFzdF9hdCA/IGFnbyh0aC5sYXN0X2F0KSA6ICcnKSksCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdzbWFsbCBtdXRlZCcgfSwgYCR7dCgncmVxdWVzdF9uJywgeyBuOiB0aC5udW1iZXIgfSl9IOKAoiAke3RoLmxhc3QgfHwgJ+KAlCd9YCkpLCB0aC51bnJlYWQgPiAwICYmIGgoJ3NwYW4nLCB7IGNsYXNzOiAnYmFkZ2UgcmVkJyB9LCB0aC51bnJlYWQpKSkgOiBlbXB0eVN0YXRlKCfwn5KsJywgdCgnbm9fdGhyZWFkcycpKTsKICByZXR1cm4geyB0aXRsZTogdCgnY2hhdCcpLCBib2R5IH07Cn0KCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSBDSEFUID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQphc3luYyBmdW5jdGlvbiBjaGF0UGFnZSh7IHBhcmFtcyB9KSB7CiAgY29uc3QgeyByaWQsIHBpZCB9ID0geyByaWQ6IHBhcmFtcy5yaWQsIHBpZDogcGFyYW1zLnBpZCB9OwogIGxldCBkYXRhID0gYXdhaXQgR0VUKGAvYXBpL2NoYXQvJHtyaWR9LyR7cGlkfWApOwogIGNvbnN0IGxpc3QgPSBoKCdkaXYnLCB7IGNsYXNzOiAnY2hhdCcgfSk7IGNvbnN0IGlucHV0ID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCBwbGFjZWhvbGRlcjogdCgndHlwZV9tZXNzYWdlJyksIG1heGxlbmd0aDogMTAwMCB9KTsKICBjb25zdCBmaWxlID0gaCgnaW5wdXQnLCB7IHR5cGU6ICdmaWxlJywgYWNjZXB0OiAnaW1hZ2UvKicsIGNsYXNzOiAnaGlkZGVuJyB9KTsKICBjb25zdCBlcnIgPSBoKCdkaXYnLCB7IGNsYXNzOiAnZXJyIGNlbnRlcicgfSk7CiAgY29uc3QgZHJhdyA9ICgpID0+IHsKICAgIGxpc3QucmVwbGFjZUNoaWxkcmVuKC4uLmRhdGEubWVzc2FnZXMubWFwKChtKSA9PiBoKCdkaXYnLCB7IGNsYXNzOiBgbXNnICR7bS5taW5lID8gJ21lJyA6ICd0aGVtJ31gIH0sCiAgICAgIG0ua2luZCA9PT0gJ2ltYWdlJyA/IGgoJ2ltZycsIHsgc3JjOiBtLmltYWdlX3VybCwgYWx0OiAnJyB9KSA6IG0ua2luZCA9PT0gJ29mZmVyJyA/IG9mZmVyQnViYmxlKG0sIGRhdGEub2ZmZXJzKSA6IG0uYm9keSwgaCgnZGl2JywgeyBjbGFzczogJ3QnIH0sIGFnbyhtLmNyZWF0ZWRfYXQpKSkpKTsKICAgIHdpbmRvdy5zY3JvbGxUbygwLCBkb2N1bWVudC5ib2R5LnNjcm9sbEhlaWdodCk7CiAgfTsKICBjb25zdCBzZW5kID0gYXN5bmMgKHBheWxvYWQpID0+IHsgZXJyLnRleHRDb250ZW50ID0gJyc7IHRyeSB7IGF3YWl0IFBPU1QoYC9hcGkvY2hhdC8ke3JpZH0vJHtwaWR9YCwgcGF5bG9hZCk7IGF3YWl0IHJlbG9hZCgpOyB9IGNhdGNoIChlKSB7IGVyci50ZXh0Q29udGVudCA9IGVyck1zZyhlKTsgfSB9OwogIGNvbnN0IHJlbG9hZCA9IGFzeW5jICgpID0+IHsgZGF0YSA9IGF3YWl0IEdFVChgL2FwaS9jaGF0LyR7cmlkfS8ke3BpZH1gKTsgZHJhdygpOyB9OwogIGNvbnN0IGRvU2VuZCA9ICgpID0+IHsgY29uc3QgdiA9IGlucHV0LnZhbHVlLnRyaW0oKTsgaWYgKCF2KSByZXR1cm47IGlucHV0LnZhbHVlID0gJyc7IHNlbmQoeyB0ZXh0OiB2IH0pOyB9OwogIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCAoZSkgPT4gZS5rZXkgPT09ICdFbnRlcicgJiYgZG9TZW5kKCkpOwogIGZpbGUuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgYXN5bmMgKCkgPT4geyBpZiAoIWZpbGUuZmlsZXNbMF0pIHJldHVybjsgdHJ5IHsgY29uc3QgeyB1cmwgfSA9IGF3YWl0IHVwbG9hZEltYWdlKGZpbGUuZmlsZXNbMF0pOyBhd2FpdCBzZW5kKHsga2luZDogJ2ltYWdlJywgaW1hZ2VfdXJsOiB1cmwgfSk7IH0gY2F0Y2ggKGUpIHsgZXJyLnRleHRDb250ZW50ID0gZXJyTXNnKGUpOyB9IGZpbGUudmFsdWUgPSAnJzsgfSk7CiAgY29uc3QgaXNQcm92ID0gc3RhdGUudXNlci5yb2xlID09PSAncHJvdmlkZXInOwogIGNvbnN0IGJvZHkgPSBoKCdkaXYnLCBudWxsLAogICAgaCgnZGl2JywgeyBjbGFzczogJ2NhcmQgc21hbGwnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiJyB9LCBgJHtkYXRhLm90aGVyLm5hbWV9ICR7ZGF0YS5vdGhlci52ZXJpZmllZCA/ICfinJMnIDogJyd9YCksIGgoJ2RpdicsIHsgY2xhc3M6ICdtdXRlZCcgfSwgYCR7dCgncmVxdWVzdF9uJywgeyBuOiBkYXRhLnJlcXVlc3QubnVtYmVyIH0pfSDigJQgJHtkYXRhLnJlcXVlc3QucHJvZHVjdF9vcl9zZXJ2aWNlIHx8ICcnfWApLAogICAgICAhZGF0YS5jb250YWN0X29wZW4gJiYgaCgnZGl2JywgeyBjbGFzczogJ3RpbnkgbXV0ZWQgbXQnIH0sIGDwn5SSICR7dCgnY2hhdF9ub3RlJyl9YCkpLCBsaXN0LCBlcnIsCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnY29tcG9zZXInIH0sIGgoJ2RpdicsIG51bGwsIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdpY29uYnRuJywgdGl0bGU6IHQoJ3NlbmRfcGhvdG8nKSwgb25DbGljazogKCkgPT4gZmlsZS5jbGljaygpIH0sICfwn5O3JyksCiAgICAgIGlzUHJvdiAmJiBkYXRhLm9mZmVyc1swXSAmJiBoKCdidXR0b24nLCB7IGNsYXNzOiAnaWNvbmJ0bicsIHRpdGxlOiB0KCdzaGFyZV9vZmZlcicpLCBvbkNsaWNrOiAoKSA9PiBzZW5kKHsga2luZDogJ29mZmVyJywgb2ZmZXJfaWQ6IGRhdGEub2ZmZXJzWzBdLmlkIH0pIH0sICfwn6e+JyksCiAgICAgIGlucHV0LCBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuJywgb25DbGljazogZG9TZW5kIH0sIHQoJ3NlbmQnKSksIGZpbGUpKSk7CiAgZHJhdygpOwogIGNvbnN0IHRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4geyBpZiAoIWRvY3VtZW50LmhpZGRlbiAmJiBkb2N1bWVudC5hY3RpdmVFbGVtZW50ICE9PSBpbnB1dCkgcmVsb2FkKCkuY2F0Y2goKCkgPT4ge30pOyB9LCA1MDAwKTsKICByZXR1cm4geyB0aXRsZTogZGF0YS5vdGhlci5uYW1lLCBiYWNrOiBpc1Byb3YgPyAnL3Byb3ZpZGVyL29yZGVycycgOiBgL3JlcXVlc3QvJHtyaWR9YCwgYm9keSwgY2xlYW51cDogKCkgPT4gY2xlYXJJbnRlcnZhbCh0aW1lcikgfTsKfQpmdW5jdGlvbiBvZmZlckJ1YmJsZShtLCBvZmZlcnMpIHsKICBjb25zdCBvID0gb2ZmZXJzLmZpbmQoKHgpID0+IHguaWQgPT09IG0ub2ZmZXJfaWQpOwogIHJldHVybiBoKCdkaXYnLCBudWxsLCBoKCdkaXYnLCB7IGNsYXNzOiAnYicgfSwgYPCfp74gJHt0KCdvZmZlcl9pbmZvJyl9YCksIG8gPyBoKCdkaXYnLCBudWxsLCBvLnRpdGxlLCBoKCdicicpLCBtb25leShvLnByaWNlKSwgby5kZWxpdmVyeV9wcmljZSA/IGAgKyAke21vbmV5KG8uZGVsaXZlcnlfcHJpY2UpfWAgOiAnJykgOiAnJyk7Cn0KCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSBQUk9WSURFUiBQUk9GSUxFIChwdWJsaWMpID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQphc3luYyBmdW5jdGlvbiBwcm92aWRlclByb2ZpbGVQYWdlKHsgcGFyYW1zIH0pIHsKICBjb25zdCBkID0gYXdhaXQgR0VUKGAvYXBpL3Byb3ZpZGVycy8ke3BhcmFtcy5pZH1gKTsgY29uc3QgcCA9IGQucHJvdmlkZXI7IGxldCBmYXYgPSBkLmZhdm9yaXRlOwogIGNvbnN0IGZhdkJ0biA9IGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZ2hvc3Qgc20nLCBvbkNsaWNrOiBhc3luYyAoKSA9PiB7IGZhdiA/IGF3YWl0IERFTEVURShgL2FwaS9mYXZvcml0ZXMvJHtwLmlkfWApIDogYXdhaXQgUE9TVChgL2FwaS9mYXZvcml0ZXMvJHtwLmlkfWApOyBmYXYgPSAhZmF2OyBwYWludCgpOyB9IH0pOwogIGNvbnN0IHBhaW50ID0gKCkgPT4geyBmYXZCdG4udGV4dENvbnRlbnQgPSBmYXYgPyBg8J+SmyAke3QoJ2Zhdm9yaXRlX3JlbW92ZScpfWAgOiBg8J+kjSAke3QoJ2Zhdm9yaXRlX2FkZCcpfWA7IH07IHBhaW50KCk7CiAgY29uc3QgYm9keSA9IGgoJ2RpdicsIHsgY2xhc3M6ICdzdGFjaycgfSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkIGNlbnRlcicgfSwgaCgnZGl2JywgeyBjbGFzczogJ2F2YXRhcicsIHN0eWxlOiB7IG1hcmdpbjogJzAgYXV0byA4cHgnLCB3aWR0aDogJzY0cHgnLCBoZWlnaHQ6ICc2NHB4JywgZm9udFNpemU6ICcyNnB4JyB9IH0sIHAubmFtZS5zbGljZSgwLCAxKSksIGgoJ2gyJywgbnVsbCwgcC5uYW1lKSwgaCgnZGl2JywgeyBjbGFzczogJ211dGVkJyB9LCBwLmFjdGl2aXR5IHx8ICcnKSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdyB3cmFwJywgc3R5bGU6IHsganVzdGlmeUNvbnRlbnQ6ICdjZW50ZXInLCBtYXJnaW5Ub3A6ICc4cHgnIH0gfSwgc3RhcnMocC5yYXRpbmdfYXZnLCBwLnJhdGluZ19jb3VudCksIHZlcmlmaWVkQmFkZ2UocC52ZXJpZmllZCkpLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQgbXQnIH0sIFtwLmxvY2F0aW9uX2xhYmVsICYmIGDwn5ONICR7cC5sb2NhdGlvbl9sYWJlbH1gLCBwLndvcmtpbmdfaG91cnMgJiYgYPCflZIgJHtwLndvcmtpbmdfaG91cnN9YCwgYCR7cC5jb21wbGV0ZWRfb3JkZXJzfSAke3QoJ2NvbXBsZXRlZF9vcmRlcnMnKX1gXS5maWx0ZXIoQm9vbGVhbikuam9pbignIOKAoiAnKSksIHAuZGVzY3JpcHRpb24gJiYgaCgncCcsIG51bGwsIHAuZGVzY3JpcHRpb24pLCBmYXZCdG4pLAogICAgZC5wcm9kdWN0cy5sZW5ndGggPiAwICYmIGgoJ2RpdicsIG51bGwsIGgoJ2RpdicsIHsgY2xhc3M6ICdzZWN0aW9uLXRpdGxlJyB9LCB0KCdwcm9kdWN0cycpKSwgZC5wcm9kdWN0cy5tYXAoKHgpID0+IGgoJ2RpdicsIHsgY2xhc3M6ICdsaXN0LWl0ZW0nLCBzdHlsZTogeyBjdXJzb3I6ICdkZWZhdWx0JyB9IH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnYicgfSwgeC50aXRsZSksIGgoJ2RpdicsIHsgY2xhc3M6ICdzbWFsbCBtdXRlZCcgfSwgY29uZGl0aW9uTGFiZWwoeC5jb25kaXRpb24pKSksIGgoJ2RpdicsIHsgY2xhc3M6ICdiJyB9LCBtb25leSh4LnByaWNlKSkpKSksCiAgICBkLnNlcnZpY2VzLmxlbmd0aCA+IDAgJiYgaCgnZGl2JywgbnVsbCwgaCgnZGl2JywgeyBjbGFzczogJ3NlY3Rpb24tdGl0bGUnIH0sIHQoJ3NlcnZpY2VzJykpLCBkLnNlcnZpY2VzLm1hcCgoeCkgPT4gaCgnZGl2JywgeyBjbGFzczogJ2xpc3QtaXRlbScsIHN0eWxlOiB7IGN1cnNvcjogJ2RlZmF1bHQnIH0gfSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cgYicgfSwgeC50aXRsZSksIGgoJ2RpdicsIHsgY2xhc3M6ICdiJyB9LCB4LnByaWNlX2Zyb20gIT0gbnVsbCA/IG1vbmV5KHgucHJpY2VfZnJvbSkgOiAnJykpKSksCiAgICBoKCdkaXYnLCBudWxsLCBoKCdkaXYnLCB7IGNsYXNzOiAnc2VjdGlvbi10aXRsZScgfSwgdCgncmV2aWV3cycpKSwgZC5yZXZpZXdzLmxlbmd0aCA/IGQucmV2aWV3cy5tYXAoKHJ2KSA9PiBoKCdkaXYnLCB7IGNsYXNzOiAnY2FyZCcgfSwgaCgnZGl2JywgeyBjbGFzczogJ3JvdyBzcCcgfSwgaCgnc3BhbicsIHsgY2xhc3M6ICdzdGFycycgfSwgJ+KYhScucmVwZWF0KHJ2LnJhdGluZykpLCBoKCdzcGFuJywgeyBjbGFzczogJ3RpbnkgbXV0ZWQnIH0sIGFnbyhydi5jcmVhdGVkX2F0KSkpLCBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgYicgfSwgcnYuYXV0aG9yKSwgcnYuY29tbWVudCAmJiBoKCdkaXYnLCBudWxsLCBydi5jb21tZW50KSkpIDogaCgnZGl2JywgeyBjbGFzczogJ211dGVkJyB9LCB0KCdub19yZXZpZXdzJykpKSk7CiAgcmV0dXJuIHsgdGl0bGU6IHAubmFtZSwgYmFjazogdHJ1ZSwgYm9keSB9Owp9CgovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gTk9USUZJQ0FUSU9OUyAvIEZBVk9SSVRFUyAvIFBST0ZJTEUgLyBIRUxQID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQphc3luYyBmdW5jdGlvbiBub3RpZmljYXRpb25zUGFnZSgpIHsKICBjb25zdCBkID0gYXdhaXQgR0VUKCcvYXBpL25vdGlmaWNhdGlvbnMnKTsKICBjb25zdCBib2R5ID0gaCgnZGl2JywgbnVsbCwgZC51bnJlYWQgPiAwICYmIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZ2hvc3Qgc20gbWInLCBvbkNsaWNrOiBhc3luYyAoKSA9PiB7IGF3YWl0IFBPU1QoJy9hcGkvbm90aWZpY2F0aW9ucy9yZWFkLWFsbCcpOyBzdGF0ZS51bnJlYWQgPSAwOyBnbyhgL25vdGlmaWNhdGlvbnM/cj0ke0RhdGUubm93KCl9YCk7IH0gfSwgdCgnbWFya19hbGxfcmVhZCcpKSwKICAgIGQubm90aWZpY2F0aW9ucy5sZW5ndGggPyBkLm5vdGlmaWNhdGlvbnMubWFwKChuKSA9PiBoKCdkaXYnLCB7IGNsYXNzOiBgbGlzdC1pdGVtJHtuLnJlYWRfYXQgPyAnJyA6ICcgdW5yZWFkJ31gLCBvbkNsaWNrOiBhc3luYyAoKSA9PiB7IGF3YWl0IFBPU1QoYC9hcGkvbm90aWZpY2F0aW9ucy8ke24uaWR9L3JlYWRgKS5jYXRjaCgoKSA9PiB7fSk7IGlmIChuLmxpbmspIGxvY2F0aW9uLmhhc2ggPSBuLmxpbmsucmVwbGFjZSgvXiMvLCAnIycpOyB9IH0sCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdhdmF0YXInIH0sIHsgbmV3X29mZmVyOiAn8J+Pt++4jycsIG5ld19yZXF1ZXN0OiAn8J+TpScsIG5ld19tZXNzYWdlOiAn8J+SrCcsIG9mZmVyX2FjY2VwdGVkOiAn4pyFJywgcmVxdWVzdF9jYW5jZWxsZWQ6ICfwn5qrJywgc3RhdHVzX2NoYW5nZWQ6ICfwn5SUJyB9W24udHlwZV0gfHwgJ/CflJQnKSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiIHNtYWxsJyB9LCBuLnRpdGxlKSwgbi5ib2R5ICYmIGgoJ2RpdicsIHsgY2xhc3M6ICdzbWFsbCBtdXRlZCcgfSwgbi5ib2R5KSwgaCgnZGl2JywgeyBjbGFzczogJ3RpbnkgbXV0ZWQnIH0sIGFnbyhuLmNyZWF0ZWRfYXQpKSkpKSA6IGVtcHR5U3RhdGUoJ/CflJQnLCB0KCdub19ub3RpZnMnKSkpOwogIHJldHVybiB7IHRpdGxlOiB0KCdub3RpZmljYXRpb25zJyksIGJhY2s6IHRydWUsIGJvZHkgfTsKfQphc3luYyBmdW5jdGlvbiBmYXZvcml0ZXNQYWdlKCkgewogIGNvbnN0IHsgZmF2b3JpdGVzIH0gPSBhd2FpdCBHRVQoJy9hcGkvZmF2b3JpdGVzJyk7CiAgcmV0dXJuIHsgdGl0bGU6IHQoJ2Zhdm9yaXRlcycpLCBiYWNrOiAnL3Byb2ZpbGUnLCBib2R5OiBmYXZvcml0ZXMubGVuZ3RoID8gZmF2b3JpdGVzLm1hcCgocCkgPT4gaCgnZGl2JywgeyBjbGFzczogJ2xpc3QtaXRlbScsIG9uQ2xpY2s6ICgpID0+IGdvKGAvcHJvdmlkZXItcHJvZmlsZS8ke3AuaWR9YCkgfSwgaCgnZGl2JywgeyBjbGFzczogJ2F2YXRhcicgfSwgcC5uYW1lLnNsaWNlKDAsIDEpKSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiJyB9LCBwLm5hbWUpLCBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQnIH0sIHAubG9jYXRpb25fbGFiZWwpKSwgc3RhcnMocC5yYXRpbmdfYXZnLCBwLnJhdGluZ19jb3VudCkpKSA6IGVtcHR5U3RhdGUoJ/CfkpsnLCB0KCdub19mYXZzJykpIH07Cn0KZnVuY3Rpb24gcHJvZmlsZVBhZ2UoKSB7CiAgY29uc3QgdSA9IHN0YXRlLnVzZXI7CiAgY29uc3QgaXRlbSA9IChpY29uLCBsYWJlbCwgcGF0aCwgZXh0cmEpID0+IGgoJ2RpdicsIHsgY2xhc3M6ICdsaXN0LWl0ZW0nLCBvbkNsaWNrOiAoKSA9PiAodHlwZW9mIHBhdGggPT09ICdmdW5jdGlvbicgPyBwYXRoKCkgOiBnbyhwYXRoKSkgfSwgaCgnc3BhbicsIHsgc3R5bGU6IHsgZm9udFNpemU6ICcyMnB4JyB9IH0sIGljb24pLCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdyBiJyB9LCBsYWJlbCksIGV4dHJhKTsKICBjb25zdCBib2R5ID0gaCgnZGl2JywgbnVsbCwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkIHJvdycgfSwgaCgnZGl2JywgeyBjbGFzczogJ2F2YXRhcicsIHN0eWxlOiB7IHdpZHRoOiAnNTZweCcsIGhlaWdodDogJzU2cHgnLCBmb250U2l6ZTogJzIycHgnIH0gfSwgdS5uYW1lLnNsaWNlKDAsIDEpKSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdiJyB9LCB1Lm5hbWUpLCBoKCdkaXYnLCB7IGNsYXNzOiAnc21hbGwgbXV0ZWQgbHRyJyB9LCB1LmVtYWlsIHx8IHUucGhvbmUgfHwgJycpKSksCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnbXQnIH0sIC4uLih1LnJvbGUgPT09ICd1c2VyJyA/IFtpdGVtKCfwn5KbJywgdCgnZmF2b3JpdGVzJyksICcvZmF2b3JpdGVzJyldIDogW10pLCBpdGVtKCfwn5SUJywgdCgnbm90aWZpY2F0aW9ucycpLCAnL25vdGlmaWNhdGlvbnMnKSwgaXRlbSgn4pqZ77iPJywgdCgnc2V0dGluZ3MnKSwgJy9zZXR0aW5ncycpLCBpdGVtKCfwn5ufJywgdCgnaGVscCcpLCAnL2hlbHAnKSwKICAgICAgdS5yb2xlID09PSAncHJvdmlkZXInICYmIGl0ZW0oJ/Cfj6onLCB0KCdwcm92X2Rhc2hib2FyZCcpLCAnL3Byb3ZpZGVyJyksIGl0ZW0oJ/CfmqonLCB0KCdsb2dvdXQnKSwgbG9nb3V0KSkpOwogIHJldHVybiB7IHRpdGxlOiB0KCdwcm9maWxlJyksIGJvZHkgfTsKfQpmdW5jdGlvbiBzZXR0aW5nc1BhZ2UoKSB7CiAgY29uc3QgbmFtZSA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgdmFsdWU6IHN0YXRlLnVzZXIubmFtZSB9KTsKICBjb25zdCBjdXIgPSBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcsIHR5cGU6ICdwYXNzd29yZCcsIGRpcjogJ2x0cicgfSk7IGNvbnN0IG53ID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCB0eXBlOiAncGFzc3dvcmQnLCBkaXI6ICdsdHInIH0pOwogIGNvbnN0IHdpbCA9IHNlbGVjdChbWycnLCB0KCdjaG9vc2UnKV0sIC4uLnN0YXRlLm1ldGEud2lsYXlhcy5tYXAoKHcpID0+IFt3LmNvZGUsIGAke1N0cmluZyh3LmNvZGUpLnBhZFN0YXJ0KDIsICcwJyl9IC0gJHtuYW1lT2Yodyl9YF0pXSwgc3RhdGUudXNlci53aWxheWFfY29kZSB8fCAnJyk7CiAgY29uc3QgYm9keSA9IGgoJ2RpdicsIHsgY2xhc3M6ICdzdGFjaycgfSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnYiBtYicgfSwgdCgnbGFuZ3VhZ2UnKSksIGgoJ2RpdicsIHsgY2xhc3M6ICdsYW5nc3dpdGNoJyB9LCBMT0NBTEVTLm1hcCgoW2MsIGxdKSA9PiBoKCdidXR0b24nLCB7IGNsYXNzOiBjID09PSBnZXRMb2NhbGUoKSA/ICdvbicgOiAnJywgb25DbGljazogYXN5bmMgKCkgPT4geyBhd2FpdCBQQVRDSCgnL2FwaS9tZScsIHsgbG9jYWxlOiBjIH0pLmNhdGNoKCgpID0+IHt9KTsgY2hhbmdlTG9jYWxlKGMpOyB9IH0sIGwpKSkpLAogICAgaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIGZpZWxkKHQoJ25hbWUnKSwgbmFtZSksIGZpZWxkKHQoJ3dpbGF5YScpLCB3aWwpLCBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7IGF3YWl0IFBBVENIKCcvYXBpL21lJywgeyBuYW1lOiBuYW1lLnZhbHVlLCB3aWxheWFfY29kZTogd2lsLnZhbHVlID8gTnVtYmVyKHdpbC52YWx1ZSkgOiBudWxsIH0pOyBzdGF0ZS51c2VyLm5hbWUgPSBuYW1lLnZhbHVlOyBzdGF0ZS51c2VyLndpbGF5YV9jb2RlID0gd2lsLnZhbHVlID8gTnVtYmVyKHdpbC52YWx1ZSkgOiBudWxsOyB0b2FzdCh0KCdzYXZlZCcpLCAnb2snKTsgfSkgfSwgdCgnc2F2ZScpKSksCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnY2FyZCcgfSwgaCgnZGl2JywgeyBjbGFzczogJ2IgbWInIH0sIHQoJ2NoYW5nZV9wYXNzd29yZCcpKSwgZmllbGQodCgnY3VycmVudF9wYXNzd29yZCcpLCBjdXIpLCBmaWVsZCh0KCduZXdfcGFzc3dvcmQnKSwgbncsIHQoJ3B3X2hpbnQnKSksCiAgICAgIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZGFyayBibG9jaycsIG9uQ2xpY2s6IChlKSA9PiBndWFyZGVkKGUuY3VycmVudFRhcmdldCwgYXN5bmMgKCkgPT4geyBhd2FpdCBQT1NUKCcvYXBpL21lL3Bhc3N3b3JkJywgeyBjdXJyZW50OiBjdXIudmFsdWUsIG5leHQ6IG53LnZhbHVlIH0pOyBjdXIudmFsdWUgPSBudy52YWx1ZSA9ICcnOyB0b2FzdCh0KCdzYXZlZCcpLCAnb2snKTsgfSkgfSwgdCgnc2F2ZScpKSkpOwogIHJldHVybiB7IHRpdGxlOiB0KCdzZXR0aW5ncycpLCBiYWNrOiAnL3Byb2ZpbGUnLCBib2R5IH07Cn0KZnVuY3Rpb24gaGVscFBhZ2UoKSB7CiAgY29uc3Qgc3ViaiA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JyB9KTsgY29uc3QgYmQgPSBoKCd0ZXh0YXJlYScsIHsgY2xhc3M6ICdpbnB1dCcgfSk7CiAgY29uc3QgYm9keSA9IGgoJ2RpdicsIHsgY2xhc3M6ICdzdGFjaycgfSwgaCgnZGl2JywgeyBjbGFzczogJ2InLCBzdHlsZTogeyBmb250U2l6ZTogJzE4cHgnIH0gfSwgdCgnaGVscF9pbnRybycpKSwKICAgIFsxLCAyLCAzLCA0XS5tYXAoKGkpID0+IGgoJ2RldGFpbHMnLCB7IGNsYXNzOiAnY2FyZCcgfSwgaCgnc3VtbWFyeScsIHsgY2xhc3M6ICdiJyB9LCB0KGBmYXEke2l9X3FgKSksIGgoJ3AnLCBudWxsLCB0KGBmYXEke2l9X2FgKSkpKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnYiBtYicgfSwgdCgnY29tcGxhaW50JykpLCBmaWVsZCh0KCdjb21wbGFpbnRfc3ViamVjdCcpLCBzdWJqKSwgZmllbGQodCgnY29tcGxhaW50X2JvZHknKSwgYmQpLAogICAgICBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgb25DbGljazogKGUpID0+IGd1YXJkZWQoZS5jdXJyZW50VGFyZ2V0LCBhc3luYyAoKSA9PiB7IGF3YWl0IFBPU1QoJy9hcGkvY29tcGxhaW50cycsIHsgc3ViamVjdDogc3Viai52YWx1ZSwgYm9keTogYmQudmFsdWUgfSk7IHN1YmoudmFsdWUgPSBiZC52YWx1ZSA9ICcnOyB0b2FzdCh0KCdjb21wbGFpbnRfc2VudCcpLCAnb2snKTsgfSkgfSwgdCgnc2VuZCcpKSkpOwogIHJldHVybiB7IHRpdGxlOiB0KCdoZWxwJyksIGJhY2s6ICcvcHJvZmlsZScsIGJvZHkgfTsKfQoKZXhwb3J0IGNvbnN0IHVzZXJSb3V0ZXMgPSBbCiAgWycvJywgaG9tZV0sIFsnL25ldycsIGNyZWF0ZVBhZ2VdLCBbJy9zZWFyY2hpbmcvOmlkJywgc2VhcmNoaW5nUGFnZV0sIFsnL3JlcXVlc3QvOmlkJywgcmVxdWVzdFBhZ2VdLCBbJy9vZmZlci86cmlkLzpvaWQnLCBvZmZlclBhZ2VdLCBbJy9jb21wYXJlLzpyaWQnLCBjb21wYXJlUGFnZV0sCiAgWycvcmVxdWVzdHMnLCByZXF1ZXN0c1BhZ2VdLCBbJy9jaGF0cycsIGNoYXRzUGFnZV0sIFsnL2NoYXQvOnJpZC86cGlkJywgY2hhdFBhZ2VdLCBbJy9wcm92aWRlci1wcm9maWxlLzppZCcsIHByb3ZpZGVyUHJvZmlsZVBhZ2VdLAogIFsnL25vdGlmaWNhdGlvbnMnLCBub3RpZmljYXRpb25zUGFnZV0sIFsnL2Zhdm9yaXRlcycsIGZhdm9yaXRlc1BhZ2VdLCBbJy9wcm9maWxlJywgcHJvZmlsZVBhZ2VdLCBbJy9zZXR0aW5ncycsIHNldHRpbmdzUGFnZV0sIFsnL2hlbHAnLCBoZWxwUGFnZV0sCl07CmV4cG9ydCB7IGNoYXRQYWdlLCBjaGF0c1BhZ2UgfTsK", "base64") },
  "js/pages/public.js": { path: "js/pages/public.js", buf: Buffer.from("aW1wb3J0IHsgR0VULCBQT1NULCBzZXRUb2tlbiB9IGZyb20gJy4uL2FwaS5qcyc7CmltcG9ydCB7IGgsIHQsIGJyYW5kLCBsb2dvU3ZnLCBmaWVsZCwgc2VsZWN0LCB0b2FzdCwgZXJyTXNnLCBndWFyZGVkLCBuYW1lT2YgfSBmcm9tICcuLi91aS5qcyc7CmltcG9ydCB7IExPQ0FMRVMsIGdldExvY2FsZSB9IGZyb20gJy4uL2kxOG4uanMnOwppbXBvcnQgeyBzdGF0ZSwgZ28sIGhvbWVQYXRoLCBjaGFuZ2VMb2NhbGUsIGxvYWRTZXNzaW9uIH0gZnJvbSAnLi4vY29yZS5qcyc7Cgpjb25zdCBzZWVuID0gKCkgPT4geyB0cnkgeyByZXR1cm4gbG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2JzX29uYm9hcmRlZCcpID09PSAnMSc7IH0gY2F0Y2ggeyByZXR1cm4gdHJ1ZTsgfSB9Owpjb25zdCBtYXJrU2VlbiA9ICgpID0+IHsgdHJ5IHsgbG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2JzX29uYm9hcmRlZCcsICcxJyk7IH0gY2F0Y2ggeyAvKiAqLyB9IH07CgpmdW5jdGlvbiBsYW5nU3dpdGNoKCkgewogIHJldHVybiBoKCdkaXYnLCB7IGNsYXNzOiAnbGFuZ3N3aXRjaCcgfSwgTE9DQUxFUy5tYXAoKFtjb2RlLCBsYWJlbF0pID0+IGgoJ2J1dHRvbicsIHsgY2xhc3M6IGNvZGUgPT09IGdldExvY2FsZSgpID8gJ29uJyA6ICcnLCBvbkNsaWNrOiAoKSA9PiBjaGFuZ2VMb2NhbGUoY29kZSkgfSwgbGFiZWwpKSk7Cn0KCmZ1bmN0aW9uIHNwbGFzaCgpIHsKICBjb25zdCBib2R5ID0gaCgnZGl2JywgeyBjbGFzczogJ3NwbGFzaCcgfSwgaCgnZGl2JywgbnVsbCwgaCgnZGl2JywgeyBzdHlsZTogeyBkaXNwbGF5OiAnaW5saW5lLWJsb2NrJyB9IH0sIGxvZ29TdmcoNzQpKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICduYW1lIGdvbGQtdGV4dCcsIHN0eWxlOiB7IGZvbnRTaXplOiAnNDZweCcsIGZvbnRXZWlnaHQ6IDkwMCwgbWFyZ2luVG9wOiAnMTBweCcgfSB9LCB0KCdhcHBfbmFtZScpKSwgaCgncCcsIHsgc3R5bGU6IHsgY29sb3I6ICcjY2ZjOWI2JywgZm9udFNpemU6ICcxOHB4JyB9IH0sIHQoJ3RhZ2xpbmUnKSkpKTsKICByZXR1cm4geyBiYXJlOiB0cnVlLCBib2R5IH07Cn0KCmZ1bmN0aW9uIG9uYm9hcmRpbmcoc3RlcCA9IDApIHsKICBjb25zdCBzbGlkZXMgPSBbWyfwn5KsJywgJ29uYjFfdCcsICdvbmIxX3AnXSwgWyfwn6SWJywgJ29uYjJfdCcsICdvbmIyX3AnXSwgWyfwn46vJywgJ29uYjNfdCcsICdvbmIzX3AnXV07CiAgY29uc3QgZHJhdyA9IChpKSA9PiB7CiAgICBjb25zdCBbYXJ0LCB0dCwgcHBdID0gc2xpZGVzW2ldOwogICAgY29uc3QgbGFzdCA9IGkgPT09IHNsaWRlcy5sZW5ndGggLSAxOwogICAgY29uc3Qgcm9vdCA9IGgoJ2RpdicsIHsgY2xhc3M6ICdvbmInIH0sCiAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgc3AnIH0sIGJyYW5kKDMwKSwgbGFuZ1N3aXRjaCgpKSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ2FydCcgfSwgYXJ0KSwKICAgICAgaCgnZGl2JywgeyBjbGFzczogJ2RvdHMnIH0sIHNsaWRlcy5tYXAoKF8sIGspID0+IGgoJ2knLCB7IGNsYXNzOiBrID09PSBpID8gJ29uJyA6ICcnIH0pKSksCiAgICAgIGgoJ2gyJywgbnVsbCwgdCh0dCkpLCBoKCdwJywgbnVsbCwgdChwcCkpLAogICAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93JyB9LAogICAgICAgICFsYXN0ICYmIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdidG4gZ2hvc3QnLCBzdHlsZTogeyBjb2xvcjogJyNmZmYnLCBib3JkZXJDb2xvcjogJyM0NDQnIH0sIG9uQ2xpY2s6ICgpID0+IHsgbWFya1NlZW4oKTsgZ28oJy9sb2dpbicpOyB9IH0sIHQoJ3NraXAnKSksCiAgICAgICAgaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBncm93Jywgb25DbGljazogKCkgPT4geyBpZiAobGFzdCkgeyBtYXJrU2VlbigpOyBnbygnL3JlZ2lzdGVyJyk7IH0gZWxzZSB7IGNvbnN0IG4gPSBkcmF3KGkgKyAxKTsgcm9vdC5yZXBsYWNlV2l0aChuKTsgfSB9IH0sIGxhc3QgPyB0KCdzdGFydCcpIDogdCgnbmV4dCcpKSkpOwogICAgcmV0dXJuIHJvb3Q7CiAgfTsKICByZXR1cm4geyBiYXJlOiB0cnVlLCBib2R5OiBkcmF3KHN0ZXApIH07Cn0KCmZ1bmN0aW9uIGF1dGhTaGVsbCh0aXRsZSwgZm9ybSwgZm9vdGVyKSB7CiAgcmV0dXJuIHsgYmFyZTogdHJ1ZSwgYm9keTogaCgnZGl2JywgeyBjbGFzczogJ2F1dGh3cmFwJyB9LAogICAgaCgnZGl2JywgeyBjbGFzczogJ2F1dGhoZWFkJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAncm93IHNwJyB9LCBicmFuZCgzNCksIGxhbmdTd2l0Y2goKSksIGgoJ2gyJywgeyBzdHlsZTogeyBtYXJnaW5Ub3A6ICcyMnB4JywgZm9udFNpemU6ICcyNnB4JyB9IH0sIHRpdGxlKSwgaCgncCcsIHsgc3R5bGU6IHsgY29sb3I6ICcjY2ZjOWI2JywgbWFyZ2luOiAnNnB4IDAgMCcgfSB9LCB0KCd0YWdsaW5lJykpKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdhdXRoYm9keScgfSwgaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIGZvcm0pLCBmb290ZXIpKSB9Owp9Cgphc3luYyBmdW5jdGlvbiBhZnRlckF1dGgocmVzKSB7CiAgc2V0VG9rZW4ocmVzLnRva2VuKTsKICBhd2FpdCBsb2FkU2Vzc2lvbigpOwogIGdvKGhvbWVQYXRoKCkpOwp9CgpmdW5jdGlvbiBsb2dpblBhZ2UoKSB7CiAgY29uc3QgaWQgPSBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcsIGF1dG9jb21wbGV0ZTogJ3VzZXJuYW1lJywgaW5wdXRtb2RlOiAnZW1haWwnLCBkaXI6ICdsdHInIH0pOwogIGNvbnN0IHB3ID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCB0eXBlOiAncGFzc3dvcmQnLCBhdXRvY29tcGxldGU6ICdjdXJyZW50LXBhc3N3b3JkJywgZGlyOiAnbHRyJyB9KTsKICBjb25zdCBlcnIgPSBoKCdkaXYnLCB7IGNsYXNzOiAnZXJyJyB9KTsKICBjb25zdCBidG4gPSBoKCdidXR0b24nLCB7IGNsYXNzOiAnYnRuIGJsb2NrJywgdHlwZTogJ3N1Ym1pdCcgfSwgdCgnbG9naW4nKSk7CiAgY29uc3QgZm9ybSA9IGgoJ2Zvcm0nLCB7IG9uU3VibWl0OiAoZSkgPT4geyBlLnByZXZlbnREZWZhdWx0KCk7IGVyci50ZXh0Q29udGVudCA9ICcnOwogICAgZ3VhcmRlZChidG4sIGFzeW5jICgpID0+IHsgdHJ5IHsgYXdhaXQgYWZ0ZXJBdXRoKGF3YWl0IFBPU1QoJy9hcGkvYXV0aC9sb2dpbicsIHsgaWRlbnRpZmllcjogaWQudmFsdWUsIHBhc3N3b3JkOiBwdy52YWx1ZSB9KSk7IH0gY2F0Y2ggKHgpIHsgZXJyLnRleHRDb250ZW50ID0gZXJyTXNnKHgpOyB9IH0pOyB9IH0sCiAgICBmaWVsZCh0KCdlbWFpbF9vcl9waG9uZScpLCBpZCksIGZpZWxkKHQoJ3Bhc3N3b3JkJyksIHB3KSwgZXJyLCBidG4pOwogIGNvbnN0IGRlbW8gPSBoKCdkaXYnLCB7IGNsYXNzOiAnY2FyZCBtdCBzbWFsbCcgfSwgaCgnZGl2JywgeyBjbGFzczogJ2IgbWInIH0sIHQoJ2RlbW9fYWNjb3VudHMnKSksCiAgICBoKCdkaXYnLCB7IGNsYXNzOiAnY2hpcHMnIH0sICh3aW5kb3cuX19ERU1PX0FDQ09VTlRTIHx8IFtbJ2RlbW8udXNlckBibGFzaGFxYS5keicsICfwn5GkINiy2KjZiNmGJ10sIFsnZGVtby5hbWluZUBibGFzaGFxYS5keicsICfwn4+qINio2KfYpti5J10sIFsnZGVtby55b3VjZWZAYmxhc2hhcWEuZHonLCAn8J+UpyDZg9mH2LHYqNin2KbZiiddXSkubWFwKChbZSwgbF0pID0+CiAgICAgIGgoJ2J1dHRvbicsIHsgY2xhc3M6ICdjaGlwIGxpZ2h0JywgdHlwZTogJ2J1dHRvbicsIG9uQ2xpY2s6ICgpID0+IHsgaWQudmFsdWUgPSBlOyBwdy52YWx1ZSA9ICdEZW1vMTIzNDUnOyB9IH0sIGwpKSkpOwogIHJldHVybiBhdXRoU2hlbGwodCgnbG9naW4nKSwgZm9ybSwgaCgnZGl2JywgbnVsbCwgaCgncCcsIHsgY2xhc3M6ICdjZW50ZXIgbXQnIH0sIHQoJ25vX2FjY291bnQnKSwgJyAnLCBoKCdhJywgeyBocmVmOiAnIy9yZWdpc3RlcicsIGNsYXNzOiAnYicsIHN0eWxlOiB7IGNvbG9yOiAndmFyKC0tZ3JlZW4pJyB9IH0sIHQoJ3JlZ2lzdGVyJykpKSwgZGVtbykpOwp9Cgphc3luYyBmdW5jdGlvbiByZWdpc3RlclBhZ2UoKSB7CiAgbGV0IHJvbGUgPSAndXNlcic7CiAgY29uc3Qgd3JhcCA9IGgoJ2RpdicpOwogIGNvbnN0IG5hbWUgPSBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcsIGF1dG9jb21wbGV0ZTogJ25hbWUnIH0pOwogIGNvbnN0IGVtYWlsID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCBpbnB1dG1vZGU6ICdlbWFpbCcsIGRpcjogJ2x0cicsIGF1dG9jb21wbGV0ZTogJ2VtYWlsJyB9KTsKICBjb25zdCBwaG9uZSA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgaW5wdXRtb2RlOiAndGVsJywgZGlyOiAnbHRyJywgYXV0b2NvbXBsZXRlOiAndGVsJywgcGxhY2Vob2xkZXI6ICcwNTUwIDAwIDAwIDAwJyB9KTsKICBjb25zdCBwdyA9IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgdHlwZTogJ3Bhc3N3b3JkJywgYXV0b2NvbXBsZXRlOiAnbmV3LXBhc3N3b3JkJywgZGlyOiAnbHRyJyB9KTsKICBjb25zdCB3aWwgPSBzZWxlY3QoW1snJywgdCgnY2hvb3NlJyldLCAuLi5zdGF0ZS5tZXRhLndpbGF5YXMubWFwKCh3KSA9PiBbdy5jb2RlLCBgJHtTdHJpbmcody5jb2RlKS5wYWRTdGFydCgyLCAnMCcpfSAtICR7bmFtZU9mKHcpfWBdKV0sICcnKTsKICBjb25zdCBjb20gPSBzZWxlY3QoW1snJywgdCgnY2hvb3NlJyldXSwgJycpOwogIHdpbC5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCBhc3luYyAoKSA9PiB7CiAgICBjb20ucmVwbGFjZUNoaWxkcmVuKGgoJ29wdGlvbicsIHsgdmFsdWU6ICcnIH0sIHQoJ2Nob29zZScpKSk7CiAgICBpZiAoIXdpbC52YWx1ZSkgcmV0dXJuOwogICAgY29uc3QgbGlzdCA9IGF3YWl0IEdFVChgL2FwaS9jb21tdW5lcz93aWxheWE9JHt3aWwudmFsdWV9YCk7CiAgICBsaXN0LmZvckVhY2goKGMpID0+IGNvbS5hcHBlbmQoaCgnb3B0aW9uJywgeyB2YWx1ZTogYy5pZCB9LCBuYW1lT2YoYykpKSk7CiAgfSk7CiAgY29uc3QgYml6ID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnIH0pOyBjb25zdCBhY3QgPSBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcgfSk7IGNvbnN0IGRlc2MgPSBoKCd0ZXh0YXJlYScsIHsgY2xhc3M6ICdpbnB1dCcgfSk7IGNvbnN0IGhvdXJzID0gaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnIH0pOwogIGNvbnN0IGNhdHMgPSBuZXcgU2V0KCk7CiAgY29uc3QgY2F0Q2hpcHMgPSBoKCdkaXYnLCB7IGNsYXNzOiAnY2hpcHMnIH0sIHN0YXRlLm1ldGEuY2F0ZWdvcmllcy5tYXAoKGMpID0+IHsgY29uc3QgZWwgPSBoKCdidXR0b24nLCB7IHR5cGU6ICdidXR0b24nLCBjbGFzczogJ2NoaXAgbGlnaHQnLCBvbkNsaWNrOiAoKSA9PiB7IGNhdHMuaGFzKGMuc2x1ZykgPyBjYXRzLmRlbGV0ZShjLnNsdWcpIDogY2F0cy5hZGQoYy5zbHVnKTsgZWwuY2xhc3NMaXN0LnRvZ2dsZSgnb24nKTsgfSB9LCBgJHtjLmljb259ICR7bmFtZU9mKGMpfWApOyByZXR1cm4gZWw7IH0pKTsKICBjb25zdCBwcm92Qm94ID0gaCgnZGl2JywgeyBjbGFzczogJ2hpZGRlbicgfSwgaCgnZGl2JywgeyBjbGFzczogJ2RpdmlkZXInIH0pLCBmaWVsZCh0KCdidXNpbmVzc19uYW1lJyksIGJpeiksIGZpZWxkKHQoJ2FjdGl2aXR5JyksIGFjdCksIGZpZWxkKHQoJ2Rlc2NyaXB0aW9uJyksIGRlc2MpLCBmaWVsZCh0KCd3b3JraW5nX2hvdXJzJyksIGhvdXJzKSwgZmllbGQodCgnY2F0ZWdvcmllc19zZXJ2ZWQnKSwgY2F0Q2hpcHMpLAogICAgaCgncCcsIHsgY2xhc3M6ICdzbWFsbCBtdXRlZCcgfSwgdCgncHJvdmlkZXJfcGVuZGluZ19ub3RlJykpKTsKICBjb25zdCBzZWcgPSBoKCdkaXYnLCB7IGNsYXNzOiAnc2VnJyB9LCBbWyd1c2VyJywgdCgnaV9hbV91c2VyJyldLCBbJ3Byb3ZpZGVyJywgdCgnaV9hbV9wcm92aWRlcicpXV0ubWFwKChbciwgbF0pID0+CiAgICBoKCdidXR0b24nLCB7IHR5cGU6ICdidXR0b24nLCBjbGFzczogciA9PT0gcm9sZSA/ICdvbicgOiAnJywgb25DbGljazogKGUpID0+IHsgcm9sZSA9IHI7IHNlZy5xdWVyeVNlbGVjdG9yQWxsKCdidXR0b24nKS5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC5yZW1vdmUoJ29uJykpOyBlLnRhcmdldC5jbGFzc0xpc3QuYWRkKCdvbicpOyBwcm92Qm94LmNsYXNzTGlzdC50b2dnbGUoJ2hpZGRlbicsIHIgIT09ICdwcm92aWRlcicpOyB9IH0sIGwpKSk7CiAgY29uc3QgZXJyID0gaCgnZGl2JywgeyBjbGFzczogJ2VycicgfSk7CiAgY29uc3QgYnRuID0gaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBibG9jaycsIHR5cGU6ICdzdWJtaXQnIH0sIHQoJ3JlZ2lzdGVyJykpOwogIGNvbnN0IGZvcm0gPSBoKCdmb3JtJywgeyBvblN1Ym1pdDogKGUpID0+IHsgZS5wcmV2ZW50RGVmYXVsdCgpOyBlcnIudGV4dENvbnRlbnQgPSAnJzsKICAgIGd1YXJkZWQoYnRuLCBhc3luYyAoKSA9PiB7IHRyeSB7CiAgICAgIGNvbnN0IGJvZHkgPSB7IG5hbWU6IG5hbWUudmFsdWUsIGVtYWlsOiBlbWFpbC52YWx1ZSB8fCB1bmRlZmluZWQsIHBob25lOiBwaG9uZS52YWx1ZSB8fCB1bmRlZmluZWQsIHBhc3N3b3JkOiBwdy52YWx1ZSwgcm9sZSwgd2lsYXlhX2NvZGU6IHdpbC52YWx1ZSB8fCB1bmRlZmluZWQsIGNvbW11bmVfaWQ6IGNvbS52YWx1ZSB8fCB1bmRlZmluZWQgfTsKICAgICAgaWYgKHJvbGUgPT09ICdwcm92aWRlcicpIGJvZHkucHJvdmlkZXIgPSB7IGJ1c2luZXNzX25hbWU6IGJpei52YWx1ZSB8fCBuYW1lLnZhbHVlLCBhY3Rpdml0eTogYWN0LnZhbHVlLCBkZXNjcmlwdGlvbjogZGVzYy52YWx1ZSwgd29ya2luZ19ob3VyczogaG91cnMudmFsdWUsIGNhdGVnb3J5X3NsdWdzOiBbLi4uY2F0c10gfTsKICAgICAgYXdhaXQgYWZ0ZXJBdXRoKGF3YWl0IFBPU1QoJy9hcGkvYXV0aC9yZWdpc3RlcicsIGJvZHkpKTsKICAgIH0gY2F0Y2ggKHgpIHsgZXJyLnRleHRDb250ZW50ID0gZXJyTXNnKHgpOyB9IH0pOyB9IH0sCiAgICBzZWcsIGZpZWxkKHQoJ25hbWUnKSwgbmFtZSksIGZpZWxkKHQoJ2VtYWlsX29wdCcpLCBlbWFpbCksIGZpZWxkKHQoJ3Bob25lX29wdCcpLCBwaG9uZSksIGZpZWxkKHQoJ3Bhc3N3b3JkJyksIHB3LCB0KCdwd19oaW50JykpLAogICAgaCgnZGl2JywgeyBjbGFzczogJ3JvdycgfSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGZpZWxkKHQoJ3dpbGF5YScpLCB3aWwpKSwgaCgnZGl2JywgeyBjbGFzczogJ2dyb3cnIH0sIGZpZWxkKHQoJ2NvbW11bmUnKSwgY29tKSkpLCBwcm92Qm94LCBlcnIsIGJ0bik7CiAgd3JhcC5hcHBlbmQoZm9ybSk7CiAgcmV0dXJuIGF1dGhTaGVsbCh0KCdyZWdpc3RlcicpLCB3cmFwLCBoKCdwJywgeyBjbGFzczogJ2NlbnRlciBtdCcgfSwgdCgnaGF2ZV9hY2NvdW50JyksICcgJywgaCgnYScsIHsgaHJlZjogJyMvbG9naW4nLCBjbGFzczogJ2InLCBzdHlsZTogeyBjb2xvcjogJ3ZhcigtLWdyZWVuKScgfSB9LCB0KCdsb2dpbicpKSkpOwp9CgpleHBvcnQgY29uc3QgcHVibGljUm91dGVzID0gWwogIFsnL3NwbGFzaCcsICgpID0+IHsgc2V0VGltZW91dCgoKSA9PiBnbyhzZWVuKCkgPyAnL2xvZ2luJyA6ICcvb25ib2FyZGluZycpLCAxNDAwKTsgcmV0dXJuIHNwbGFzaCgpOyB9LCB7IGF1dGg6IGZhbHNlLCBndWVzdE9ubHk6IHRydWUgfV0sCiAgWycvb25ib2FyZGluZycsICgpID0+IG9uYm9hcmRpbmcoKSwgeyBhdXRoOiBmYWxzZSwgZ3Vlc3RPbmx5OiB0cnVlIH1dLAogIFsnL2xvZ2luJywgKCkgPT4gKHNlZW4oKSA/IGxvZ2luUGFnZSgpIDogKGdvKCcvc3BsYXNoJyksIHNwbGFzaCgpKSksIHsgYXV0aDogZmFsc2UsIGd1ZXN0T25seTogdHJ1ZSB9XSwKICBbJy9yZWdpc3RlcicsICgpID0+IHJlZ2lzdGVyUGFnZSgpLCB7IGF1dGg6IGZhbHNlLCBndWVzdE9ubHk6IHRydWUgfV0sCl07Cg==", "base64") },
  "js/pages/admin.js": { path: "js/pages/admin.js", buf: Buffer.from("aW1wb3J0IHsgR0VULCBQT1NULCBQQVRDSCB9IGZyb20gJy4uL2FwaS5qcyc7CmltcG9ydCB7IGgsIHQsIG5mLCBtb25leSwgbmFtZU9mLCB0b2FzdCwgZ3VhcmRlZCwgZmllbGQsIHNlbGVjdCwgZW1wdHlTdGF0ZSwgc3RhdHVzUGlsbCwgbG9nb1N2ZyB9IGZyb20gJy4uL3VpLmpzJzsKaW1wb3J0IHsgYWdvIH0gZnJvbSAnLi4vaTE4bi5qcyc7CmltcG9ydCB7IHN0YXRlLCBnbywgbG9nb3V0IH0gZnJvbSAnLi4vY29yZS5qcyc7Cgpjb25zdCBPUFRTID0geyByb2xlczogWydhZG1pbiddIH07CmNvbnN0IFRBQlMgPSBbWydvdmVydmlldycsICdhX292ZXJ2aWV3J10sIFsncHJvdmlkZXJzJywgJ2FfcHJvdmlkZXJzJ10sIFsnZmFpbGVkJywgJ2FfZmFpbGVkJ10sIFsncmVxdWVzdHMnLCAnYV9yZXF1ZXN0cyddLCBbJ3VzZXJzJywgJ2FfdXNlcnMnXSwgWydvZmZlcnMnLCAnYV9vZmZlcnMnXSwgWydjYXRlZ29yaWVzJywgJ2FfY2F0ZWdvcmllcyddLCBbJ2ZlZXMnLCAnYV9mZWVzJ10sIFsnY29tcGxhaW50cycsICdhX2NvbXBsYWludHMnXSwgWydyZXZpZXdzJywgJ2FfcmV2aWV3cyddLCBbJ2xvZ3MnLCAnYV9sb2dzJ11dOwoKY29uc3QgdGFibGUgPSAoY29scywgcm93cykgPT4gaCgnZGl2JywgeyBjbGFzczogJ3RibHdyYXAnIH0sIGgoJ3RhYmxlJywgeyBjbGFzczogJ3RibCcgfSwgaCgndGhlYWQnLCBudWxsLCBoKCd0cicsIG51bGwsIGNvbHMubWFwKChjKSA9PiBoKCd0aCcsIG51bGwsIGMpKSkpLCBoKCd0Ym9keScsIG51bGwsIHJvd3MubWFwKChyKSA9PiBoKCd0cicsIG51bGwsIHIubWFwKChjKSA9PiBoKCd0ZCcsIG51bGwsIGMpKSkpKSkpOwpjb25zdCBhY3QgPSAobGFiZWwsIGZuLCBjbHMgPSAnJykgPT4gaCgnYnV0dG9uJywgeyBjbGFzczogYGJ0biBzbSAke2Nsc31gLCBvbkNsaWNrOiAoZSkgPT4gZ3VhcmRlZChlLmN1cnJlbnRUYXJnZXQsIGFzeW5jICgpID0+IHsgYXdhaXQgZm4oKTsgdG9hc3QoJ+KckycsICdvaycpOyByZWxvYWQoKTsgfSkgfSwgbGFiZWwpOwoKbGV0IHJlbG9hZCA9ICgpID0+IHt9Owphc3luYyBmdW5jdGlvbiBwYW5lbCh0YWIpIHsKICBjb25zdCBEID0gewogICAgYXN5bmMgb3ZlcnZpZXcoKSB7CiAgICAgIGNvbnN0IHMgPSBhd2FpdCBHRVQoJy9hcGkvYWRtaW4vc3RhdHMnKTsKICAgICAgY29uc3Qgc3QgPSAobiwgbCwgaGwpID0+IGgoJ2RpdicsIHsgY2xhc3M6IGBzdGF0JHtobCA/ICcgaGwnIDogJyd9YCB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnbicgfSwgbiksIGgoJ2RpdicsIHsgY2xhc3M6ICdzbWFsbCBtdXRlZCcgfSwgbCkpOwogICAgICByZXR1cm4gaCgnZGl2JywgeyBjbGFzczogJ3N0YWNrJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnc3RhdC1ncmlkJyB9LCBzdChzLnVzZXJzLCB0KCdzX3VzZXJzJykpLCBzdChzLnByb3ZpZGVycywgdCgnc19wcm92aWRlcnMnKSksIHN0KHMucHJvdmlkZXJzX3BlbmRpbmcsIHQoJ3NfcGVuZGluZycpLCBzLnByb3ZpZGVyc19wZW5kaW5nID4gMCksIHN0KHMucmVxdWVzdHMsIHQoJ3NfcmVxdWVzdHMnKSksCiAgICAgICAgc3Qocy5yZXF1ZXN0c19mYWlsZWQsIHQoJ3NfZmFpbGVkJyksIHMucmVxdWVzdHNfZmFpbGVkID4gMCksIHN0KHMucmVxdWVzdHNfc3VzcGljaW91cywgdCgnc19zdXNwaWNpb3VzJykpLCBzdChzLm9mZmVycywgdCgnc19vZmZlcnMnKSksIHN0KHMub3JkZXJzX2NvbXBsZXRlZCwgdCgnc19jb21wbGV0ZWQnKSksIHN0KG1vbmV5KHMuZ212KSwgdCgnc19nbXYnKSksIHN0KG1vbmV5KHMucGxhdGZvcm1fZmVlcyksIHQoJ3NfZmVlcycpLCB0cnVlKSwgc3Qocy5jb21wbGFpbnRzX29wZW4sIHQoJ3NfY29tcGxhaW50cycpKSksCiAgICAgICAgaCgnZGl2JywgeyBjbGFzczogJ2NhcmQnIH0sIHMuYnlfc3RhdHVzLm1hcCgoeCkgPT4gaCgnZGl2JywgeyBjbGFzczogJ3JvdyBzcCcgfSwgc3RhdHVzUGlsbCh4LnN0YXR1cyksIGgoJ2InLCBudWxsLCB4Lm4pKSkpKTsKICAgIH0sCiAgICBhc3luYyBwcm92aWRlcnMoKSB7CiAgICAgIGNvbnN0IHsgcHJvdmlkZXJzIH0gPSBhd2FpdCBHRVQoJy9hcGkvYWRtaW4vcHJvdmlkZXJzJyk7CiAgICAgIHJldHVybiB0YWJsZShbJycsIHQoJ3Byb3ZpZGVyJyksIHQoJ2FjdGl2aXR5JyksIHQoJ2xvY2F0aW9uJyksIHQoJ3JhdGluZycpLCAnJ10sIHByb3ZpZGVycy5tYXAoKHApID0+IFsKICAgICAgICBoKCdzcGFuJywgeyBjbGFzczogYGJhZGdlICR7cC5hcHByb3ZhbF9zdGF0dXMgPT09ICdhcHByb3ZlZCcgPyAnZ3JlZW4nIDogcC5hcHByb3ZhbF9zdGF0dXMgPT09ICdwZW5kaW5nJyA/ICdnb2xkJyA6ICdyZWQnfWAgfSwgdChgJHtwLmFwcHJvdmFsX3N0YXR1c31fbGFiZWxgKSksCiAgICAgICAgaCgnZGl2JywgbnVsbCwgaCgnYicsIG51bGwsIHAuYnVzaW5lc3NfbmFtZSksIGgoJ2RpdicsIHsgY2xhc3M6ICd0aW55IG11dGVkIGx0cicgfSwgYCR7cC5lbWFpbCB8fCAnJ30gJHtwLnBob25lIHx8ICcnfWApKSwgcC5hY3Rpdml0eSB8fCAnJywgcC5sb2NhdGlvbl9sYWJlbCwgYCR7cC5yYXRpbmdfYXZnfSAoJHtwLnJhdGluZ19jb3VudH0pYCwKICAgICAgICBoKCdkaXYnLCB7IGNsYXNzOiAncm93IHdyYXAnIH0sIHAuYXBwcm92YWxfc3RhdHVzICE9PSAnYXBwcm92ZWQnICYmIGFjdCh0KCdhcHByb3ZlJyksICgpID0+IFBPU1QoYC9hcGkvYWRtaW4vcHJvdmlkZXJzLyR7cC5pZH0vYXBwcm92ZWApKSwgcC5hcHByb3ZhbF9zdGF0dXMgIT09ICdyZWplY3RlZCcgJiYgYWN0KHQoJ3JlamVjdCcpLCAoKSA9PiBQT1NUKGAvYXBpL2FkbWluL3Byb3ZpZGVycy8ke3AuaWR9L3JlamVjdGApLCAnZGFuZ2VyJyksCiAgICAgICAgICBwLnZlcmlmaWVkID8gYWN0KHQoJ3VudmVyaWZ5JyksICgpID0+IFBPU1QoYC9hcGkvYWRtaW4vcHJvdmlkZXJzLyR7cC5pZH0vdW52ZXJpZnlgKSwgJ2dob3N0JykgOiBhY3QoYOKckyAke3QoJ3ZlcmlmeScpfWAsICgpID0+IFBPU1QoYC9hcGkvYWRtaW4vcHJvdmlkZXJzLyR7cC5pZH0vdmVyaWZ5YCksICdncmVlbicpKV0pKTsKICAgIH0sCiAgICBhc3luYyBmYWlsZWQoKSB7IHJldHVybiByZXFUYWJsZShhd2FpdCBHRVQoJy9hcGkvYWRtaW4vcmVxdWVzdHM/ZmlsdGVyPWZhaWxlZCcpKTsgfSwKICAgIGFzeW5jIHJlcXVlc3RzKCkgeyByZXR1cm4gcmVxVGFibGUoYXdhaXQgR0VUKCcvYXBpL2FkbWluL3JlcXVlc3RzJykpOyB9LAogICAgYXN5bmMgdXNlcnMoKSB7CiAgICAgIGNvbnN0IHEgPSBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcsIHBsYWNlaG9sZGVyOiB0KCdzZWFyY2hfdXNlcnMnKSB9KTsgY29uc3Qgb3V0ID0gaCgnZGl2Jyk7CiAgICAgIGNvbnN0IGxvYWQgPSBhc3luYyAoKSA9PiB7IGNvbnN0IHsgdXNlcnMgfSA9IGF3YWl0IEdFVChgL2FwaS9hZG1pbi91c2Vycz9xPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHEudmFsdWUpfWApOwogICAgICAgIG91dC5yZXBsYWNlQ2hpbGRyZW4odGFibGUoWycnLCB0KCduYW1lJyksIHQoJ2VtYWlsJyksICdyb2xlJywgJyddLCB1c2Vycy5tYXAoKHUpID0+IFtoKCdzcGFuJywgeyBjbGFzczogYGJhZGdlICR7dS5zdGF0dXMgPT09ICdhY3RpdmUnID8gJ2dyZWVuJyA6ICdyZWQnfWAgfSwgdS5zdGF0dXMpLCBoKCdkaXYnLCBudWxsLCBoKCdiJywgbnVsbCwgdS5uYW1lKSwgaCgnZGl2JywgeyBjbGFzczogJ3RpbnkgbXV0ZWQnIH0sIGFnbyh1LmNyZWF0ZWRfYXQpKSksIGgoJ3NwYW4nLCB7IGNsYXNzOiAnbHRyIHRpbnknIH0sIGAke3UuZW1haWwgfHwgJyd9ICR7dS5waG9uZSB8fCAnJ31gKSwgdS5yb2xlLAogICAgICAgICAgdS5yb2xlICE9PSAnYWRtaW4nICYmICh1LnN0YXR1cyA9PT0gJ2FjdGl2ZScgPyBhY3QodCgnc3VzcGVuZCcpLCAoKSA9PiBQQVRDSChgL2FwaS9hZG1pbi91c2Vycy8ke3UuaWR9YCwgeyBzdGF0dXM6ICdzdXNwZW5kZWQnIH0pLCAnZGFuZ2VyJykgOiBhY3QodCgncmVhY3RpdmF0ZScpLCAoKSA9PiBQQVRDSChgL2FwaS9hZG1pbi91c2Vycy8ke3UuaWR9YCwgeyBzdGF0dXM6ICdhY3RpdmUnIH0pKSldKSkpOyB9OwogICAgICBsZXQgdG07IHEuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoKSA9PiB7IGNsZWFyVGltZW91dCh0bSk7IHRtID0gc2V0VGltZW91dChsb2FkLCAzMDApOyB9KTsgYXdhaXQgbG9hZCgpOwogICAgICByZXR1cm4gaCgnZGl2JywgeyBjbGFzczogJ3N0YWNrJyB9LCBxLCBvdXQpOwogICAgfSwKICAgIGFzeW5jIG9mZmVycygpIHsgY29uc3QgeyBvZmZlcnMgfSA9IGF3YWl0IEdFVCgnL2FwaS9hZG1pbi9vZmZlcnMnKTsgcmV0dXJuIHRhYmxlKFsnIycsIHQoJ29mZmVyX3RpdGxlJyksIHQoJ3Byb3ZpZGVyJyksIHQoJ3ByaWNlJyksICcnLCAnJ10sIG9mZmVycy5tYXAoKG8pID0+IFtvLm51bWJlciwgby50aXRsZSwgby5wcm92aWRlciwgbW9uZXkoby5wcmljZSksIG8uc291cmNlLCBvLnN0YXR1c10pKTsgfSwKICAgIGFzeW5jIGNhdGVnb3JpZXMoKSB7CiAgICAgIGNvbnN0IHsgY2F0ZWdvcmllcyB9ID0gYXdhaXQgR0VUKCcvYXBpL2FkbWluL2NhdGVnb3JpZXMnKTsKICAgICAgY29uc3QgZiA9IHsgc2x1ZzogaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnLCBkaXI6ICdsdHInIH0pLCBhcjogaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnIH0pLCBmcjogaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnIH0pLCBlbjogaCgnaW5wdXQnLCB7IGNsYXNzOiAnaW5wdXQnIH0pLCBpY29uOiBoKCdpbnB1dCcsIHsgY2xhc3M6ICdpbnB1dCcsIHZhbHVlOiAn8J+TpicgfSkgfTsKICAgICAgcmV0dXJuIGgoJ2RpdicsIHsgY2xhc3M6ICdzdGFjaycgfSwgdGFibGUoWycnLCAnc2x1ZycsICdBUicsICdGUicsICdFTicsICcnXSwgY2F0ZWdvcmllcy5tYXAoKGMpID0+IFtjLmljb24sIGgoJ3NwYW4nLCB7IGNsYXNzOiAnbHRyJyB9LCBjLnNsdWcpLCBjLm5hbWVfYXIsIGMubmFtZV9mciwgYy5uYW1lX2VuLCBjLmFjdGl2ZSA/IGFjdCh0KCdoaWRlJyksICgpID0+IFBBVENIKGAvYXBpL2FkbWluL2NhdGVnb3JpZXMvJHtjLnNsdWd9YCwgeyBhY3RpdmU6IGZhbHNlIH0pLCAnZ2hvc3QnKSA6IGFjdCh0KCdzaG93JyksICgpID0+IFBBVENIKGAvYXBpL2FkbWluL2NhdGVnb3JpZXMvJHtjLnNsdWd9YCwgeyBhY3RpdmU6IHRydWUgfSkpXSkpLAogICAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnYiBtYicgfSwgdCgnYWRkX2NhdGVnb3J5JykpLCBmaWVsZCh0KCdzbHVnJyksIGYuc2x1ZyksIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cnIH0sIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBmaWVsZCgnQVInLCBmLmFyKSksIGgoJ2RpdicsIHsgY2xhc3M6ICdncm93JyB9LCBmaWVsZCgnRlInLCBmLmZyKSkpLCBoKCdkaXYnLCB7IGNsYXNzOiAncm93JyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgZmllbGQoJ0VOJywgZi5lbikpLCBoKCdkaXYnLCB7IGNsYXNzOiAnZ3JvdycgfSwgZmllbGQoJ0ljb24nLCBmLmljb24pKSksCiAgICAgICAgICBhY3QodCgnc2F2ZScpLCAoKSA9PiBQT1NUKCcvYXBpL2FkbWluL2NhdGVnb3JpZXMnLCB7IHNsdWc6IGYuc2x1Zy52YWx1ZSwgbmFtZV9hcjogZi5hci52YWx1ZSwgbmFtZV9mcjogZi5mci52YWx1ZSwgbmFtZV9lbjogZi5lbi52YWx1ZSwgaWNvbjogZi5pY29uLnZhbHVlIH0pKSkpOwogICAgfSwKICAgIGFzeW5jIGZlZXMoKSB7CiAgICAgIGNvbnN0IHMgPSBhd2FpdCBHRVQoJy9hcGkvYWRtaW4vc2V0dGluZ3MnKTsgY29uc3QgaW5wID0gKHYpID0+IGgoJ2lucHV0JywgeyBjbGFzczogJ2lucHV0JywgdHlwZTogJ251bWJlcicsIHN0ZXA6ICdhbnknLCB2YWx1ZTogdiB9KTsKICAgICAgY29uc3QgZiA9IHsgZmVlX3BlcmNlbnQ6IGlucChzLmZlZV9wZXJjZW50KSwgZmVlX21pbjogaW5wKHMuZmVlX21pbiksIGZlZV9tYXg6IGlucChzLmZlZV9tYXgpLCBkZWxpdmVyeV9zYW1lX3dpbGF5YTogaW5wKHMuZGVsaXZlcnlfc2FtZV93aWxheWEpLCBkZWxpdmVyeV9vdGhlcl93aWxheWE6IGlucChzLmRlbGl2ZXJ5X290aGVyX3dpbGF5YSkgfTsKICAgICAgY29uc3QgdyA9IE9iamVjdC5mcm9tRW50cmllcyhbJ3ByaWNlJywgJ3JhdGluZycsICd2ZXJpZmllZCcsICdjb25kaXRpb24nLCAnbG9jYXRpb24nLCAnZGVsaXZlcnknXS5tYXAoKGspID0+IFtrLCBpbnAocy5zY29yZV93ZWlnaHRzW2tdID8/IDApXSkpOwogICAgICByZXR1cm4gaCgnZGl2JywgeyBjbGFzczogJ3N0YWNrJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnY2FyZCcgfSwgZmllbGQodCgnZmVlX3BlcmNlbnQnKSwgZi5mZWVfcGVyY2VudCksIGZpZWxkKHQoJ2ZlZV9taW4nKSwgZi5mZWVfbWluKSwgZmllbGQodCgnZmVlX21heCcpLCBmLmZlZV9tYXgpLCBmaWVsZCh0KCdkZWxpdmVyeV9zYW1lJyksIGYuZGVsaXZlcnlfc2FtZV93aWxheWEpLCBmaWVsZCh0KCdkZWxpdmVyeV9vdGhlcicpLCBmLmRlbGl2ZXJ5X290aGVyX3dpbGF5YSkpLAogICAgICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdjYXJkJyB9LCBoKCdkaXYnLCB7IGNsYXNzOiAnYiBtYicgfSwgdCgnc2NvcmVfd2VpZ2h0cycpKSwgT2JqZWN0LmVudHJpZXModykubWFwKChbaywgZWxdKSA9PiBmaWVsZCh0KGB3XyR7a31gKSwgZWwpKSksCiAgICAgICAgYWN0KHQoJ3NhdmUnKSwgKCkgPT4gUEFUQ0goJy9hcGkvYWRtaW4vc2V0dGluZ3MnLCB7IC4uLk9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyhmKS5tYXAoKFtrLCBlbF0pID0+IFtrLCBOdW1iZXIoZWwudmFsdWUpXSkpLCBzY29yZV93ZWlnaHRzOiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModykubWFwKChbaywgZWxdKSA9PiBbaywgTnVtYmVyKGVsLnZhbHVlKV0pKSB9KSwgJ2Jsb2NrJykpOwogICAgfSwKICAgIGFzeW5jIGNvbXBsYWludHMoKSB7CiAgICAgIGNvbnN0IHsgY29tcGxhaW50cyB9ID0gYXdhaXQgR0VUKCcvYXBpL2FkbWluL2NvbXBsYWludHMnKTsKICAgICAgcmV0dXJuIGNvbXBsYWludHMubGVuZ3RoID8gdGFibGUoWycnLCB0KCdjb21wbGFpbnRfc3ViamVjdCcpLCB0KCdjdXN0b21lcicpLCAnJywgJyddLCBjb21wbGFpbnRzLm1hcCgoYykgPT4gW2goJ3NwYW4nLCB7IGNsYXNzOiBgYmFkZ2UgJHtjLnN0YXR1cyA9PT0gJ29wZW4nID8gJ3JlZCcgOiAnZ3JlZW4nfWAgfSwgYy5zdGF0dXMpLCBoKCdkaXYnLCBudWxsLCBoKCdiJywgbnVsbCwgYy5zdWJqZWN0KSwgaCgnZGl2JywgeyBjbGFzczogJ3NtYWxsJyB9LCBjLmJvZHkpKSwgYy51c2VyX25hbWUsIGFnbyhjLmNyZWF0ZWRfYXQpLAogICAgICAgIGMuc3RhdHVzID09PSAnb3BlbicgJiYgaCgnZGl2JywgeyBjbGFzczogJ3JvdycgfSwgYWN0KHQoJ3Jlc29sdmUnKSwgKCkgPT4gUEFUQ0goYC9hcGkvYWRtaW4vY29tcGxhaW50cy8ke2MuaWR9YCwgeyBzdGF0dXM6ICdyZXNvbHZlZCcgfSksICdncmVlbicpLCBhY3QodCgnZGlzbWlzcycpLCAoKSA9PiBQQVRDSChgL2FwaS9hZG1pbi9jb21wbGFpbnRzLyR7Yy5pZH1gLCB7IHN0YXR1czogJ2Rpc21pc3NlZCcgfSksICdnaG9zdCcpKV0pKSA6IGVtcHR5U3RhdGUoJ/CfjoknLCAn4oCUJyk7CiAgICB9LAogICAgYXN5bmMgcmV2aWV3cygpIHsKICAgICAgY29uc3QgeyByZXZpZXdzIH0gPSBhd2FpdCBHRVQoJy9hcGkvYWRtaW4vcmV2aWV3cycpOwogICAgICByZXR1cm4gdGFibGUoWyfimIUnLCB0KCdyZXZpZXdzJyksICcnLCAnJ10sIHJldmlld3MubWFwKChyKSA9PiBbci5yYXRpbmcsIGgoJ2RpdicsIG51bGwsIHIuY29tbWVudCB8fCAn4oCUJywgaCgnZGl2JywgeyBjbGFzczogJ3RpbnkgbXV0ZWQnIH0sIGAke3IuYXV0aG9yfSDihpIgJHtyLnRhcmdldH1gKSksIHIuaGlkZGVuID8gJ2hpZGRlbicgOiAnJywgci5oaWRkZW4gPyBhY3QodCgnc2hvdycpLCAoKSA9PiBQQVRDSChgL2FwaS9hZG1pbi9yZXZpZXdzLyR7ci5pZH1gLCB7IGhpZGRlbjogZmFsc2UgfSkpIDogYWN0KHQoJ2hpZGUnKSwgKCkgPT4gUEFUQ0goYC9hcGkvYWRtaW4vcmV2aWV3cy8ke3IuaWR9YCwgeyBoaWRkZW46IHRydWUgfSksICdkYW5nZXInKV0pKTsKICAgIH0sCiAgICBhc3luYyBsb2dzKCkgeyBjb25zdCB7IGxvZ3MgfSA9IGF3YWl0IEdFVCgnL2FwaS9hZG1pbi9sb2dzJyk7IHJldHVybiB0YWJsZShbJ3RpbWUnLCAnbGV2ZWwnLCAnZXZlbnQnLCAnbWV0YSddLCBsb2dzLm1hcCgobCkgPT4gW2FnbyhsLmNyZWF0ZWRfYXQpLCBsLmxldmVsLCBsLmV2ZW50LCBoKCdzcGFuJywgeyBjbGFzczogJ3RpbnkgbHRyJyB9LCAobC5tZXRhIHx8ICcnKS5zbGljZSgwLCAxMjApKV0pKTsgfSwKICB9OwogIHJldHVybiBEW3RhYl0oKTsKfQpmdW5jdGlvbiByZXFUYWJsZSh7IHJlcXVlc3RzIH0pIHsKICByZXR1cm4gcmVxdWVzdHMubGVuZ3RoID8gdGFibGUoWycjJywgdCgnY3VzdG9tZXJfcmVxdWVzdCcpLCB0KCdsb2NhdGlvbicpLCAnJywgJyddLCByZXF1ZXN0cy5tYXAoKHIpID0+IFtyLm51bWJlciwgaCgnZGl2JywgbnVsbCwgci5yYXdfdGV4dCwgaCgnZGl2JywgeyBjbGFzczogJ3RpbnkgbXV0ZWQnIH0sIGAke3IudXNlcl9uYW1lfSDigKIgJHthZ28oci5jcmVhdGVkX2F0KX1gKSwgci5zdXNwaWNpb3VzX3JlYXNvbiAmJiBoKCdzcGFuJywgeyBjbGFzczogJ2JhZGdlIHJlZCcgfSwgci5zdXNwaWNpb3VzX3JlYXNvbikpLCByLmxvY2F0aW9uX2xhYmVsLCBoKCdkaXYnLCBudWxsLCBzdGF0dXNQaWxsKHIuc3RhdHVzKSwgaCgnZGl2JywgeyBjbGFzczogJ3RpbnknIH0sIHQoJ29mZmVyc19jb3VudCcsIHsgbjogci5vZmZlcnNfY291bnQgfSkpKSwKICAgIGgoJ2RpdicsIHsgY2xhc3M6ICdyb3cgd3JhcCcgfSwgIVsnQ09NUExFVEVEJywgJ0NBTkNFTExFRCddLmluY2x1ZGVzKHIuc3RhdHVzKSAmJiBhY3QodCgncmVydW4nKSwgKCkgPT4gUE9TVChgL2FwaS9hZG1pbi9yZXF1ZXN0cy8ke3IuaWR9L3JlcnVuYCkpLCAhWydDT01QTEVURUQnLCAnQ0FOQ0VMTEVEJ10uaW5jbHVkZXMoci5zdGF0dXMpICYmIGFjdCh0KCdjYW5jZWwnKSwgKCkgPT4gUE9TVChgL2FwaS9hZG1pbi9yZXF1ZXN0cy8ke3IuaWR9L2NhbmNlbGApLCAnZGFuZ2VyJykpXSkpIDogZW1wdHlTdGF0ZSgn8J+OiScsICfigJQnKTsKfQoKYXN5bmMgZnVuY3Rpb24gYWRtaW5QYWdlKHsgcXVlcnkgfSkgewogIGNvbnN0IHRhYiA9IFRBQlMuc29tZSgoeCkgPT4geFswXSA9PT0gcXVlcnkudGFiKSA/IHF1ZXJ5LnRhYiA6ICdvdmVydmlldyc7CiAgY29uc3QgY29udGVudCA9IGgoJ2RpdicpOwogIHJlbG9hZCA9IGFzeW5jICgpID0+IHsgY29udGVudC5yZXBsYWNlQ2hpbGRyZW4oaCgnZGl2JywgeyBjbGFzczogJ2NlbnRlcicgfSwgaCgnc3BhbicsIHsgY2xhc3M6ICdzcGluJyB9KSkpOyB0cnkgeyBjb250ZW50LnJlcGxhY2VDaGlsZHJlbihhd2FpdCBwYW5lbCh0YWIpKTsgfSBjYXRjaCAoZSkgeyBjb250ZW50LnJlcGxhY2VDaGlsZHJlbihoKCdkaXYnLCB7IGNsYXNzOiAnZXJyJyB9LCBlLm1lc3NhZ2UpKTsgfSB9OwogIHJlbG9hZCgpOwogIGNvbnN0IGJvZHkgPSBoKCdkaXYnLCB7IGNsYXNzOiAnc2lkZWJhci1hZG1pbicgfSwgaCgnZGl2JywgeyBjbGFzczogJ3RhYnMnIH0sIFRBQlMubWFwKChbaywgbGJdKSA9PiBoKCdhJywgeyBjbGFzczogYHRhYiR7ayA9PT0gdGFiID8gJyBvbicgOiAnJ31gLCBocmVmOiBgIy9hZG1pbj90YWI9JHtrfWAgfSwgdChsYikpKSksIGNvbnRlbnQpOwogIHJldHVybiB7IHdpZGU6IHRydWUsIHRpdGxlOiBg8J+boe+4jyAke3QoJ2FkbWluJyl9YCwgYWN0aW9uczogaCgnYnV0dG9uJywgeyBjbGFzczogJ2J0biBnaG9zdCBzbScsIG9uQ2xpY2s6IGxvZ291dCB9LCB0KCdsb2dvdXQnKSksIGJvZHkgfTsKfQpleHBvcnQgY29uc3QgYWRtaW5Sb3V0ZXMgPSBbWycvYWRtaW4nLCBhZG1pblBhZ2UsIE9QVFNdXTsK", "base64") },
  "js/i18n/en.js": { path: "js/i18n/en.js", buf: Buffer.from("ZXhwb3J0IGRlZmF1bHQgewogImFwcF9uYW1lIjogIkJsYSBTaGFxYSIsCiAidGFnbGluZSI6ICJUZWxsIHVzIHdoYXQgeW91IG5lZWQg4oCUIHdlJ2xsIGhhbmRsZSB0aGUgcmVzdC4iLAogImN1cnJlbmN5IjogIkRaRCIsCiAianVzdF9ub3ciOiAianVzdCBub3ciLAogImNhbmNlbCI6ICJDYW5jZWwiLAogImNvbmZpcm0iOiAiQ29uZmlybSIsCiAic2F2ZSI6ICJTYXZlIiwKICJiYWNrIjogIkJhY2siLAogIm5leHQiOiAiTmV4dCIsCiAic2tpcCI6ICJTa2lwIiwKICJzdGFydCI6ICJHZXQgc3RhcnRlZCIsCiAiY2xvc2UiOiAiQ2xvc2UiLAogInNlbmQiOiAiU2VuZCIsCiAiZWRpdCI6ICJFZGl0IiwKICJkZWxldGUiOiAiRGVsZXRlIiwKICJsb2FkaW5nIjogIkxvYWRpbmfigKYiLAogIm1vcmUiOiAiTW9yZSIsCiAiZXJyX2dlbmVyaWMiOiAiU29tZXRoaW5nIHdlbnQgd3JvbmcsIHBsZWFzZSB0cnkgYWdhaW4uIiwKICJlcnJfbmV0d29yayI6ICJObyBpbnRlcm5ldCBjb25uZWN0aW9uLiIsCiAibG9nb3V0IjogIkxvZyBvdXQiLAogInllcyI6ICJZZXMiLAogIm5vIjogIk5vIiwKICJvbmIxX3QiOiAiSnVzdCBzYXkgd2hhdCB5b3UgbmVlZCIsCiAib25iMV9wIjogIk5vIG1vcmUgZGlnZ2luZyB0aHJvdWdoIGxpc3RpbmdzLiBEZXNjcmliZSB5b3VyIHJlcXVlc3QgaW4geW91ciBvd24gd29yZHMuIiwKICJvbmIyX3QiOiAiQUkgc2VhcmNoZXMgZm9yIHlvdSIsCiAib25iMl9wIjogIkl0IHVuZGVyc3RhbmRzIHlvdXIgcmVxdWVzdCwgZmluZHMgb2ZmZXJzIGFuZCBjb21wYXJlcyBwcmljZXMgYW5kIHJhdGluZ3MuIiwKICJvbmIzX3QiOiAiUGljayB0aGUgYmVzdCBvZmZlciIsCiAib25iM19wIjogIkNsZWFyIHByaWNlLCBubyBzdXJwcmlzZXMsIGFuZCBkaXJlY3QgY2hhdCB3aXRoIHRoZSBzZWxsZXIgaW5zaWRlIHRoZSBhcHAuIiwKICJsb2dpbiI6ICJMb2cgaW4iLAogInJlZ2lzdGVyIjogIlNpZ24gdXAiLAogImVtYWlsX29yX3Bob25lIjogIkVtYWlsIG9yIHBob25lIiwKICJwYXNzd29yZCI6ICJQYXNzd29yZCIsCiAibmFtZSI6ICJOYW1lIiwKICJlbWFpbCI6ICJFbWFpbCIsCiAicGhvbmUiOiAiUGhvbmUgKDA1LzA2LzA34oCmKSIsCiAiZW1haWxfb3B0IjogIkVtYWlsIChvcHRpb25hbCBpZiBwaG9uZSBnaXZlbikiLAogInBob25lX29wdCI6ICJQaG9uZSAob3B0aW9uYWwgaWYgZW1haWwgZ2l2ZW4pIiwKICJub19hY2NvdW50IjogIk5vIGFjY291bnQgeWV0PyIsCiAiaGF2ZV9hY2NvdW50IjogIkFscmVhZHkgaGF2ZSBhbiBhY2NvdW50PyIsCiAiaV9hbV91c2VyIjogIkknbSBhIGN1c3RvbWVyIiwKICJpX2FtX3Byb3ZpZGVyIjogIkknbSBhIHNlbGxlciAvIHNlcnZpY2UgcHJvdmlkZXIiLAogIndpbGF5YSI6ICJXaWxheWEiLAogImNvbW11bmUiOiAiQ29tbXVuZSIsCiAiY2hvb3NlIjogIkNob29zZeKApiIsCiAiYWxsX3dpbGF5YXMiOiAiQWxsIHdpbGF5YXMiLAogInB3X2hpbnQiOiAiQXQgbGVhc3QgOCBjaGFyYWN0ZXJzIiwKICJidXNpbmVzc19uYW1lIjogIkJ1c2luZXNzIG5hbWUiLAogImFjdGl2aXR5IjogIlR5cGUgb2YgYWN0aXZpdHkiLAogImRlc2NyaXB0aW9uIjogIkRlc2NyaXB0aW9uIiwKICJ3b3JraW5nX2hvdXJzIjogIldvcmtpbmcgaG91cnMiLAogImNhdGVnb3JpZXNfc2VydmVkIjogIkNhdGVnb3JpZXMgeW91IHNlcnZlIiwKICJwcm92aWRlcl9wZW5kaW5nX25vdGUiOiAiWW91ciBhY2NvdW50IG11c3QgYmUgYXBwcm92ZWQgYnkgdGhlIHRlYW0gYmVmb3JlIHlvdSBjYW4gcmVjZWl2ZSByZXF1ZXN0cy4iLAogImRlbW9fYWNjb3VudHMiOiAiRGVtbyBhY2NvdW50cyAocGFzc3dvcmQ6IERlbW8xMjM0NSkiLAogIm5hdl9ob21lIjogIkhvbWUiLAogIm5hdl9yZXF1ZXN0cyI6ICJSZXF1ZXN0cyIsCiAibmF2X2NoYXQiOiAiQ2hhdCIsCiAibmF2X3Byb2ZpbGUiOiAiUHJvZmlsZSIsCiAibmF2X2Rhc2hib2FyZCI6ICJEYXNoYm9hcmQiLAogIm5hdl9vcmRlcnMiOiAiT3JkZXJzIiwKICJuYXZfaW5jb21pbmciOiAiSW5jb21pbmciLAogIm5hdl9jYXRhbG9nIjogIkNhdGFsb2ciLAogImFza19waCI6ICJXaGF0IGRvIHlvdSBuZWVkPyBXcml0ZSBpdCBoZXJl4oCmIiwKICJzZWFyY2hfbWUiOiAiU2VhcmNoIGZvciBtZSDwn5SNIiwKICJleF9waG9uZSI6ICJJIG5lZWQgYSBwaG9uZeKApiIsCiAiZXhfZWxlY3RyaWNpYW4iOiAiSSBuZWVkIGFuIGVsZWN0cmljaWFu4oCmIiwKICJleF9jYXIiOiAiSSBuZWVkIGEgY2Fy4oCmIiwKICJleF9mdXJuaXR1cmUiOiAiSSBuZWVkIGZ1cm5pdHVyZeKApiIsCiAiZXhfcGhvbmVfZnVsbCI6ICJJIG5lZWQgYSB1c2VkIFNhbXN1bmcgUzI0IGluIE3DqWTDqWEgdW5kZXIgOTAwMDAgRFpEIiwKICJleF9lbGVjdHJpY2lhbl9mdWxsIjogIkkgbmVlZCBhbiBlbGVjdHJpY2lhbiBpbiBLc2FyIEVsIEJvdWtoYXJpIHRvIGZpeCBhIGZhdWx0IGF0IGhvbWUiLAogImV4X2Nhcl9mdWxsIjogIkkgbmVlZCBhIHNwYXJlIHBhcnQgZm9yIGEgQ2xpbyA0IiwKICJleF9mdXJuaXR1cmVfZnVsbCI6ICJJIG5lZWQgYSBzb2ZhIHVuZGVyIDUwMDAwIERaRCIsCiAicXVpY2tfY2F0cyI6ICJRdWljayBjYXRlZ29yaWVzIiwKICJob3dfaXRfd29ya3MiOiAiSG93IGl0IHdvcmtzIiwKICJob3cxIjogIllvdSB3cml0ZSB3aGF0IHlvdSBuZWVkIGluIHlvdXIgb3duIHdvcmRzIiwKICJob3cyIjogIkFJIHVuZGVyc3RhbmRzLCBzZWFyY2hlcyBhbmQgY29tcGFyZXMiLAogImhvdzMiOiAiWW91IHBpY2sgdGhlIGJlc3Qgb2ZmZXIgYW5kIGNoYXQgd2l0aCB0aGUgc2VsbGVyIiwKICJoZWxsbyI6ICJIaSB7bmFtZX0iLAogInVuZGVyc3Rvb2QiOiAiSGVyZSdzIGhvdyBJIHVuZGVyc3Rvb2QgeW91ciByZXF1ZXN0OiIsCiAiZWRpdF9yZXF1ZXN0IjogIkVkaXQgcmVxdWVzdCIsCiAia19wcm9kdWN0IjogIlByb2R1Y3QgLyBzZXJ2aWNlIiwKICJrX2NhdGVnb3J5IjogIkNhdGVnb3J5IiwKICJrX2xvY2F0aW9uIjogIkxvY2F0aW9uIiwKICJrX2J1ZGdldCI6ICJCdWRnZXQiLAogImtfY29uZGl0aW9uIjogIkNvbmRpdGlvbiIsCiAia19yZXF1aXJlbWVudHMiOiAiUmVxdWlyZW1lbnRzIiwKICJrX25vdF9zZXQiOiAiTm90IHNwZWNpZmllZCIsCiAiYnVkZ2V0X3VwX3RvIjogInVwIHRvIHt2fSIsCiAiYnVkZ2V0X2Zyb20iOiAiZnJvbSB7dn0iLAogImJ1ZGdldF9yYW5nZSI6ICJ7YX0gdG8ge2J9IiwKICJhaV9hc2tzIjogIkFJIiwKICJhbnN3ZXJfcGgiOiAiVHlwZSB5b3VyIGFuc3dlcuKApiIsCiAidW5kZXJzdGFuZGluZyI6ICJVbmRlcnN0YW5kaW5nIHlvdXIgcmVxdWVzdOKApiIsCiAiY29uZF9uZXciOiAiTmV3IiwKICJjb25kX3VzZWQiOiAiVXNlZCIsCiAiY29uZF91c2VkX2V4Y2VsbGVudCI6ICJVc2VkIOKAlCBleGNlbGxlbnQiLAogImNvbmRfdXNlZF9nb29kIjogIlVzZWQg4oCUIGdvb2QiLAogImNvbmRfdXNlZF9mYWlyIjogIlVzZWQg4oCUIGZhaXIiLAogImNvbmRfYW55IjogIkFueSIsCiAia2luZF9wcm9kdWN0IjogIlByb2R1Y3QiLAogImtpbmRfc2VydmljZSI6ICJTZXJ2aWNlIiwKICJlZGl0X3RpdGxlIjogIkVkaXQgeW91ciByZXF1ZXN0IiwKICJidWRnZXRfbWluIjogIk1pbiBidWRnZXQiLAogImJ1ZGdldF9tYXgiOiAiTWF4IGJ1ZGdldCIsCiAiYXBwbHkiOiAiQXBwbHkiLAogInN0ZXBfYW5hbHl6aW5nIjogIkFJIGlzIGFuYWx5c2luZyB5b3VyIHJlcXVlc3TigKYiLAogInN0ZXBfc2VhcmNoaW5nIjogIlNlYXJjaGluZyBmb3Igc3VpdGFibGUgb3B0aW9uc+KApiIsCiAic3RlcF9jb21wYXJpbmciOiAiQ29tcGFyaW5nIHByaWNlc+KApiIsCiAic3RlcF92ZXJpZnlpbmciOiAiVmVyaWZ5aW5nIGluZm9ybWF0aW9u4oCmIiwKICJzdGVwX2RvbmUiOiAiV2UgZm91bmQgdGhlIGJlc3Qgb3B0aW9ucyBmb3IgeW91LiIsCiAic3RlcF9pZGxlIjogIlN0YXJ0aW5nIGluIGEgbW9tZW504oCmIiwKICJmb3VuZF9uIjogIntufSBmb3VuZCIsCiAibm9fb2ZmZXJzX3lldCI6ICJObyBvZmZlcnMgeWV0IiwKICJzZWFyY2hfd2lkZXIiOiAiU2VhcmNoIHdpZGVyIiwKICJ3YWl0aW5nX3Byb3ZpZGVycyI6ICJZb3VyIHJlcXVlc3Qgd2FzIHNlbnQgdG8gcmVnaXN0ZXJlZCBwcm92aWRlcnMuIFdlJ2xsIG5vdGlmeSB5b3Ugd2hlbiBuZXcgb2ZmZXJzIGFycml2ZS4iLAogInNlZV9yZXN1bHRzIjogIlNlZSByZXN1bHRzIiwKICJyZXN1bHRzIjogIlJlc3VsdHMiLAogImJlc3Rfb2ZmZXIiOiAiQmVzdCIsCiAiZGV0YWlscyI6ICJWaWV3IGRldGFpbHMiLAogImNob29zZV9vZmZlciI6ICJDaG9vc2UgdGhpcyBvZmZlciIsCiAiY29tcGFyZSI6ICJDb21wYXJlIG9mZmVycyIsCiAic2VsZWN0X3RvX2NvbXBhcmUiOiAiU2VsZWN0IHR3byBvciBtb3JlIG9mZmVycyB0byBjb21wYXJlIiwKICJjb21wYXJlX3NlbGVjdGVkIjogIkNvbXBhcmUgKHtufSkiLAogIm9mZmVyX24iOiAiT2ZmZXIge259IiwKICJwcmljZSI6ICJQcmljZSIsCiAiY29uZGl0aW9uIjogIkNvbmRpdGlvbiIsCiAibG9jYXRpb24iOiAiTG9jYXRpb24iLAogInJhdGluZyI6ICJSYXRpbmciLAogInZlcmlmaWNhdGlvbiI6ICJWZXJpZmllZCIsCiAiZGVsaXZlcnkiOiAiRGVsaXZlcnkiLAogInRvdGFsIjogIlRvdGFsIiwKICJzY29yZSI6ICJTY29yZSIsCiAicHJvdmlkZXIiOiAiUHJvdmlkZXIiLAogImFkZGVkIjogIkFkZGVkIiwKICJ2ZXJpZmllZF9zZWxsZXIiOiAiVmVyaWZpZWQgc2VsbGVyIiwKICJub3RfdmVyaWZpZWQiOiAiTm90IHZlcmlmaWVkIiwKICJub19yZXZpZXdzIjogIk5vIHJldmlld3MiLAogImZyZWUiOiAiRnJlZSIsCiAic2VsbGVyX3ByaWNlIjogIlNlbGxlciBwcmljZSIsCiAic2VydmljZV9mZWUiOiAiQmxhIFNoYXFhIGZlZSIsCiAiZGVsaXZlcnlfZmVlIjogIkRlbGl2ZXJ5IiwKICJmaW5hbF9wcmljZSI6ICJGaW5hbCBwcmljZSIsCiAiYWlfcmVjb21tZW5kYXRpb24iOiAiQUkgcmVjb21tZW5kYXRpb24iLAogImFza19haSI6ICJBc2sgYWJvdXQgeW91ciBvZmZlcnMiLAogImFza19haV9waCI6ICJFLmcuIHdoaWNoIG9mZmVyIGlzIGNoZWFwZXN0PyIsCiAicGlja19iZXN0IjogIlBpY2sgYmVzdCBvZmZlciIsCiAid2FybmluZ3MiOiAiSGVhZHMtdXAiLAogInBheW1lbnRfbWV0aG9kIjogIlBheW1lbnQgbWV0aG9kIiwKICJwYXlfY29kIjogIkNhc2ggb24gZGVsaXZlcnkiLAogInBheV9kaXJlY3QiOiAiUGF5IHRoZSBzZWxsZXIgZGlyZWN0bHkiLAogInBheV9ub3RlIjogIk5vIG9ubGluZSBwYXltZW50IGluIHRoaXMgdmVyc2lvbi4gWW91IHBheSB0aGUgc2VsbGVyIGRpcmVjdGx5LiIsCiAiY29uZmlybV9jaG9pY2UiOiAiQ29uZmlybSBjaG9pY2UiLAogImNob3NlbiI6ICJPZmZlciBjaG9zZW4uIFdhaXRpbmcgZm9yIHRoZSBwcm92aWRlciB0byBjb25maXJtLiIsCiAiZmVlX25vdGUiOiAiVGhlIEJsYSBTaGFxYSBmZWUgY292ZXJzIHNlYXJjaCwgY29tcGFyaXNvbiBhbmQgdmVyaWZpY2F0aW9uLiIsCiAiY29udGFjdF9wcm92aWRlciI6ICJDb250YWN0IHByb3ZpZGVyIiwKICJwcm92aWRlcl9wcm9maWxlIjogIlByb3ZpZGVyIHByb2ZpbGUiLAogInJldmlld3MiOiAiUmV2aWV3cyIsCiAicHJvZHVjdHMiOiAiUHJvZHVjdHMiLAogInNlcnZpY2VzIjogIlNlcnZpY2VzIiwKICJjb21wbGV0ZWRfb3JkZXJzIjogImNvbXBsZXRlZCBvcmRlcnMiLAogIm1lbWJlcl9zaW5jZSI6ICJNZW1iZXIgc2luY2UiLAogImZhdm9yaXRlX2FkZCI6ICJBZGQgdG8gZmF2b3VyaXRlcyIsCiAiZmF2b3JpdGVfcmVtb3ZlIjogIlJlbW92ZSBmcm9tIGZhdm91cml0ZXMiLAogIm15X3JlcXVlc3RzIjogIk15IHJlcXVlc3RzIiwKICJyZXF1ZXN0X24iOiAiUmVxdWVzdCAje259IiwKICJub19yZXF1ZXN0cyI6ICJObyByZXF1ZXN0cyB5ZXQuIiwKICJuZXdfcmVxdWVzdCI6ICJOZXcgcmVxdWVzdCIsCiAiY2FuY2VsX3JlcXVlc3QiOiAiQ2FuY2VsIHJlcXVlc3QiLAogImNvbmZpcm1fY2FuY2VsIjogIkNhbmNlbCB0aGlzIHJlcXVlc3Q/IiwKICJtYXJrX2NvbXBsZXRlIjogIlJlY2VpdmVkIC8gcmVxdWVzdCBjb21wbGV0ZWQiLAogInJhdGVfcHJvdmlkZXIiOiAiUmF0ZSB0aGUgcHJvdmlkZXIiLAogInJhdGVfY3VzdG9tZXIiOiAiUmF0ZSB0aGUgY3VzdG9tZXIiLAogInlvdXJfY29tbWVudCI6ICJZb3VyIGNvbW1lbnQgKG9wdGlvbmFsKSIsCiAic3VibWl0X3JldmlldyI6ICJTdWJtaXQgcmV2aWV3IiwKICJ0aGFua3NfcmV2aWV3IjogIlRoYW5rcyBmb3IgeW91ciByZXZpZXchIiwKICJyZXZpZXdlZCI6ICJSZXZpZXdlZCDinJMiLAogInByb3ZpZGVyX3Bob25lIjogIlByb3ZpZGVyIHBob25lIiwKICJjYWxsIjogIkNhbGwiLAogIm9mZmVyc19jb3VudCI6ICJ7bn0gb2ZmZXJzIiwKICJzdGF0dXNfTkVXIjogIk5ldyIsCiAic3RhdHVzX1NFQVJDSElORyI6ICJTZWFyY2hpbmciLAogInN0YXR1c19PRkZFUlNfRk9VTkQiOiAiT2ZmZXJzIGZvdW5kIiwKICJzdGF0dXNfQ09NUEFSSU5HIjogIkNvbXBhcmluZyIsCiAic3RhdHVzX1VTRVJfU0VMRUNURUQiOiAiT2ZmZXIgY2hvc2VuIiwKICJzdGF0dXNfSU5fUFJPR1JFU1MiOiAiSW4gcHJvZ3Jlc3MiLAogInN0YXR1c19DT01QTEVURUQiOiAiQ29tcGxldGVkIiwKICJzdGF0dXNfQ0FOQ0VMTEVEIjogIkNhbmNlbGxlZCIsCiAic3RhdHVzX1BFTkRJTkciOiAiQXdhaXRpbmcgY29uZmlybWF0aW9uIiwKICJjaGF0IjogIkNoYXQiLAogIm5vX3RocmVhZHMiOiAiTm8gY29udmVyc2F0aW9ucyB5ZXQuIiwKICJ0eXBlX21lc3NhZ2UiOiAiVHlwZSBhIG1lc3NhZ2XigKYiLAogInNoYXJlX29mZmVyIjogIlNoYXJlIG9mZmVyIGluZm8iLAogInNlbmRfcGhvdG8iOiAiUGhvdG8iLAogImNoYXRfbm90ZSI6ICJUbyBwcm90ZWN0IGJvdGggc2lkZXMsIHBob25lIG51bWJlcnMgYXJlIHNob3duIGF1dG9tYXRpY2FsbHkgb25jZSB0aGUgb3JkZXIgaXMgY29uZmlybWVkLiIsCiAib2ZmZXJfaW5mbyI6ICJPZmZlciBpbmZvIiwKICJub3RpZmljYXRpb25zIjogIk5vdGlmaWNhdGlvbnMiLAogIm5vX25vdGlmcyI6ICJObyBub3RpZmljYXRpb25zLiIsCiAibWFya19hbGxfcmVhZCI6ICJNYXJrIGFsbCBhcyByZWFkIiwKICJmYXZvcml0ZXMiOiAiRmF2b3VyaXRlcyIsCiAibm9fZmF2cyI6ICJObyBmYXZvdXJpdGVzIHlldC4iLAogInByb2ZpbGUiOiAiTXkgcHJvZmlsZSIsCiAic2V0dGluZ3MiOiAiU2V0dGluZ3MiLAogImxhbmd1YWdlIjogIkxhbmd1YWdlIiwKICJjaGFuZ2VfcGFzc3dvcmQiOiAiQ2hhbmdlIHBhc3N3b3JkIiwKICJjdXJyZW50X3Bhc3N3b3JkIjogIkN1cnJlbnQgcGFzc3dvcmQiLAogIm5ld19wYXNzd29yZCI6ICJOZXcgcGFzc3dvcmQiLAogInNhdmVkIjogIlNhdmVkIOKckyIsCiAiaGVscCI6ICJIZWxwICYgc3VwcG9ydCIsCiAiaGVscF9pbnRybyI6ICJIb3cgY2FuIHdlIGhlbHA/IiwKICJmYXExX3EiOiAiSG93IGRvZXMgQmxhIFNoYXFhIHdvcms/IiwKICJmYXExX2EiOiAiWW91IHdyaXRlIHdoYXQgeW91IG5lZWQsIEFJIHVuZGVyc3RhbmRzIGl0LCBzZWFyY2hlcyByZWdpc3RlcmVkIHNlbGxlcnMsIGNvbXBhcmVzIG9mZmVycyBhbmQgc3VnZ2VzdHMgdGhlIGJlc3Qgb25lLiBZb3UgZGVjaWRlLiIsCiAiZmFxMl9xIjogIldoYXQgYXJlIHRoZSBmZWVzPyIsCiAiZmFxMl9hIjogIkEgc21hbGwgcGVyY2VudGFnZSBzaG93biBjbGVhcmx5IGJlZm9yZSB5b3UgY29uZmlybTogc2VsbGVyIHByaWNlICsgQmxhIFNoYXFhIGZlZSArIGRlbGl2ZXJ5ID0gZmluYWwgcHJpY2UuIiwKICJmYXEzX3EiOiAiSG93IGRvIEkgcGF5PyIsCiAiZmFxM19hIjogIkluIHRoaXMgdmVyc2lvbjogY2FzaCBvbiBkZWxpdmVyeSBvciBkaXJlY3RseSB0byB0aGUgc2VsbGVyLiBPbmxpbmUgcGF5bWVudCBjb21lcyBsYXRlci4iLAogImZhcTRfcSI6ICJEb2VzIHRoZSBBSSBpbnZlbnQgb2ZmZXJzPyIsCiAiZmFxNF9hIjogIk5vLiBFdmVyeSBvZmZlciBjb21lcyBmcm9tIGEgcmVnaXN0ZXJlZCBzZWxsZXIuIElmIHRoZXJlIGFyZSBub25lLCB3ZSBzYXkgc28gY2xlYXJseS4iLAogImNvbXBsYWludCI6ICJTZW5kIGEgY29tcGxhaW50IiwKICJjb21wbGFpbnRfc3ViamVjdCI6ICJTdWJqZWN0IiwKICJjb21wbGFpbnRfYm9keSI6ICJEZXRhaWxzIiwKICJjb21wbGFpbnRfc2VudCI6ICJDb21wbGFpbnQgc2VudC4gV2UnbGwgZ2V0IGJhY2sgdG8geW91LiIsCiAicHJvdl9kYXNoYm9hcmQiOiAiUHJvdmlkZXIgZGFzaGJvYXJkIiwKICJlYXJuaW5ncyI6ICJFYXJuaW5ncyIsCiAiZWFybmluZ3NfMzAiOiAiTGFzdCAzMCBkYXlzIiwKICJwZW5kaW5nX2Ftb3VudCI6ICJQZW5kaW5nIiwKICJvZmZlcnNfc2VudCI6ICJPZmZlcnMgc2VudCIsCiAib2ZmZXJzX3dvbiI6ICJPZmZlcnMgd29uIiwKICJpbmNvbWluZ19yZXF1ZXN0cyI6ICJJbmNvbWluZyByZXF1ZXN0cyIsCiAibm9faW5jb21pbmciOiAiTm8gbWF0Y2hpbmcgcmVxdWVzdHMgcmlnaHQgbm93LiIsCiAic2VuZF9vZmZlciI6ICJTZW5kIGFuIG9mZmVyIiwKICJvZmZlcl90aXRsZSI6ICJPZmZlciB0aXRsZSIsCiAib2ZmZXJfcHJpY2UiOiAiUHJpY2UgKERaRCkiLAogIm9mZmVyX2RlbGl2ZXJ5IjogIkRlbGl2ZXJ5IChEWkQpIiwKICJvZmZlcl90aW1lIjogIkxlYWQgdGltZSIsCiAib2ZmZXJfZGVzYyI6ICJEZXRhaWxzIiwKICJvZmZlcl9zZW50IjogIk9mZmVyIHNlbnQg4pyTIiwKICJteV9vZmZlciI6ICJZb3VyIG9mZmVyIiwKICJ3aXRoZHJhdyI6ICJXaXRoZHJhdyBvZmZlciIsCiAiY3VzdG9tZXJfcmVxdWVzdCI6ICJDdXN0b21lciByZXF1ZXN0IiwKICJvcmRlcnMiOiAiT3JkZXJzIiwKICJhY2NlcHRfb3JkZXIiOiAiQWNjZXB0IiwKICJkZWNsaW5lX29yZGVyIjogIkRlY2xpbmUiLAogInlvdXJfbmV0IjogIllvdXIgbmV0IiwKICJjdXN0b21lciI6ICJDdXN0b21lciIsCiAibm9fb3JkZXJzIjogIk5vIG9yZGVycy4iLAogImNhdGFsb2ciOiAiTXkgY2F0YWxvZyIsCiAiYWRkX3Byb2R1Y3QiOiAiQWRkIHByb2R1Y3QiLAogImFkZF9zZXJ2aWNlIjogIkFkZCBzZXJ2aWNlIiwKICJ0aXRsZSI6ICJUaXRsZSIsCiAiY2F0ZWdvcnkiOiAiQ2F0ZWdvcnkiLAogImJyYW5kIjogIkJyYW5kIiwKICJwcmljZV9mcm9tIjogIlByaWNlIGZyb20iLAogInByaWNlX3RvIjogIlByaWNlIHRvIiwKICJwaG90b3MiOiAiUGhvdG9zIiwKICJoaWRkZW4iOiAiSGlkZGVuIiwKICJhd2FpdGluZ19hcHByb3ZhbCI6ICJZb3VyIGFjY291bnQgaXMgdW5kZXIgcmV2aWV3LiBXZSdsbCBub3RpZnkgeW91IG9uY2UgYXBwcm92ZWQuIiwKICJyZWplY3RlZF9hY2NvdW50IjogIllvdXIgYWNjb3VudCB3YXMgcmVqZWN0ZWQuIENvbnRhY3Qgc3VwcG9ydC4iLAogInBlbmRpbmdfbGFiZWwiOiAiUGVuZGluZyIsCiAiYXBwcm92ZWRfbGFiZWwiOiAiQXBwcm92ZWQiLAogInJlamVjdGVkX2xhYmVsIjogIlJlamVjdGVkIiwKICJhZG1pbiI6ICJBZG1pbiBkYXNoYm9hcmQiLAogImFfb3ZlcnZpZXciOiAiT3ZlcnZpZXciLAogImFfdXNlcnMiOiAiVXNlcnMiLAogImFfcHJvdmlkZXJzIjogIlByb3ZpZGVycyIsCiAiYV9yZXF1ZXN0cyI6ICJSZXF1ZXN0cyIsCiAiYV9mYWlsZWQiOiAiUmVxdWVzdHMgQUkgY291bGRuJ3QgcmVzb2x2ZSIsCiAiYV9vZmZlcnMiOiAiT2ZmZXJzIiwKICJhX2NhdGVnb3JpZXMiOiAiQ2F0ZWdvcmllcyIsCiAiYV9mZWVzIjogIkZlZXMiLAogImFfY29tcGxhaW50cyI6ICJDb21wbGFpbnRzIiwKICJhX3Jldmlld3MiOiAiUmV2aWV3cyIsCiAiYV9sb2dzIjogIkxvZ3MiLAogImFwcHJvdmUiOiAiQXBwcm92ZSIsCiAicmVqZWN0IjogIlJlamVjdCIsCiAidmVyaWZ5IjogIlZlcmlmeSIsCiAidW52ZXJpZnkiOiAiVW52ZXJpZnkiLAogInN1c3BlbmQiOiAiU3VzcGVuZCIsCiAicmVhY3RpdmF0ZSI6ICJSZWFjdGl2YXRlIiwKICJyZXJ1biI6ICJSZS1ydW4iLAogImhpZGUiOiAiSGlkZSIsCiAic2hvdyI6ICJTaG93IiwKICJyZXNvbHZlIjogIlJlc29sdmVkIiwKICJkaXNtaXNzIjogIkRpc21pc3MiLAogImZlZV9wZXJjZW50IjogIkZlZSAlIiwKICJmZWVfbWluIjogIk1pbiBmZWUgKERaRCkiLAogImZlZV9tYXgiOiAiTWF4IGZlZSAoRFpEKSIsCiAiZGVsaXZlcnlfc2FtZSI6ICJEZWxpdmVyeSBzYW1lIHdpbGF5YSAoRFpEKSIsCiAiZGVsaXZlcnlfb3RoZXIiOiAiRGVsaXZlcnkgb3RoZXIgd2lsYXlhIChEWkQpIiwKICJzY29yZV93ZWlnaHRzIjogIlJhbmtpbmcgd2VpZ2h0cyIsCiAid19wcmljZSI6ICJQcmljZSIsCiAid19yYXRpbmciOiAiUmF0aW5nIiwKICJ3X3ZlcmlmaWVkIjogIlZlcmlmaWNhdGlvbiIsCiAid19jb25kaXRpb24iOiAiQ29uZGl0aW9uIiwKICJ3X2xvY2F0aW9uIjogIlByb3hpbWl0eSIsCiAid19kZWxpdmVyeSI6ICJEZWxpdmVyeSIsCiAic191c2VycyI6ICJDdXN0b21lcnMiLAogInNfcHJvdmlkZXJzIjogIlByb3ZpZGVycyIsCiAic19wZW5kaW5nIjogIlBlbmRpbmcgYXBwcm92YWwiLAogInNfcmVxdWVzdHMiOiAiUmVxdWVzdHMiLAogInNfZmFpbGVkIjogIkFJIGZhaWx1cmVzIiwKICJzX3N1c3BpY2lvdXMiOiAiU3VzcGljaW91cyIsCiAic19vZmZlcnMiOiAiT2ZmZXJzIiwKICJzX2NvbXBsZXRlZCI6ICJDb21wbGV0ZWQiLAogInNfZ212IjogIlZvbHVtZSIsCiAic19mZWVzIjogIlBsYXRmb3JtIHJldmVudWUiLAogInNfY29tcGxhaW50cyI6ICJPcGVuIGNvbXBsYWludHMiLAogInN1c3BpY2lvdXMiOiAiU3VzcGljaW91cyIsCiAic2VhcmNoX3VzZXJzIjogIlNlYXJjaCBuYW1lLCBlbWFpbCwgcGhvbmUiLAogImFkZF9jYXRlZ29yeSI6ICJBZGQgLyBlZGl0IGNhdGVnb3J5IiwKICJzbHVnIjogIklkZW50aWZpZXIgKHNsdWcpIgp9Owo=", "base64") },
  "js/i18n/ar.js": { path: "js/i18n/ar.js", buf: Buffer.from("ZXhwb3J0IGRlZmF1bHQgewogIGFwcF9uYW1lOiAn2KjZhNinINi02YLZiScsIHRhZ2xpbmU6ICfZgtmI2YQg2YjYp9i0INiq2K3Yqtin2KzYjCDZiNiu2YTZitmH2Kcg2LnZhNmK2YbYpy4nLCBjdXJyZW5jeTogJ9iv2KwnLCBqdXN0X25vdzogJ9in2YTYotmGJywKICBjYW5jZWw6ICfYpdmE2LrYp9ihJywgY29uZmlybTogJ9iq2KPZg9mK2K8nLCBzYXZlOiAn2K3Zgdi4JywgYmFjazogJ9ix2KzZiNi5JywgbmV4dDogJ9in2YTYqtin2YTZiicsIHNraXA6ICfYqtiu2LfZiicsIHN0YXJ0OiAn2KfYqNiv2KMnLCBjbG9zZTogJ9il2LrZhNin2YInLCBzZW5kOiAn2KXYsdiz2KfZhCcsIGVkaXQ6ICfYqti52K/ZitmEJywgZGVsZXRlOiAn2K3YsNmBJywgbG9hZGluZzogJ9is2KfYsdmKINin2YTYqtit2YXZitmE4oCmJywgbW9yZTogJ9in2YTZhdiy2YrYrycsCiAgZXJyX2dlbmVyaWM6ICfYtdix2KfYqiDZhdi02YPZhNip2Iwg2K3Yp9mI2YQg2YXYsdipINij2K7YsdmJLicsIGVycl9uZXR3b3JrOiAn2YXYpyDZg9in2YrZhti0INin2KrYtdin2YQg2KjYp9mE2KPZhtiq2LHZhtiqLicsIGxvZ291dDogJ9iq2LPYrNmK2YQg2KfZhNiu2LHZiNisJywgeWVzOiAn2YbYudmFJywgbm86ICfZhNinJywKICAvLyBvbmJvYXJkaW5nCiAgb25iMV90OiAn2KfZg9iq2Kgg2YjYp9i0INiq2K3Yqtin2KwnLCBvbmIxX3A6ICfYqNmE2Kcg2YXYpyDYqtmC2YTYqCDYqNmK2YYg2KfZhNil2LnZhNin2YbYp9iqLiDZg9iq2Kgg2LfZhNio2YMg2KjYp9mE2K/Yp9ix2KzYqSDZiNiu2YTYp9i1LicsCiAgb25iMl90OiAn2KfZhNiw2YPYp9ihINin2YTYp9i12LfZhtin2LnZiiDZitio2K3YqyDYudmG2YMnLCBvbmIyX3A6ICfZitmB2YfZhSDYt9mE2KjZg9iMINmK2YTZgtmJINin2YTYudix2YjYtiDZiNmK2YLYp9ix2YYg2KfZhNij2LPYudin2LEg2YjYp9mE2KrZgtmK2YrZhdin2KouJywKICBvbmIzX3Q6ICfYp9iu2KrYp9ixINij2K3Ys9mGINi52LHYticsIG9uYjNfcDogJ9iz2LnYsSDZiNin2LbYrSDYqNmE2Kcg2YXZgdin2KzYotiq2Iwg2YjYqtmI2KfYtdmEINmF2KjYp9i02LEg2YXYuSDYp9mE2KjYp9im2Lkg2K/Yp9iu2YQg2KfZhNiq2LfYqNmK2YIuJywKICAvLyBhdXRoCiAgbG9naW46ICfYr9iu2YjZhCcsIHJlZ2lzdGVyOiAn2KXZhti02KfYoSDYrdiz2KfYqCcsIGVtYWlsX29yX3Bob25lOiAn2KfZhNio2LHZitivINin2YTYpdmE2YPYqtix2YjZhtmKINij2Ygg2LHZgtmFINin2YTZh9in2KrZgScsIHBhc3N3b3JkOiAn2YPZhNmF2Kkg2KfZhNiz2LEnLCBuYW1lOiAn2KfZhNin2LPZhScsIGVtYWlsOiAn2KfZhNio2LHZitivINin2YTYpdmE2YPYqtix2YjZhtmKJywgcGhvbmU6ICfYsdmC2YUg2KfZhNmH2KfYqtmBICgwNS8wNi8wN+KApiknLAogIGVtYWlsX29wdDogJ9in2YTYqNix2YrYryDYp9mE2KXZhNmD2KrYsdmI2YbZiiAo2KfYrtiq2YrYp9ix2Yog2KXYsNinINij2K/YrtmE2Kog2KfZhNmH2KfYqtmBKScsIHBob25lX29wdDogJ9ix2YLZhSDYp9mE2YfYp9iq2YEgKNin2K7YqtmK2KfYsdmKINil2LDYpyDYo9iv2K7ZhNiqINin2YTYqNix2YrYryknLCBub19hY2NvdW50OiAn2YXYpyDYudmG2K/Zg9i0INit2LPYp9io2J8nLCBoYXZlX2FjY291bnQ6ICfYudmG2K/ZgyDYrdiz2KfYqNifJywKICBpX2FtX3VzZXI6ICfYo9mG2Kcg2LLYqNmI2YYnLCBpX2FtX3Byb3ZpZGVyOiAn2KPZhtinINio2KfYpti5IC8g2YXZgtiv2YUg2K7Yr9mF2KknLCB3aWxheWE6ICfYp9mE2YjZhNin2YrYqScsIGNvbW11bmU6ICfYp9mE2KjZhNiv2YrYqScsIGNob29zZTogJ9in2K7Yqtix4oCmJywgYWxsX3dpbGF5YXM6ICfZg9mEINin2YTZiNmE2KfZitin2KonLCBwd19oaW50OiAnOCDYo9it2LHZgSDYudmE2Ykg2KfZhNij2YLZhCcsCiAgYnVzaW5lc3NfbmFtZTogJ9in2LPZhSDYp9mE2YbYtNin2LcnLCBhY3Rpdml0eTogJ9mG2YjYuSDYp9mE2YbYtNin2LcnLCBkZXNjcmlwdGlvbjogJ9mI2LXZgScsIHdvcmtpbmdfaG91cnM6ICfYo9mI2YLYp9iqINin2YTYudmF2YQnLCBjYXRlZ29yaWVzX3NlcnZlZDogJ9in2YTYo9mC2LPYp9mFINin2YTYqtmKINiq2K7Yr9mF2YfYpycsCiAgcHJvdmlkZXJfcGVuZGluZ19ub3RlOiAn2K3Ys9in2KjZgyDZitmG2KrYuNixINmF2YjYp9mB2YLYqSDYp9mE2KXYr9in2LHYqSDZgtio2YQg2KPZhiDYqtiz2KrZgtio2YQg2KfZhNi32YTYqNin2KouJywgZGVtb19hY2NvdW50czogJ9it2LPYp9io2KfYqiDYqtis2LHZitio2YrYqSAo2YPZhNmF2Kkg2KfZhNiz2LE6IERlbW8xMjM0NSknLAogIC8vIG5hdgogIG5hdl9ob21lOiAn2KfZhNix2KbZitiz2YrYqScsIG5hdl9yZXF1ZXN0czogJ9i32YTYqNin2KrZiicsIG5hdl9jaGF0OiAn2KfZhNiv2LHYr9i02KknLCBuYXZfcHJvZmlsZTogJ9it2LPYp9io2YonLCBuYXZfZGFzaGJvYXJkOiAn2KfZhNmE2YjYrdipJywgbmF2X29yZGVyczogJ9in2YTYt9mE2KjYp9iqJywgbmF2X2luY29taW5nOiAn2YjYp9ix2K/YqScsIG5hdl9jYXRhbG9nOiAn2YXZhtiq2KzYp9iq2YonLAogIC8vIGhvbWUKICBhc2tfcGg6ICfZiNin2LQg2KrYrdiq2KfYrNifINin2YPYqtio2YfYpyDZh9mG2KfigKYnLCBzZWFyY2hfbWU6ICfYp9io2K3YqyDZhNmKIPCflI0nLCBleF9waG9uZTogJ9mG2K3Yqtin2Kwg2YfYp9iq2YHigKYnLCBleF9lbGVjdHJpY2lhbjogJ9mG2K3Yqtin2Kwg2YPZh9ix2KjYp9im2YrigKYnLCBleF9jYXI6ICfZhtit2KrYp9isINiz2YrYp9ix2KnigKYnLCBleF9mdXJuaXR1cmU6ICfZhtit2KrYp9isINij2KvYp9ir4oCmJywKICBleF9waG9uZV9mdWxsOiAn2YbYrdiq2KfYrCBTYW1zdW5nIFMyNCDZhdiz2KrYudmF2YQg2YHZiiDYp9mE2YXYr9mK2Kkg2KjYo9mC2YQg2YXZhiA5MDAwMCDYr9isJywgZXhfZWxlY3RyaWNpYW5fZnVsbDogJ9mG2K3Yqtin2Kwg2YPZh9ix2KjYp9im2Yog2YHZiiDZgti12LEg2KfZhNio2K7Yp9ix2Yog2YrYtdmE2K0g2LnYt9mEINmB2Yog2KfZhNmF2YbYstmEJywgZXhfY2FyX2Z1bGw6ICfZhtit2KrYp9isINmC2LfYudipINi62YrYp9ixINmE2LPZitin2LHYqSBDbGlvIDQnLCBleF9mdXJuaXR1cmVfZnVsbDogJ9mG2K3Yqtin2Kwg2YPZhtio2Kkg2KjYs9i52LEg2KPZgtmEINmF2YYgNTAwMDAg2K/YrCcsCiAgcXVpY2tfY2F0czogJ9ij2YLYs9in2YUg2LPYsdmK2LnYqScsIGhvd19pdF93b3JrczogJ9mD2YrZgdin2LQg2YrYrtiv2YXYnycsIGhvdzE6ICfYqtmD2KrYqCDZiNin2LQg2KrYrdiq2KfYrCDYqNmD2YTYp9mF2YMnLCBob3cyOiAn2KfZhNiw2YPYp9ihINin2YTYp9i12LfZhtin2LnZiiDZitmB2YfZhSDZiNmK2KjYrdirINmI2YrZgtin2LHZhicsIGhvdzM6ICfYqtiu2KrYp9ixINij2K3Ys9mGINi52LHYtiDZiNiq2KrZiNin2LXZhCDZhdi5INin2YTYqNin2KbYuScsIGhlbGxvOiAn2YXYsdit2KjYpyB7bmFtZX0nLAogIC8vIHVuZGVyc3RhbmRpbmcKICB1bmRlcnN0b29kOiAn2YHZh9mF2Kog2LfZhNio2YMg2YfZg9iw2Kc6JywgZWRpdF9yZXF1ZXN0OiAn2KrYudiv2YrZhCDYp9mE2LfZhNioJywga19wcm9kdWN0OiAn2KfZhNmF2YbYqtisIC8g2KfZhNiu2K/ZhdipJywga19jYXRlZ29yeTogJ9in2YTZgtiz2YUnLCBrX2xvY2F0aW9uOiAn2KfZhNmF2YPYp9mGJywga19idWRnZXQ6ICfYp9mE2YXZitiy2KfZhtmK2KknLCBrX2NvbmRpdGlvbjogJ9in2YTYrdin2YTYqScsIGtfcmVxdWlyZW1lbnRzOiAn2YXZiNin2LXZgdin2KonLCBrX25vdF9zZXQ6ICfYutmK2LEg2YXYrdiv2K8nLAogIGJ1ZGdldF91cF90bzogJ9it2KrZiSB7dn0nLCBidWRnZXRfZnJvbTogJ9mF2YYge3Z9JywgYnVkZ2V0X3JhbmdlOiAn2YXZhiB7YX0g2KXZhNmJIHtifScsIGFpX2Fza3M6ICfYp9mE2LDZg9in2KEg2KfZhNin2LXYt9mG2KfYudmKJywgYW5zd2VyX3BoOiAn2KfZg9iq2Kgg2KzZiNin2KjZgyDZh9mG2KfigKYnLCB1bmRlcnN0YW5kaW5nOiAn2KzYp9ix2Yog2YHZh9mFINi32YTYqNmD4oCmJywKICBjb25kX25ldzogJ9is2K/ZitivJywgY29uZF91c2VkOiAn2YXYs9iq2LnZhdmEJywgY29uZF91c2VkX2V4Y2VsbGVudDogJ9mF2LPYqti52YXZhCDigJQg2YXZhdiq2KfYstipJywgY29uZF91c2VkX2dvb2Q6ICfZhdiz2KrYudmF2YQg4oCUINis2YrYr9ipJywgY29uZF91c2VkX2ZhaXI6ICfZhdiz2KrYudmF2YQg4oCUINmF2YLYqNmI2YTYqScsIGNvbmRfYW55OiAn2LrZitixINmF2YfZhScsCiAga2luZF9wcm9kdWN0OiAn2YXZhtiq2KwnLCBraW5kX3NlcnZpY2U6ICfYrtiv2YXYqScsIGVkaXRfdGl0bGU6ICfYudiv2ZHZhCDYt9mE2KjZgycsIGJ1ZGdldF9taW46ICfYo9iv2YbZiSDZhdmK2LLYp9mG2YrYqScsIGJ1ZGdldF9tYXg6ICfYo9mC2LXZiSDZhdmK2LLYp9mG2YrYqScsIGFwcGx5OiAn2KrYt9io2YrZgicsCiAgLy8gc2VhcmNoaW5nCiAgc3RlcF9hbmFseXppbmc6ICfYp9mE2LDZg9in2KEg2KfZhNin2LXYt9mG2KfYudmKINmK2K3ZhNmEINi32YTYqNmD4oCmJywgc3RlcF9zZWFyY2hpbmc6ICfZitio2K3YqyDYudmGINin2YTYrtmK2KfYsdin2Kog2KfZhNmF2YbYp9iz2KjYqeKApicsIHN0ZXBfY29tcGFyaW5nOiAn2YrZgtin2LHZhiDYp9mE2KPYs9i52KfYseKApicsIHN0ZXBfdmVyaWZ5aW5nOiAn2YrYqtit2YLZgiDZhdmGINin2YTZhdi52YTZiNmF2KfYquKApicsIHN0ZXBfZG9uZTogJ9mI2KzYr9mG2Kcg2YTZgyDYo9mB2LbZhCDYp9mE2K7Zitin2LHYp9iqLicsIHN0ZXBfaWRsZTogJ9mG2KjYr9ijINio2LnYryDZhNit2LjYqeKApicsCiAgZm91bmRfbjogJ9iq2YUg2KfZhNi52KvZiNixINi52YTZiSB7bn0nLCBub19vZmZlcnNfeWV0OiAn2YTZhSDYqti12YQg2LnYsdmI2LYg2KjYudivJywgc2VhcmNoX3dpZGVyOiAn2YjYs9mR2Lkg2KfZhNio2K3YqycsIHdhaXRpbmdfcHJvdmlkZXJzOiAn2KPYsdiz2YTZhtinINi32YTYqNmDINmE2YXZgtiv2YXZiiDYp9mE2K7Yr9mF2Kkg2KfZhNmF2LPYrNmE2YrZhtiMINmI2LPZhti52YTZhdmDINi52YbYryDZiNi12YjZhCDYudix2YjYtiDYrNiv2YrYr9ipLicsIHNlZV9yZXN1bHRzOiAn2KfYudix2LYg2KfZhNmG2KrYp9im2KwnLAogIC8vIHJlc3VsdHMgLyBvZmZlcnMKICByZXN1bHRzOiAn2KfZhNmG2KrYp9im2KwnLCBiZXN0X29mZmVyOiAn2KfZhNij2YHYttmEJywgZGV0YWlsczogJ9i52LHYtiDYp9mE2KrZgdin2LXZitmEJywgY2hvb3NlX29mZmVyOiAn2KfYrtiq2YrYp9ixINmH2LDYpyDYp9mE2LnYsdi2JywgY29tcGFyZTogJ9mC2KfYsdmGINin2YTYudix2YjYticsIHNlbGVjdF90b19jb21wYXJlOiAn2KfYrtiq2LEg2LnYsdi22YrZhiDYo9mIINij2YPYq9ixINmE2YTZhdmC2KfYsdmG2KknLCBjb21wYXJlX3NlbGVjdGVkOiAn2YLYp9ix2YYgKHtufSknLAogIG9mZmVyX246ICfYp9mE2LnYsdi2IHtufScsIHByaWNlOiAn2KfZhNiz2LnYsScsIGNvbmRpdGlvbjogJ9in2YTYrdin2YTYqScsIGxvY2F0aW9uOiAn2KfZhNmF2YjZgti5JywgcmF0aW5nOiAn2KfZhNiq2YLZitmK2YUnLCB2ZXJpZmljYXRpb246ICfYp9mE2KrZiNir2YrZgicsIGRlbGl2ZXJ5OiAn2KfZhNiq2YjYtdmK2YQnLCB0b3RhbDogJ9in2YTZhdis2YXZiNi5Jywgc2NvcmU6ICfYp9mE2YbZgtin2LcnLCBwcm92aWRlcjogJ9mF2YLYr9mFINin2YTYrtiv2YXYqScsIGFkZGVkOiAn2KPZj9i22YrZgScsCiAgdmVyaWZpZWRfc2VsbGVyOiAn2KjYp9im2Lkg2YXZiNir2YInLCBub3RfdmVyaWZpZWQ6ICfYutmK2LEg2YXZiNir2YInLCBub19yZXZpZXdzOiAn2KjYr9mI2YYg2KrZgtmK2YrZhScsIGZyZWU6ICfYqNiv2YjZhicsIHNlbGxlcl9wcmljZTogJ9iz2LnYsSDYp9mE2KjYp9im2LknLCBzZXJ2aWNlX2ZlZTogJ9ix2LPZiNmFINio2YTYpyDYtNmC2YknLCBkZWxpdmVyeV9mZWU6ICfYp9mE2KrZiNi12YrZhCcsIGZpbmFsX3ByaWNlOiAn2KfZhNiz2LnYsSDYp9mE2YbZh9in2KbZiicsCiAgYWlfcmVjb21tZW5kYXRpb246ICfYqtmI2LXZitipINin2YTYsNmD2KfYoSDYp9mE2KfYtdi32YbYp9i52YonLCBhc2tfYWk6ICfYp9iz2KPZhCDYp9mE2YXYs9in2LnYryDYudmGINi52LHZiNi22YMnLCBhc2tfYWlfcGg6ICfZhdir2YTYpzog2KPZiiDYudix2LYg2YfZiCDYp9mE2KPYsdiu2LXYnycsIHBpY2tfYmVzdDogJ9in2K7YqtmK2KfYsSDYo9mB2LbZhCDYudix2LYnLCB3YXJuaW5nczogJ9iq2YbYqNmK2YfYp9iqJywKICBwYXltZW50X21ldGhvZDogJ9i32LHZitmC2Kkg2KfZhNiv2YHYuScsIHBheV9jb2Q6ICfYp9mE2K/Zgdi5INi52YbYryDYp9mE2KfYs9iq2YTYp9mFJywgcGF5X2RpcmVjdDogJ9in2YTYr9mB2Lkg2KfZhNmF2KjYp9i02LEg2YTZhNio2KfYpti5JywgcGF5X25vdGU6ICfZhNinINmK2YjYrNivINiv2YHYuSDYpdmE2YPYqtix2YjZhtmKINmB2Yog2YfYsNmHINin2YTZhtiz2K7YqS4g2KrYr9mB2Lkg2YXYqNin2LTYsdipINmE2YTYqNin2KbYuSDYudmG2K8g2KfZhNin2LPYqtmE2KfZhS4nLCBjb25maXJtX2Nob2ljZTogJ9iq2KPZg9mK2K8g2KfZhNin2K7YqtmK2KfYsScsIGNob3NlbjogJ9iq2YUg2KfYrtiq2YrYp9ixINin2YTYudix2LYuINio2KfZhtiq2LjYp9ixINiq2KPZg9mK2K8g2YXZgtiv2YUg2KfZhNiu2K/ZhdipLicsCiAgZmVlX25vdGU6ICfYsdiz2YjZhSDYqNmE2Kcg2LTZgtmJINiq2LrYt9mKINin2YTYqNit2Ksg2YjYp9mE2YXZgtin2LHZhtipINmI2KfZhNiq2YjYq9mK2YIuJywgY29udGFjdF9wcm92aWRlcjogJ9iq2YjYp9i12YQg2YXYuSDZhdmC2K/ZhSDYp9mE2K7Yr9mF2KknLCBwcm92aWRlcl9wcm9maWxlOiAn2LXZgdit2Kkg2YXZgtiv2YUg2KfZhNiu2K/ZhdipJywgcmV2aWV3czogJ9in2YTYqtmC2YrZitmF2KfYqicsIHByb2R1Y3RzOiAn2KfZhNmF2YbYqtis2KfYqicsIHNlcnZpY2VzOiAn2KfZhNiu2K/Zhdin2KonLCBjb21wbGV0ZWRfb3JkZXJzOiAn2LfZhNio2KfYqiDZhdmD2KrZhdmE2KknLCBtZW1iZXJfc2luY2U6ICfYudi22Ygg2YXZhtiwJywKICBmYXZvcml0ZV9hZGQ6ICfYo9i22YEg2YTZhNmF2YHYttmE2KknLCBmYXZvcml0ZV9yZW1vdmU6ICfYpdiy2KfZhNipINmF2YYg2KfZhNmF2YHYttmE2KknLAogIC8vIHJlcXVlc3RzCiAgbXlfcmVxdWVzdHM6ICfYt9mE2KjYp9iq2YonLCByZXF1ZXN0X246ICfYt9mE2KggI3tufScsIG5vX3JlcXVlc3RzOiAn2YXYpyDYudmG2K/Zg9i0INi32YTYqNin2Kog2KjYudivLicsIG5ld19yZXF1ZXN0OiAn2LfZhNioINis2K/ZitivJywgY2FuY2VsX3JlcXVlc3Q6ICfYpdmE2LrYp9ihINin2YTYt9mE2KgnLCBjb25maXJtX2NhbmNlbDogJ9mF2KrYo9mD2K8g2YXZhiDYpdmE2LrYp9ihINin2YTYt9mE2KjYnycsIG1hcmtfY29tcGxldGU6ICfYqtmFINin2YTYp9iz2KrZhNin2YUgLyDYp9mD2KrZhdmEINin2YTYt9mE2KgnLCByYXRlX3Byb3ZpZGVyOiAn2YLZitmR2YUg2YXZgtiv2YUg2KfZhNiu2K/ZhdipJywgcmF0ZV9jdXN0b21lcjogJ9mC2YrZkdmFINin2YTYstio2YjZhicsIHlvdXJfY29tbWVudDogJ9iq2LnZhNmK2YLZgyAo2KfYrtiq2YrYp9ix2YopJywgc3VibWl0X3JldmlldzogJ9il2LHYs9in2YQg2KfZhNiq2YLZitmK2YUnLCB0aGFua3NfcmV2aWV3OiAn2LTZg9ix2Kcg2LnZhNmJINiq2YLZitmK2YXZgyEnLCByZXZpZXdlZDogJ9iq2YUg2KfZhNiq2YLZitmK2YUg4pyTJywKICBwcm92aWRlcl9waG9uZTogJ9ix2YLZhSDZhdmC2K/ZhSDYp9mE2K7Yr9mF2KknLCBjYWxsOiAn2KfYqti12KfZhCcsIG9mZmVyc19jb3VudDogJ3tufSDYudix2YjYticsCiAgc3RhdHVzX05FVzogJ9is2K/ZitivJywgc3RhdHVzX1NFQVJDSElORzogJ9is2KfYsdmKINin2YTYqNit2KsnLCBzdGF0dXNfT0ZGRVJTX0ZPVU5EOiAn2YjYrNiv2YbYpyDYudix2YjYticsIHN0YXR1c19DT01QQVJJTkc6ICfZgtmK2K8g2KfZhNmF2YLYp9ix2YbYqScsIHN0YXR1c19VU0VSX1NFTEVDVEVEOiAn2KfYrtiq2LHYqiDYudix2LbYpycsIHN0YXR1c19JTl9QUk9HUkVTUzogJ9mC2YrYryDYp9mE2KrZhtmB2YrYsCcsIHN0YXR1c19DT01QTEVURUQ6ICfZhdmD2KrZhdmEJywgc3RhdHVzX0NBTkNFTExFRDogJ9mF2YTYutmJJywKICBzdGF0dXNfUEVORElORzogJ9io2KfZhtiq2LjYp9ixINin2YTYqtij2YPZitivJywKICAvLyBjaGF0CiAgY2hhdDogJ9in2YTYr9ix2K/YtNipJywgbm9fdGhyZWFkczogJ9mF2Kcg2YPYp9mK2YYg2K3YqtmJINmF2K3Yp9iv2KvYqS4nLCB0eXBlX21lc3NhZ2U6ICfYp9mD2KrYqCDYsdiz2KfZhNip4oCmJywgc2hhcmVfb2ZmZXI6ICfYo9ix2LPZhCDZhdi52YTZiNmF2KfYqiDYp9mE2LnYsdi2Jywgc2VuZF9waG90bzogJ9i12YjYsdipJywgY2hhdF9ub3RlOiAn2YTYrdmF2KfZitipINin2YTYt9ix2YHZitmG2Iwg2KPYsdmC2KfZhSDYp9mE2YfYp9iq2YEg2KrYuNmH2LEg2KrZhNmC2KfYptmK2Kcg2KjYudivINiq2KPZg9mK2K8g2KfZhNi32YTYqC4nLCBvZmZlcl9pbmZvOiAn2YXYudmE2YjZhdin2Kog2KfZhNi52LHYticsCiAgLy8gbm90aWZpY2F0aW9ucyBldGMuCiAgbm90aWZpY2F0aW9uczogJ9in2YTYpdi02LnYp9ix2KfYqicsIG5vX25vdGlmczogJ9mF2Kcg2YPYp9mK2YYg2K3YqtmJINil2LTYudin2LEuJywgbWFya19hbGxfcmVhZDogJ9iq2K3Yr9mK2K8g2KfZhNmD2YQg2YPZhdmC2LHZiNihJywgZmF2b3JpdGVzOiAn2KfZhNmF2YHYttmE2KknLCBub19mYXZzOiAn2YXYpyDYo9i22YHYqiDYrdiq2Ykg2YXZgtiv2YUg2K7Yr9mF2Kkg2YTZhNmF2YHYttmE2KkuJywKICBwcm9maWxlOiAn2K3Ys9in2KjZiicsIHNldHRpbmdzOiAn2KfZhNil2LnYr9in2K/Yp9iqJywgbGFuZ3VhZ2U6ICfYp9mE2YTYutipJywgY2hhbmdlX3Bhc3N3b3JkOiAn2KrYutmK2YrYsSDZg9mE2YXYqSDYp9mE2LPYsScsIGN1cnJlbnRfcGFzc3dvcmQ6ICfZg9mE2YXYqSDYp9mE2LPYsSDYp9mE2K3Yp9mE2YrYqScsIG5ld19wYXNzd29yZDogJ9mD2YTZhdipINin2YTYs9ixINin2YTYrNiv2YrYr9ipJywgc2F2ZWQ6ICfYqtmFINin2YTYrdmB2Lgg4pyTJywgaGVscDogJ9in2YTZhdiz2KfYudiv2Kkg2YjYp9mE2K/YudmFJywKICBoZWxwX2ludHJvOiAn2YPZitmB2KfYtCDZhtmC2K/YsSDZhti52KfZiNmG2YPYnycsIGZhcTFfcTogJ9mD2YrZgdin2LQg2YrYrtiv2YUg2KjZhNinINi02YLZidifJywgZmFxMV9hOiAn2KrZg9iq2Kgg2YjYp9i0INiq2K3Yqtin2KzYjCDYp9mE2LDZg9in2KEg2KfZhNin2LXYt9mG2KfYudmKINmK2YHZh9mFINi32YTYqNmDINmI2YrYqNit2Ksg2YHZiiDYp9mE2KjYp9im2LnZitmGINin2YTZhdiz2KzZhNmK2YbYjCDZitmC2KfYsdmGINin2YTYudix2YjYtiDZiNmK2YLYqtix2K0g2KfZhNij2YHYttmELiDYo9mG2Kog2KrYrtiq2KfYsS4nLAogIGZhcTJfcTogJ9mI2KfYtCDZh9mKINix2LPZiNmFINio2YTYpyDYtNmC2YnYnycsIGZhcTJfYTogJ9mG2LPYqNipINi12LrZitix2Kkg2KrYuNmH2LEg2YTZgyDYqNmI2LbZiNitINmC2KjZhCDYp9mE2KrYo9mD2YrYrzog2LPYudixINin2YTYqNin2KbYuSArINix2LPZiNmFINio2YTYpyDYtNmC2YkgKyDYp9mE2KrZiNi12YrZhCA9INin2YTYs9i52LEg2KfZhNmG2YfYp9im2YouJywKICBmYXEzX3E6ICfZg9mK2YHYp9i0INmG2K/Zgdi52J8nLCBmYXEzX2E6ICfZgdmKINmH2LDZhyDYp9mE2YbYs9iu2Kkg2KfZhNiv2YHYuSDYudmG2K8g2KfZhNin2LPYqtmE2KfZhSDYo9mIINmF2KjYp9i02LHYqSDZhNmE2KjYp9im2LkuINin2YTYr9mB2Lkg2KfZhNil2YTZg9iq2LHZiNmG2Yog2LPZiti22KfZgSDZhNin2K3ZgtinLicsCiAgZmFxNF9xOiAn2YjYp9i0INin2YTYsNmD2KfYoSDYp9mE2KfYtdi32YbYp9i52Yog2YrYrtiq2LHYuSDYudix2YjYttifJywgZmFxNF9hOiAn2YTYpy4g2YPZhCDYudix2LYg2K3ZgtmK2YLZiiDZhdmGINio2KfYpti5INmF2LPYrNmELiDYpdiw2Kcg2YXYpyDZhNmC2YrZhtin2LTYjCDZhtmC2YjZhNmI2Kcg2YTZgyDYqNmI2LbZiNitLicsCiAgY29tcGxhaW50OiAn2KXYsdiz2KfZhCDYtNmD2YjZiScsIGNvbXBsYWludF9zdWJqZWN0OiAn2KfZhNmF2YjYttmI2LknLCBjb21wbGFpbnRfYm9keTogJ9in2YTYqtmB2KfYtdmK2YQnLCBjb21wbGFpbnRfc2VudDogJ9iq2YUg2KXYsdiz2KfZhCDYtNmD2YjYp9mDLiDYs9mG2KrZiNin2LXZhCDZhdi52YMuJywKICAvLyBwcm92aWRlcgogIHByb3ZfZGFzaGJvYXJkOiAn2YTZiNit2Kkg2YXZgtiv2YUg2KfZhNiu2K/ZhdipJywgZWFybmluZ3M6ICfYp9mE2KPYsdio2KfYrScsIGVhcm5pbmdzXzMwOiAn2KLYrtixIDMwINmK2YjZhScsIHBlbmRpbmdfYW1vdW50OiAn2KjYp9mG2KrYuNin2LEg2KfZhNiq2K3YtdmK2YQnLCBvZmZlcnNfc2VudDogJ9i52LHZiNi2INmF2LHYs9mE2KknLCBvZmZlcnNfd29uOiAn2LnYsdmI2LYg2YXZgtio2YjZhNipJywgaW5jb21pbmdfcmVxdWVzdHM6ICfYt9mE2KjYp9iqINmI2KfYsdiv2KknLCBub19pbmNvbWluZzogJ9mF2Kcg2YPYp9mK2YYg2LfZhNio2KfYqiDZhdmG2KfYs9io2Kkg2K3Yp9mE2YrYpy4nLAogIHNlbmRfb2ZmZXI6ICfYpdix2LPYp9mEINi52LHYticsIG9mZmVyX3RpdGxlOiAn2LnZhtmI2KfZhiDYp9mE2LnYsdi2Jywgb2ZmZXJfcHJpY2U6ICfYp9mE2LPYudixICjYr9isKScsIG9mZmVyX2RlbGl2ZXJ5OiAn2KfZhNiq2YjYtdmK2YQgKNiv2KwpJywgb2ZmZXJfdGltZTogJ9mF2K/YqSDYp9mE2KrZhtmB2YrYsCAvINin2YTYqtiz2YTZitmFJywgb2ZmZXJfZGVzYzogJ9iq2YHYp9i12YrZhCcsIG9mZmVyX3NlbnQ6ICfYqtmFINil2LHYs9in2YQg2KfZhNi52LHYtiDinJMnLCBteV9vZmZlcjogJ9i52LHYttmDJywgd2l0aGRyYXc6ICfYs9it2Kgg2KfZhNi52LHYticsCiAgY3VzdG9tZXJfcmVxdWVzdDogJ9i32YTYqCDYp9mE2LLYqNmI2YYnLCBvcmRlcnM6ICfYp9mE2LfZhNio2KfYqicsIGFjY2VwdF9vcmRlcjogJ9mC2KjZiNmEINmI2KrYo9mD2YrYrycsIGRlY2xpbmVfb3JkZXI6ICfYsdmB2LYnLCB5b3VyX25ldDogJ9i12KfZgdmKINix2KjYrdmDJywgY3VzdG9tZXI6ICfYp9mE2LLYqNmI2YYnLCBub19vcmRlcnM6ICfZhdinINmD2KfZitmGINi32YTYqNin2KouJywKICBjYXRhbG9nOiAn2YXZhtiq2KzYp9iq2Yog2YjYrtiv2YXYp9iq2YonLCBhZGRfcHJvZHVjdDogJ9il2LbYp9mB2Kkg2YXZhtiq2KwnLCBhZGRfc2VydmljZTogJ9il2LbYp9mB2Kkg2K7Yr9mF2KknLCB0aXRsZTogJ9in2YTYudmG2YjYp9mGJywgY2F0ZWdvcnk6ICfYp9mE2YLYs9mFJywgYnJhbmQ6ICfYp9mE2YXYp9ix2YPYqScsIHByaWNlX2Zyb206ICfYp9mE2LPYudixINmF2YYnLCBwcmljZV90bzogJ9in2YTYs9i52LEg2KXZhNmJJywgcGhvdG9zOiAn2LXZiNixJywgaGlkZGVuOiAn2YXYrtmB2YonLAogIGF3YWl0aW5nX2FwcHJvdmFsOiAn2K3Ys9in2KjZgyDZgtmK2K8g2KfZhNmF2LHYp9is2LnYqS4g2LPZhtiu2KjYsdmDINi52YbYryDYp9mE2YXZiNin2YHZgtipLicsIHJlamVjdGVkX2FjY291bnQ6ICfYqtmFINix2YHYtiDYrdiz2KfYqNmDLiDYqtmI2KfYtdmEINmF2Lkg2KfZhNiv2LnZhS4nLCBwZW5kaW5nX2xhYmVsOiAn2YLZitivINin2YTZhdix2KfYrNi52KknLCBhcHByb3ZlZF9sYWJlbDogJ9mF2YLYqNmI2YQnLCByZWplY3RlZF9sYWJlbDogJ9mF2LHZgdmI2LYnLAogIC8vIGFkbWluCiAgYWRtaW46ICfZhNmI2K3YqSDYp9mE2KXYr9in2LHYqScsIGFfb3ZlcnZpZXc6ICfZhti42LHYqSDYudin2YXYqScsIGFfdXNlcnM6ICfYp9mE2YXYs9iq2K7Yr9mF2YjZhicsIGFfcHJvdmlkZXJzOiAn2YXZgtiv2YXZiCDYp9mE2K7Yr9mF2KknLCBhX3JlcXVlc3RzOiAn2KfZhNi32YTYqNin2KonLCBhX2ZhaWxlZDogJ9i32YTYqNin2Kog2YHYtNmEINin2YTYsNmD2KfYoSDYp9mE2KfYtdi32YbYp9i52YonLCBhX29mZmVyczogJ9in2YTYudix2YjYticsIGFfY2F0ZWdvcmllczogJ9in2YTYo9mC2LPYp9mFJywgYV9mZWVzOiAn2KfZhNix2LPZiNmFJywgYV9jb21wbGFpbnRzOiAn2KfZhNi02YPYp9mI2YknLCBhX3Jldmlld3M6ICfYp9mE2KrZgtmK2YrZhdin2KonLCBhX2xvZ3M6ICfYp9mE2LPYrNmE2KfYqicsCiAgYXBwcm92ZTogJ9mC2KjZiNmEJywgcmVqZWN0OiAn2LHZgdi2JywgdmVyaWZ5OiAn2KrZiNir2YrZgicsIHVudmVyaWZ5OiAn2LPYrdioINin2YTYqtmI2KvZitmCJywgc3VzcGVuZDogJ9il2YrZgtin2YEnLCByZWFjdGl2YXRlOiAn2KrZgdi52YrZhCcsIHJlcnVuOiAn2KXYudin2K/YqSDYp9mE2KjYrdirJywgaGlkZTogJ9il2K7Zgdin2KEnLCBzaG93OiAn2KXYuNmH2KfYsScsIHJlc29sdmU6ICfYqtmFINin2YTYrdmEJywgZGlzbWlzczogJ9iq2KzYp9mH2YQnLAogIGZlZV9wZXJjZW50OiAn2YbYs9io2Kkg2KfZhNix2LPZiNmFICUnLCBmZWVfbWluOiAn2KPYr9mG2Ykg2LHYs9mI2YUgKNiv2KwpJywgZmVlX21heDogJ9ij2YLYtdmJINix2LPZiNmFICjYr9isKScsIGRlbGl2ZXJ5X3NhbWU6ICfYqtmI2LXZitmEINmG2YHYsyDYp9mE2YjZhNin2YrYqSAo2K/YrCknLCBkZWxpdmVyeV9vdGhlcjogJ9iq2YjYtdmK2YQg2YjZhNin2YrYqSDYo9iu2LHZiSAo2K/YrCknLCBzY29yZV93ZWlnaHRzOiAn2KPZiNiy2KfZhiDYp9mE2KrYsdiq2YrYqCcsCiAgd19wcmljZTogJ9in2YTYs9i52LEnLCB3X3JhdGluZzogJ9in2YTYqtmC2YrZitmFJywgd192ZXJpZmllZDogJ9in2YTYqtmI2KvZitmCJywgd19jb25kaXRpb246ICfYp9mE2K3Yp9mE2KknLCB3X2xvY2F0aW9uOiAn2KfZhNmC2LHYqCcsIHdfZGVsaXZlcnk6ICfYp9mE2KrZiNi12YrZhCcsCiAgc191c2VyczogJ9iy2KjYp9im2YYnLCBzX3Byb3ZpZGVyczogJ9mF2YLYr9mF2Ygg2K7Yr9mF2KknLCBzX3BlbmRpbmc6ICfZitmG2KrYuNix2YjZhiDYp9mE2YXZiNin2YHZgtipJywgc19yZXF1ZXN0czogJ9i32YTYqNin2KonLCBzX2ZhaWxlZDogJ9mB2LTZhCDYp9mE2LDZg9in2KEg2KfZhNin2LXYt9mG2KfYudmKJywgc19zdXNwaWNpb3VzOiAn2YXYtNio2YjZh9ipJywgc19vZmZlcnM6ICfYudix2YjYticsIHNfY29tcGxldGVkOiAn2YXZg9iq2YXZhNipJywgc19nbXY6ICfYrdis2YUg2KfZhNmF2LnYp9mF2YTYp9iqJywgc19mZWVzOiAn2KPYsdio2KfYrSDYp9mE2YXZhti12KknLCBzX2NvbXBsYWludHM6ICfYtNmD2KfZiNmJINmF2YHYqtmI2K3YqScsCiAgc3VzcGljaW91czogJ9mF2LTYqNmI2YcnLCBzZWFyY2hfdXNlcnM6ICfYqNit2Ksg2KjYp9mE2KfYs9mFINij2Ygg2KfZhNil2YrZhdmK2YQg2KPZiCDYp9mE2YfYp9iq2YEnLCBhZGRfY2F0ZWdvcnk6ICfYpdi22KfZgdipIC8g2KrYudiv2YrZhCDZgtiz2YUnLCBzbHVnOiAn2KfZhNmF2LnYsdmR2YEgKHNsdWcpJywKfTsK", "base64") },
  "js/i18n/fr.js": { path: "js/i18n/fr.js", buf: Buffer.from("ZXhwb3J0IGRlZmF1bHQgewogIGFwcF9uYW1lOiAnQmxhIFNoYXFhJywgdGFnbGluZTogJ0Rpcy1ub3VzIGNlIGRvbnQgdHUgYXMgYmVzb2luLCBvbiBz4oCZb2NjdXBlIGR1IHJlc3RlLicsIGN1cnJlbmN5OiAnREEnLCBqdXN0X25vdzogJ8OgIGzigJlpbnN0YW50JywKICBjYW5jZWw6ICdBbm51bGVyJywgY29uZmlybTogJ0NvbmZpcm1lcicsIHNhdmU6ICdFbnJlZ2lzdHJlcicsIGJhY2s6ICdSZXRvdXInLCBuZXh0OiAnU3VpdmFudCcsIHNraXA6ICdQYXNzZXInLCBzdGFydDogJ0NvbW1lbmNlcicsIGNsb3NlOiAnRmVybWVyJywgc2VuZDogJ0Vudm95ZXInLCBlZGl0OiAnTW9kaWZpZXInLCBkZWxldGU6ICdTdXBwcmltZXInLCBsb2FkaW5nOiAnQ2hhcmdlbWVudOKApicsIG1vcmU6ICdQbHVzJywKICBlcnJfZ2VuZXJpYzogJ1VuIHByb2Jsw6htZSBlc3Qgc3VydmVudSwgcsOpZXNzYWllLicsIGVycl9uZXR3b3JrOiAnUGFzIGRlIGNvbm5leGlvbiBpbnRlcm5ldC4nLCBsb2dvdXQ6ICdTZSBkw6ljb25uZWN0ZXInLCB5ZXM6ICdPdWknLCBubzogJ05vbicsCiAgb25iMV90OiAnw4ljcmlzIGNlIGRvbnQgdHUgYXMgYmVzb2luJywgb25iMV9wOiAnUGx1cyBiZXNvaW4gZGUgZm91aWxsZXIgZGFucyBsZXMgYW5ub25jZXMuIETDqWNyaXMgdGEgZGVtYW5kZSwgY+KAmWVzdCB0b3V0LicsCiAgb25iMl90OiAnTOKAmUlBIGNoZXJjaGUgcG91ciB0b2knLCBvbmIyX3A6ICdFbGxlIGNvbXByZW5kIHRhIGRlbWFuZGUsIHRyb3V2ZSBsZXMgb2ZmcmVzIGV0IGNvbXBhcmUgcHJpeCBldCBhdmlzLicsCiAgb25iM190OiAnQ2hvaXNpcyBsYSBtZWlsbGV1cmUgb2ZmcmUnLCBvbmIzX3A6ICdQcml4IGNsYWlyIHNhbnMgc3VycHJpc2UsIGV0IGNvbnRhY3QgZGlyZWN0IGF2ZWMgbGUgdmVuZGV1ciBkYW5zIGzigJlhcHBsaS4nLAogIGxvZ2luOiAnQ29ubmV4aW9uJywgcmVnaXN0ZXI6ICdDcsOpZXIgdW4gY29tcHRlJywgZW1haWxfb3JfcGhvbmU6ICdFLW1haWwgb3UgdMOpbMOpcGhvbmUnLCBwYXNzd29yZDogJ01vdCBkZSBwYXNzZScsIG5hbWU6ICdOb20nLCBlbWFpbDogJ0UtbWFpbCcsIHBob25lOiAnVMOpbMOpcGhvbmUgKDA1LzA2LzA34oCmKScsCiAgZW1haWxfb3B0OiAnRS1tYWlsIChmYWN1bHRhdGlmIHNpIHTDqWzDqXBob25lKScsIHBob25lX29wdDogJ1TDqWzDqXBob25lIChmYWN1bHRhdGlmIHNpIGUtbWFpbCknLCBub19hY2NvdW50OiAnUGFzIGVuY29yZSBkZSBjb21wdGUgPycsIGhhdmVfYWNjb3VudDogJ0TDqWrDoCB1biBjb21wdGUgPycsCiAgaV9hbV91c2VyOiAnSmUgc3VpcyBjbGllbnQnLCBpX2FtX3Byb3ZpZGVyOiAnSmUgc3VpcyB2ZW5kZXVyIC8gcHJlc3RhdGFpcmUnLCB3aWxheWE6ICdXaWxheWEnLCBjb21tdW5lOiAnQ29tbXVuZScsIGNob29zZTogJ0Nob2lzaXLigKYnLCBhbGxfd2lsYXlhczogJ1RvdXRlcyBsZXMgd2lsYXlhcycsIHB3X2hpbnQ6ICc4IGNhcmFjdMOocmVzIG1pbmltdW0nLAogIGJ1c2luZXNzX25hbWU6ICdOb20gZGUgbOKAmWFjdGl2aXTDqScsIGFjdGl2aXR5OiAnVHlwZSBk4oCZYWN0aXZpdMOpJywgZGVzY3JpcHRpb246ICdEZXNjcmlwdGlvbicsIHdvcmtpbmdfaG91cnM6ICdIb3JhaXJlcycsIGNhdGVnb3JpZXNfc2VydmVkOiAnQ2F0w6lnb3JpZXMgc2VydmllcycsCiAgcHJvdmlkZXJfcGVuZGluZ19ub3RlOiAnVG9uIGNvbXB0ZSBhdHRlbmQgbGEgdmFsaWRhdGlvbiBkZSBs4oCZw6lxdWlwZSBhdmFudCBkZSByZWNldm9pciBkZXMgZGVtYW5kZXMuJywgZGVtb19hY2NvdW50czogJ0NvbXB0ZXMgZGUgZMOpbW8gKG1vdCBkZSBwYXNzZSA6IERlbW8xMjM0NSknLAogIG5hdl9ob21lOiAnQWNjdWVpbCcsIG5hdl9yZXF1ZXN0czogJ01lcyBkZW1hbmRlcycsIG5hdl9jaGF0OiAnTWVzc2FnZXMnLCBuYXZfcHJvZmlsZTogJ1Byb2ZpbCcsIG5hdl9kYXNoYm9hcmQ6ICdUYWJsZWF1JywgbmF2X29yZGVyczogJ0NvbW1hbmRlcycsIG5hdl9pbmNvbWluZzogJ1Jlw6d1ZXMnLCBuYXZfY2F0YWxvZzogJ0NhdGFsb2d1ZScsCiAgYXNrX3BoOiAnRGUgcXVvaSBhcy10dSBiZXNvaW4gPyDDiWNyaXMgaWNp4oCmJywgc2VhcmNoX21lOiAnQ2hlcmNoZSBwb3VyIG1vaSDwn5SNJywgZXhfcGhvbmU6ICdKZSBjaGVyY2hlIHVuIHTDqWzDqXBob25l4oCmJywgZXhfZWxlY3RyaWNpYW46ICdKZSBjaGVyY2hlIHVuIMOpbGVjdHJpY2llbuKApicsIGV4X2NhcjogJ0plIGNoZXJjaGUgdW5lIHZvaXR1cmXigKYnLCBleF9mdXJuaXR1cmU6ICdKZSBjaGVyY2hlIGRlcyBtZXVibGVz4oCmJywKICBleF9waG9uZV9mdWxsOiAnSmUgY2hlcmNoZSB1biBTYW1zdW5nIFMyNCBk4oCZb2NjYXNpb24gw6AgTcOpZMOpYSDDoCBtb2lucyBkZSA5MDAwMCBEQScsIGV4X2VsZWN0cmljaWFuX2Z1bGw6ICdKZSBjaGVyY2hlIHVuIMOpbGVjdHJpY2llbiDDoCBLc2FyIEVsIEJvdWtoYXJpIHBvdXIgdW5lIHBhbm5lIMOgIGxhIG1haXNvbicsIGV4X2Nhcl9mdWxsOiAnSmUgY2hlcmNoZSB1bmUgcGnDqGNlIHBvdXIgQ2xpbyA0JywgZXhfZnVybml0dXJlX2Z1bGw6ICdKZSBjaGVyY2hlIHVuIGNhbmFww6kgw6AgbW9pbnMgZGUgNTAwMDAgREEnLAogIHF1aWNrX2NhdHM6ICdDYXTDqWdvcmllcyByYXBpZGVzJywgaG93X2l0X3dvcmtzOiAnQ29tbWVudCDDp2EgbWFyY2hlID8nLCBob3cxOiAnVHUgw6ljcmlzIHRvbiBiZXNvaW4gYXZlYyB0ZXMgbW90cycsIGhvdzI6ICdM4oCZSUEgY29tcHJlbmQsIGNoZXJjaGUgZXQgY29tcGFyZScsIGhvdzM6ICdUdSBjaG9pc2lzIGxhIG1laWxsZXVyZSBvZmZyZSBldCB0dSBkaXNjdXRlcyBhdmVjIGxlIHZlbmRldXInLCBoZWxsbzogJ1NhbHV0IHtuYW1lfScsCiAgdW5kZXJzdG9vZDogJ0rigJlhaSBjb21wcmlzIHRhIGRlbWFuZGUgYWluc2kgOicsIGVkaXRfcmVxdWVzdDogJ01vZGlmaWVyJywga19wcm9kdWN0OiAnUHJvZHVpdCAvIHNlcnZpY2UnLCBrX2NhdGVnb3J5OiAnQ2F0w6lnb3JpZScsIGtfbG9jYXRpb246ICdMaWV1Jywga19idWRnZXQ6ICdCdWRnZXQnLCBrX2NvbmRpdGlvbjogJ8OJdGF0Jywga19yZXF1aXJlbWVudHM6ICdDcml0w6hyZXMnLCBrX25vdF9zZXQ6ICdOb24gcHLDqWNpc8OpJywKICBidWRnZXRfdXBfdG86ICdqdXNxdeKAmcOgIHt2fScsIGJ1ZGdldF9mcm9tOiAnw6AgcGFydGlyIGRlIHt2fScsIGJ1ZGdldF9yYW5nZTogJ2RlIHthfSDDoCB7Yn0nLCBhaV9hc2tzOiAnSUEnLCBhbnN3ZXJfcGg6ICfDiWNyaXMgdGEgcsOpcG9uc2XigKYnLCB1bmRlcnN0YW5kaW5nOiAnQW5hbHlzZSBkZSB0YSBkZW1hbmRl4oCmJywKICBjb25kX25ldzogJ05ldWYnLCBjb25kX3VzZWQ6ICdPY2Nhc2lvbicsIGNvbmRfdXNlZF9leGNlbGxlbnQ6ICdPY2Nhc2lvbiDigJQgZXhjZWxsZW50JywgY29uZF91c2VkX2dvb2Q6ICdPY2Nhc2lvbiDigJQgYm9uJywgY29uZF91c2VkX2ZhaXI6ICdPY2Nhc2lvbiDigJQgY29ycmVjdCcsIGNvbmRfYW55OiAnUGV1IGltcG9ydGUnLAogIGtpbmRfcHJvZHVjdDogJ1Byb2R1aXQnLCBraW5kX3NlcnZpY2U6ICdTZXJ2aWNlJywgZWRpdF90aXRsZTogJ01vZGlmaWVyIHRhIGRlbWFuZGUnLCBidWRnZXRfbWluOiAnQnVkZ2V0IG1pbicsIGJ1ZGdldF9tYXg6ICdCdWRnZXQgbWF4JywgYXBwbHk6ICdBcHBsaXF1ZXInLAogIHN0ZXBfYW5hbHl6aW5nOiAnTOKAmUlBIGFuYWx5c2UgdGEgZGVtYW5kZeKApicsIHN0ZXBfc2VhcmNoaW5nOiAnUmVjaGVyY2hlIGRlcyBvcHRpb25zIGFkYXB0w6llc+KApicsIHN0ZXBfY29tcGFyaW5nOiAnQ29tcGFyYWlzb24gZGVzIHByaXjigKYnLCBzdGVwX3ZlcmlmeWluZzogJ1bDqXJpZmljYXRpb24gZGVzIGluZm9ybWF0aW9uc+KApicsIHN0ZXBfZG9uZTogJ09uIGEgdHJvdXbDqSBsZXMgbWVpbGxldXJlcyBvcHRpb25zLicsIHN0ZXBfaWRsZTogJ09uIGTDqW1hcnJl4oCmJywKICBmb3VuZF9uOiAne259IHRyb3V2w6kocyknLCBub19vZmZlcnNfeWV0OiAnQXVjdW5lIG9mZnJlIHBvdXIgbOKAmWluc3RhbnQnLCBzZWFyY2hfd2lkZXI6ICfDiWxhcmdpciBsYSByZWNoZXJjaGUnLCB3YWl0aW5nX3Byb3ZpZGVyczogJ1RhIGRlbWFuZGUgZXN0IGVudm95w6llIGF1eCBwcmVzdGF0YWlyZXMgaW5zY3JpdHMuIE9uIHRlIHByw6l2aWVudCBkw6hzIHF14oCZdW5lIG9mZnJlIGFycml2ZS4nLCBzZWVfcmVzdWx0czogJ1ZvaXIgbGVzIHLDqXN1bHRhdHMnLAogIHJlc3VsdHM6ICdSw6lzdWx0YXRzJywgYmVzdF9vZmZlcjogJ01laWxsZXVyZScsIGRldGFpbHM6ICdWb2lyIGxlcyBkw6l0YWlscycsIGNob29zZV9vZmZlcjogJ0Nob2lzaXIgY2V0dGUgb2ZmcmUnLCBjb21wYXJlOiAnQ29tcGFyZXInLCBzZWxlY3RfdG9fY29tcGFyZTogJ0Nob2lzaXMgMiBvZmZyZXMgb3UgcGx1cyDDoCBjb21wYXJlcicsIGNvbXBhcmVfc2VsZWN0ZWQ6ICdDb21wYXJlciAoe259KScsCiAgb2ZmZXJfbjogJ09mZnJlIHtufScsIHByaWNlOiAnUHJpeCcsIGNvbmRpdGlvbjogJ8OJdGF0JywgbG9jYXRpb246ICdMaWV1JywgcmF0aW5nOiAnTm90ZScsIHZlcmlmaWNhdGlvbjogJ1bDqXJpZmnDqScsIGRlbGl2ZXJ5OiAnTGl2cmFpc29uJywgdG90YWw6ICdUb3RhbCcsIHNjb3JlOiAnU2NvcmUnLCBwcm92aWRlcjogJ1ByZXN0YXRhaXJlJywgYWRkZWQ6ICdBam91dMOpJywKICB2ZXJpZmllZF9zZWxsZXI6ICdWZW5kZXVyIHbDqXJpZmnDqScsIG5vdF92ZXJpZmllZDogJ05vbiB2w6lyaWZpw6knLCBub19yZXZpZXdzOiAnUGFzIGTigJlhdmlzJywgZnJlZTogJ0dyYXR1aXQnLCBzZWxsZXJfcHJpY2U6ICdQcml4IGR1IHZlbmRldXInLCBzZXJ2aWNlX2ZlZTogJ0ZyYWlzIEJsYSBTaGFxYScsIGRlbGl2ZXJ5X2ZlZTogJ0xpdnJhaXNvbicsIGZpbmFsX3ByaWNlOiAnUHJpeCBmaW5hbCcsCiAgYWlfcmVjb21tZW5kYXRpb246ICdSZWNvbW1hbmRhdGlvbiBkZSBs4oCZSUEnLCBhc2tfYWk6ICdQb3NlIHVuZSBxdWVzdGlvbiBzdXIgdGVzIG9mZnJlcycsIGFza19haV9waDogJ0V4LiA6IHF1ZWxsZSBvZmZyZSBlc3QgbGEgbW9pbnMgY2jDqHJlID8nLCBwaWNrX2Jlc3Q6ICdDaG9pc2lyIGxhIG1laWxsZXVyZScsIHdhcm5pbmdzOiAnQWxlcnRlcycsCiAgcGF5bWVudF9tZXRob2Q6ICdNb2RlIGRlIHBhaWVtZW50JywgcGF5X2NvZDogJ1BhaWVtZW50IMOgIGxhIHLDqWNlcHRpb24nLCBwYXlfZGlyZWN0OiAnUGFpZW1lbnQgZGlyZWN0IGF1IHZlbmRldXInLCBwYXlfbm90ZTogJ1BhcyBkZSBwYWllbWVudCBlbiBsaWduZSBkYW5zIGNldHRlIHZlcnNpb24uIFR1IHBhaWVzIGRpcmVjdGVtZW50IGxlIHZlbmRldXIuJywgY29uZmlybV9jaG9pY2U6ICdDb25maXJtZXIgbGUgY2hvaXgnLCBjaG9zZW46ICdPZmZyZSBjaG9pc2llLiBFbiBhdHRlbnRlIGRlIGNvbmZpcm1hdGlvbiBkdSBwcmVzdGF0YWlyZS4nLAogIGZlZV9ub3RlOiAnTGVzIGZyYWlzIEJsYSBTaGFxYSBjb3V2cmVudCBsYSByZWNoZXJjaGUsIGxhIGNvbXBhcmFpc29uIGV0IGxhIHbDqXJpZmljYXRpb24uJywgY29udGFjdF9wcm92aWRlcjogJ0NvbnRhY3RlcicsIHByb3ZpZGVyX3Byb2ZpbGU6ICdQcm9maWwgZHUgcHJlc3RhdGFpcmUnLCByZXZpZXdzOiAnQXZpcycsIHByb2R1Y3RzOiAnUHJvZHVpdHMnLCBzZXJ2aWNlczogJ1NlcnZpY2VzJywgY29tcGxldGVkX29yZGVyczogJ2NvbW1hbmRlcyB0ZXJtaW7DqWVzJywgbWVtYmVyX3NpbmNlOiAnTWVtYnJlIGRlcHVpcycsCiAgZmF2b3JpdGVfYWRkOiAnQWpvdXRlciBhdXggZmF2b3JpcycsIGZhdm9yaXRlX3JlbW92ZTogJ1JldGlyZXIgZGVzIGZhdm9yaXMnLAogIG15X3JlcXVlc3RzOiAnTWVzIGRlbWFuZGVzJywgcmVxdWVzdF9uOiAnRGVtYW5kZSAje259Jywgbm9fcmVxdWVzdHM6ICdBdWN1bmUgZGVtYW5kZSBwb3VyIGzigJlpbnN0YW50LicsIG5ld19yZXF1ZXN0OiAnTm91dmVsbGUgZGVtYW5kZScsIGNhbmNlbF9yZXF1ZXN0OiAnQW5udWxlciBsYSBkZW1hbmRlJywgY29uZmlybV9jYW5jZWw6ICdBbm51bGVyIGNldHRlIGRlbWFuZGUgPycsIG1hcmtfY29tcGxldGU6ICdSZcOndSAvIGRlbWFuZGUgdGVybWluw6llJywgcmF0ZV9wcm92aWRlcjogJ05vdGVyIGxlIHByZXN0YXRhaXJlJywgcmF0ZV9jdXN0b21lcjogJ05vdGVyIGxlIGNsaWVudCcsIHlvdXJfY29tbWVudDogJ1RvbiBjb21tZW50YWlyZSAoZmFjdWx0YXRpZiknLCBzdWJtaXRfcmV2aWV3OiAnRW52b3llciBs4oCZYXZpcycsIHRoYW5rc19yZXZpZXc6ICdNZXJjaSBwb3VyIHRvbiBhdmlzICEnLCByZXZpZXdlZDogJ05vdMOpIOKckycsCiAgcHJvdmlkZXJfcGhvbmU6ICdUw6lsw6lwaG9uZSBkdSBwcmVzdGF0YWlyZScsIGNhbGw6ICdBcHBlbGVyJywgb2ZmZXJzX2NvdW50OiAne259IG9mZnJlcycsCiAgc3RhdHVzX05FVzogJ05vdXZlbGxlJywgc3RhdHVzX1NFQVJDSElORzogJ1JlY2hlcmNoZSBlbiBjb3VycycsIHN0YXR1c19PRkZFUlNfRk9VTkQ6ICdPZmZyZXMgdHJvdXbDqWVzJywgc3RhdHVzX0NPTVBBUklORzogJ0NvbXBhcmFpc29uJywgc3RhdHVzX1VTRVJfU0VMRUNURUQ6ICdPZmZyZSBjaG9pc2llJywgc3RhdHVzX0lOX1BST0dSRVNTOiAnRW4gY291cnMnLCBzdGF0dXNfQ09NUExFVEVEOiAnVGVybWluw6llJywgc3RhdHVzX0NBTkNFTExFRDogJ0FubnVsw6llJywgc3RhdHVzX1BFTkRJTkc6ICfDgCBjb25maXJtZXInLAogIGNoYXQ6ICdNZXNzYWdlcycsIG5vX3RocmVhZHM6ICdBdWN1bmUgY29udmVyc2F0aW9uLicsIHR5cGVfbWVzc2FnZTogJ8OJY3JpcyB1biBtZXNzYWdl4oCmJywgc2hhcmVfb2ZmZXI6ICdFbnZveWVyIGxlcyBpbmZvcyBkZSBs4oCZb2ZmcmUnLCBzZW5kX3Bob3RvOiAnUGhvdG8nLCBjaGF0X25vdGU6ICdQb3VyIHByb3TDqWdlciBjaGFjdW4sIGxlcyBudW3DqXJvcyBhcHBhcmFpc3NlbnQgYXV0b21hdGlxdWVtZW50IGFwcsOocyBjb25maXJtYXRpb24gZGUgbGEgY29tbWFuZGUuJywgb2ZmZXJfaW5mbzogJ0luZm9zIGRlIGzigJlvZmZyZScsCiAgbm90aWZpY2F0aW9uczogJ05vdGlmaWNhdGlvbnMnLCBub19ub3RpZnM6ICdBdWN1bmUgbm90aWZpY2F0aW9uLicsIG1hcmtfYWxsX3JlYWQ6ICdUb3V0IG1hcnF1ZXIgY29tbWUgbHUnLCBmYXZvcml0ZXM6ICdGYXZvcmlzJywgbm9fZmF2czogJ0F1Y3VuIGZhdm9yaSBwb3VyIGzigJlpbnN0YW50LicsCiAgcHJvZmlsZTogJ01vbiBwcm9maWwnLCBzZXR0aW5nczogJ1BhcmFtw6h0cmVzJywgbGFuZ3VhZ2U6ICdMYW5ndWUnLCBjaGFuZ2VfcGFzc3dvcmQ6ICdDaGFuZ2VyIGxlIG1vdCBkZSBwYXNzZScsIGN1cnJlbnRfcGFzc3dvcmQ6ICdNb3QgZGUgcGFzc2UgYWN0dWVsJywgbmV3X3Bhc3N3b3JkOiAnTm91dmVhdSBtb3QgZGUgcGFzc2UnLCBzYXZlZDogJ0VucmVnaXN0csOpIOKckycsIGhlbHA6ICdBaWRlIGV0IHN1cHBvcnQnLAogIGhlbHBfaW50cm86ICdDb21tZW50IHBvdXZvbnMtbm91cyB04oCZYWlkZXIgPycsIGZhcTFfcTogJ0NvbW1lbnQgZm9uY3Rpb25uZSBCbGEgU2hhcWEgPycsIGZhcTFfYTogJ1R1IMOpY3JpcyB0b24gYmVzb2luLCBs4oCZSUEgbGUgY29tcHJlbmQsIGNoZXJjaGUgY2hleiBsZXMgdmVuZGV1cnMgaW5zY3JpdHMsIGNvbXBhcmUgbGVzIG9mZnJlcyBldCBwcm9wb3NlIGxhIG1laWxsZXVyZS4gQ+KAmWVzdCB0b2kgcXVpIGNob2lzaXMuJywKICBmYXEyX3E6ICdRdWVscyBzb250IGxlcyBmcmFpcyA/JywgZmFxMl9hOiAnVW4gcGV0aXQgcG91cmNlbnRhZ2UgYWZmaWNow6kgY2xhaXJlbWVudCBhdmFudCBjb25maXJtYXRpb24gOiBwcml4IHZlbmRldXIgKyBmcmFpcyBCbGEgU2hhcWEgKyBsaXZyYWlzb24gPSBwcml4IGZpbmFsLicsCiAgZmFxM19xOiAnQ29tbWVudCBwYXllciA/JywgZmFxM19hOiAnRGFucyBjZXR0ZSB2ZXJzaW9uIDogw6AgbGEgcsOpY2VwdGlvbiBvdSBkaXJlY3RlbWVudCBhdSB2ZW5kZXVyLiBMZSBwYWllbWVudCBlbiBsaWduZSB2aWVuZHJhIHBsdXMgdGFyZC4nLAogIGZhcTRfcTogJ0zigJlJQSBpbnZlbnRlLXQtZWxsZSBkZXMgb2ZmcmVzID8nLCBmYXE0X2E6ICdOb24uIENoYXF1ZSBvZmZyZSB2aWVudCBk4oCZdW4gdmVuZGV1ciBpbnNjcml0LiBTaW5vbiwgb24gdGUgbGUgZGl0IGNsYWlyZW1lbnQuJywKICBjb21wbGFpbnQ6ICdFbnZveWVyIHVuZSByw6ljbGFtYXRpb24nLCBjb21wbGFpbnRfc3ViamVjdDogJ1N1amV0JywgY29tcGxhaW50X2JvZHk6ICdEw6l0YWlscycsIGNvbXBsYWludF9zZW50OiAnUsOpY2xhbWF0aW9uIGVudm95w6llLiBPbiB0ZSByZWNvbnRhY3RlLicsCiAgcHJvdl9kYXNoYm9hcmQ6ICdFc3BhY2UgcHJlc3RhdGFpcmUnLCBlYXJuaW5nczogJ1JldmVudXMnLCBlYXJuaW5nc18zMDogJzMwIGRlcm5pZXJzIGpvdXJzJywgcGVuZGluZ19hbW91bnQ6ICdFbiBhdHRlbnRlJywgb2ZmZXJzX3NlbnQ6ICdPZmZyZXMgZW52b3nDqWVzJywgb2ZmZXJzX3dvbjogJ09mZnJlcyByZXRlbnVlcycsIGluY29taW5nX3JlcXVlc3RzOiAnRGVtYW5kZXMgcmXDp3VlcycsIG5vX2luY29taW5nOiAnQXVjdW5lIGRlbWFuZGUgYWRhcHTDqWUgcG91ciBs4oCZaW5zdGFudC4nLAogIHNlbmRfb2ZmZXI6ICdFbnZveWVyIHVuZSBvZmZyZScsIG9mZmVyX3RpdGxlOiAnVGl0cmUgZGUgbOKAmW9mZnJlJywgb2ZmZXJfcHJpY2U6ICdQcml4IChEQSknLCBvZmZlcl9kZWxpdmVyeTogJ0xpdnJhaXNvbiAoREEpJywgb2ZmZXJfdGltZTogJ0TDqWxhaScsIG9mZmVyX2Rlc2M6ICdEw6l0YWlscycsIG9mZmVyX3NlbnQ6ICdPZmZyZSBlbnZvecOpZSDinJMnLCBteV9vZmZlcjogJ1RvbiBvZmZyZScsIHdpdGhkcmF3OiAnUmV0aXJlciBs4oCZb2ZmcmUnLAogIGN1c3RvbWVyX3JlcXVlc3Q6ICdEZW1hbmRlIGR1IGNsaWVudCcsIG9yZGVyczogJ0NvbW1hbmRlcycsIGFjY2VwdF9vcmRlcjogJ0FjY2VwdGVyJywgZGVjbGluZV9vcmRlcjogJ1JlZnVzZXInLCB5b3VyX25ldDogJ1RvbiBnYWluIG5ldCcsIGN1c3RvbWVyOiAnQ2xpZW50Jywgbm9fb3JkZXJzOiAnQXVjdW5lIGNvbW1hbmRlLicsCiAgY2F0YWxvZzogJ01vbiBjYXRhbG9ndWUnLCBhZGRfcHJvZHVjdDogJ0Fqb3V0ZXIgdW4gcHJvZHVpdCcsIGFkZF9zZXJ2aWNlOiAnQWpvdXRlciB1biBzZXJ2aWNlJywgdGl0bGU6ICdUaXRyZScsIGNhdGVnb3J5OiAnQ2F0w6lnb3JpZScsIGJyYW5kOiAnTWFycXVlJywgcHJpY2VfZnJvbTogJ1ByaXggw6AgcGFydGlyIGRlJywgcHJpY2VfdG86ICdQcml4IGp1c3F14oCZw6AnLCBwaG90b3M6ICdQaG90b3MnLCBoaWRkZW46ICdNYXNxdcOpJywKICBhd2FpdGluZ19hcHByb3ZhbDogJ1RvbiBjb21wdGUgZXN0IGVuIGNvdXJzIGRlIHbDqXJpZmljYXRpb24uJywgcmVqZWN0ZWRfYWNjb3VudDogJ1RvbiBjb21wdGUgYSDDqXTDqSByZWZ1c8OpLiBDb250YWN0ZSBsZSBzdXBwb3J0LicsIHBlbmRpbmdfbGFiZWw6ICdFbiBhdHRlbnRlJywgYXBwcm92ZWRfbGFiZWw6ICdBcHByb3V2w6knLCByZWplY3RlZF9sYWJlbDogJ1JlZnVzw6knLAogIGFkbWluOiAnQWRtaW5pc3RyYXRpb24nLCBhX292ZXJ2aWV3OiAnVnVlIGTigJllbnNlbWJsZScsIGFfdXNlcnM6ICdVdGlsaXNhdGV1cnMnLCBhX3Byb3ZpZGVyczogJ1ByZXN0YXRhaXJlcycsIGFfcmVxdWVzdHM6ICdEZW1hbmRlcycsIGFfZmFpbGVkOiAnRGVtYW5kZXMgbm9uIHLDqXNvbHVlcyBwYXIgbOKAmUlBJywgYV9vZmZlcnM6ICdPZmZyZXMnLCBhX2NhdGVnb3JpZXM6ICdDYXTDqWdvcmllcycsIGFfZmVlczogJ0ZyYWlzJywgYV9jb21wbGFpbnRzOiAnUsOpY2xhbWF0aW9ucycsIGFfcmV2aWV3czogJ0F2aXMnLCBhX2xvZ3M6ICdKb3VybmF1eCcsCiAgYXBwcm92ZTogJ0FwcHJvdXZlcicsIHJlamVjdDogJ1JlZnVzZXInLCB2ZXJpZnk6ICdWw6lyaWZpZXInLCB1bnZlcmlmeTogJ1JldGlyZXIgbGEgdsOpcmlmLicsIHN1c3BlbmQ6ICdTdXNwZW5kcmUnLCByZWFjdGl2YXRlOiAnUsOpYWN0aXZlcicsIHJlcnVuOiAnUmVsYW5jZXInLCBoaWRlOiAnTWFzcXVlcicsIHNob3c6ICdBZmZpY2hlcicsIHJlc29sdmU6ICdSw6lzb2x1JywgZGlzbWlzczogJ0lnbm9yZXInLAogIGZlZV9wZXJjZW50OiAnRnJhaXMgJScsIGZlZV9taW46ICdGcmFpcyBtaW4gKERBKScsIGZlZV9tYXg6ICdGcmFpcyBtYXggKERBKScsIGRlbGl2ZXJ5X3NhbWU6ICdMaXZyYWlzb24gbcOqbWUgd2lsYXlhIChEQSknLCBkZWxpdmVyeV9vdGhlcjogJ0xpdnJhaXNvbiBhdXRyZSB3aWxheWEgKERBKScsIHNjb3JlX3dlaWdodHM6ICdQb2lkcyBkdSBjbGFzc2VtZW50JywKICB3X3ByaWNlOiAnUHJpeCcsIHdfcmF0aW5nOiAnTm90ZScsIHdfdmVyaWZpZWQ6ICdWw6lyaWZpY2F0aW9uJywgd19jb25kaXRpb246ICfDiXRhdCcsIHdfbG9jYXRpb246ICdQcm94aW1pdMOpJywgd19kZWxpdmVyeTogJ0xpdnJhaXNvbicsCiAgc191c2VyczogJ0NsaWVudHMnLCBzX3Byb3ZpZGVyczogJ1ByZXN0YXRhaXJlcycsIHNfcGVuZGluZzogJ0VuIGF0dGVudGUnLCBzX3JlcXVlc3RzOiAnRGVtYW5kZXMnLCBzX2ZhaWxlZDogJ8OJY2hlY3MgSUEnLCBzX3N1c3BpY2lvdXM6ICdTdXNwZWN0ZXMnLCBzX29mZmVyczogJ09mZnJlcycsIHNfY29tcGxldGVkOiAnVGVybWluw6llcycsIHNfZ212OiAnVm9sdW1lJywgc19mZWVzOiAnUmV2ZW51cyBwbGF0ZWZvcm1lJywgc19jb21wbGFpbnRzOiAnUsOpY2xhbWF0aW9ucyBvdXZlcnRlcycsCiAgc3VzcGljaW91czogJ1N1c3BlY3QnLCBzZWFyY2hfdXNlcnM6ICdSZWNoZXJjaGVyIG5vbSwgZS1tYWlsLCB0w6lsw6lwaG9uZScsIGFkZF9jYXRlZ29yeTogJ0Fqb3V0ZXIgLyBtb2RpZmllciB1bmUgY2F0w6lnb3JpZScsIHNsdWc6ICdJZGVudGlmaWFudCAoc2x1ZyknLAp9Owo=", "base64") }
};

// server/http.js
var routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  }) + "$");
  routes.push({ method, re, keys, handler, opts });
}
var get = (p, h, o) => route("GET", p, h, o);
var post = (p, h, o) => route("POST", p, h, o);
var patch = (p, h, o) => route("PATCH", p, h, o);
var del = (p, h, o) => route("DELETE", p, h, o);
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json"
};
var SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  ...config.isProd ? { "Strict-Transport-Security": "max-age=15552000" } : {},
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; manifest-src 'self'; connect-src 'self'; frame-ancestors 'none'"
};
function readBody(req, limit = 2000000) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "Request too large", "too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length)
        return resolveBody({});
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Invalid JSON", "invalid_json"));
      }
    });
    req.on("error", reject);
  });
}
function currentUser(req) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  const payload = t && verifyToken(t);
  if (!payload)
    return null;
  const u = db.prepare("SELECT id,email,phone,name,role,status,wilaya_code,commune_id,locale FROM users WHERE id=?").get(payload.sub);
  return u && u.status === "active" ? u : null;
}
function serveEmbedded(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.endsWith("/"))
    rel += "index.html";
  let a = EMBEDDED[rel.replace(/^\//, "")];
  if (!a && !/\.[a-z0-9]+$/i.test(rel))
    a = EMBEDDED["index.html"];
  if (!a) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const ext = extname(a.path);
  res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" || a.path === "sw.js" ? "no-cache" : "public, max-age=300" });
  res.end(a.buf);
}
async function serveStatic(res, urlPath) {
  if (EMBEDDED && !urlPath.startsWith("/uploads/"))
    return serveEmbedded(res, urlPath);
  const publicDir = resolve3(config.root, "public");
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  let base = publicDir;
  if (rel.startsWith("/uploads/")) {
    base = config.uploadDir;
    rel = rel.slice("/uploads".length);
  }
  let file = resolve3(join(base, pnormalize(rel)));
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const st = await stat(file);
    if (st.isDirectory())
      file = join(file, "index.html");
  } catch {
    if (base === config.uploadDir) {
      res.writeHead(404);
      return res.end("Not found");
    }
    file = join(publicDir, "index.html");
  }
  try {
    const data = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300"
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}
function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    if (path === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end('{"ok":true}');
    }
    if (!path.startsWith("/api/"))
      return serveStatic(res, path);
    const send = (status, body) => {
      res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    try {
      let ip = (req.socket.remoteAddress || "ip").replace("::ffff:", "");
      if (config.trustProxy && req.headers["x-forwarded-for"])
        ip = String(req.headers["x-forwarded-for"]).split(",")[0].trim() || ip;
      if (!rateLimit(`ip:${ip}`, 300, 60))
        throw new HttpError(429, "طلبات كثيرة، حاول بعد قليل", "rate_limited");
      const r = routes.find((x) => x.method === req.method && x.re.test(path));
      if (!r) {
        if (routes.some((x) => x.re.test(path)))
          throw new HttpError(405, "Method not allowed");
        throw new HttpError(404, "Not found", "not_found");
      }
      const m = r.re.exec(path);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const user = currentUser(req);
      if (r.opts.auth !== false && !user)
        throw new HttpError(401, "يجب تسجيل الدخول", "unauthorized");
      if (r.opts.roles && !r.opts.roles.includes(user?.role))
        throw new HttpError(403, "غير مسموح", "forbidden");
      const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readBody(req, r.opts.bodyLimit) : {};
      const result = await r.handler({ req, params, query: Object.fromEntries(url.searchParams), body, user, ip });
      send(200, result ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError)
        return send(e.status, { error: e.message, code: e.code });
      console.error("[http] unhandled", e);
      log("error", "unhandled", null, { path, message: e.message });
      send(500, { error: "حدث خطأ غير متوقع", code: "server_error" });
    }
  });
  server.listen(config.port, () => console.log(`BlaShaqa running on http://localhost:${config.port}`));
  return server;
}

// scripts/seed.js
init_db();

// data/wilayas.js
var WILAYAS = [
  [1, "أدرار", "Adrar", [["أدرار", "Adrar"], ["رقان", "Reggane"], ["أولف", "Aoulef"], ["تسابيت", "Tsabit"], ["فنوغيل", "Fenoughil"]]],
  [2, "الشلف", "Chlef", [["الشلف", "Chlef"], ["تنس", "Ténès"], ["الواد الأبيض", "Oued Fodda"], ["بوقادير", "Boukadir"], ["أولاد فارس", "Oulad Fares"]]],
  [3, "الأغواط", "Laghouat", [["الأغواط", "Laghouat"], ["حاسي الرمل", "Hassi R'Mel"], ["قصر الحيران", "Ksar El Hirane"], ["بريدة", "Brida"]]],
  [4, "أم البواقي", "Oum El Bouaghi", [["أم البواقي", "Oum El Bouaghi"], ["عين البيضاء", "Aïn Beïda"], ["عين مليلة", "Aïn M'lila"], ["سيقوس", "Sigus"], ["فكيرينة", "Fkirina"]]],
  [5, "باتنة", "Batna", [["باتنة", "Batna"], ["عين التوتة", "Aïn Touta"], ["مروانة", "Merouana"], ["أريس", "Arris"], ["نقاوس", "N'gaous"], ["تازولت", "Tazoult"]]],
  [6, "بجاية", "Béjaïa", [["بجاية", "Béjaïa"], ["أقبو", "Akbou"], ["خراطة", "Kherrata"], ["سيدي عيش", "Sidi Aïch"], ["أوزلاقن", "Ouzellaguen"], ["تيشي", "Tichy"]]],
  [7, "بسكرة", "Biskra", [["بسكرة", "Biskra"], ["طولقة", "Tolga"], ["سيدي عقبة", "Sidi Okba"], ["أورلال", "Ouled Djellal"], ["زريبة الوادي", "Zeribet El Oued"]]],
  [8, "بشار", "Béchar", [["بشار", "Béchar"], ["العبادلة", "Abadla"], ["القنادسة", "Kenadsa"], ["تاغيت", "Taghit"]]],
  [9, "البليدة", "Blida", [["البليدة", "Blida"], ["بوفاريك", "Boufarik"], ["العفرون", "Afroun"], ["الأربعاء", "Larbaâ"], ["موزاية", "Mouzaïa"], ["بوعينان", "Bouinan"], ["بني مراد", "Beni Mered"]]],
  [10, "البويرة", "Bouira", [["البويرة", "Bouira"], ["سور الغزلان", "Sour El Ghozlane"], ["الأخضرية", "Lakhdaria"], ["الهاشمية", "El Hachimia"], ["برج أخريص", "Bordj Okhriss"]]],
  [11, "تمنراست", "Tamanrasset", [["تمنراست", "Tamanrasset"], ["عين أمقل", "Aïn Amguel"], ["تازروك", "Tazrouk"], ["إدلس", "Idles"]]],
  [12, "تبسة", "Tébessa", [["تبسة", "Tébessa"], ["الشريعة", "Cheria"], ["بئر العاتر", "Bir El Ater"], ["الونزة", "El Ouenza"], ["العوينات", "El Aouinet"]]],
  [13, "تلمسان", "Tlemcen", [["تلمسان", "Tlemcen"], ["مغنية", "Maghnia"], ["الغزوات", "Ghazaouet"], ["ندرومة", "Nedroma"], ["الرمشي", "Remchi"], ["سبدو", "Sebdou"]]],
  [14, "تيارت", "Tiaret", [["تيارت", "Tiaret"], ["السوقر", "Sougueur"], ["فرندة", "Frenda"], ["مدروسة", "Medroussa"], ["مهدية", "Mahdia"]]],
  [15, "تيزي وزو", "Tizi Ouzou", [["تيزي وزو", "Tizi Ouzou"], ["عزازقة", "Azazga"], ["ذراع بن خدة", "Draâ Ben Khedda"], ["واضية", "Ouadhia"], ["تيقزيرت", "Tigzirt"]]],
  [16, "الجزائر", "Alger", [["الجزائر الوسطى", "Alger Centre"], ["باب الزوار", "Bab Ezzouar"], ["بئر مراد رايس", "Bir Mourad Raïs"], ["حيدرة", "Hydra"], ["الحراش", "El Harrach"], ["براقي", "Baraki"], ["الدار البيضاء", "Dar El Beïda"], ["بوزريعة", "Bouzareah"], ["الشراقة", "Chéraga"], ["درارية", "Dréria"], ["زرالدة", "Zéralda"], ["الرويبة", "Rouiba"], ["باب الواد", "Bab El Oued"], ["القبة", "El Kouba"], ["بن عكنون", "Ben Aknoun"]]],
  [17, "الجلفة", "Djelfa", [["الجلفة", "Djelfa"], ["حاسي بحبح", "Hassi Bahbah"], ["عين وسارة", "Aïn Oussera"], ["مسعد", "Messaad"], ["دار الشيوخ", "Dar Chioukh"]]],
  [18, "جيجل", "Jijel", [["جيجل", "Jijel"], ["الطاهير", "Taher"], ["الميلية", "El Milia"], ["العوانة", "El Aouana"], ["سيدي معروف", "Sidi Maârouf"]]],
  [19, "سطيف", "Sétif", [["سطيف", "Sétif"], ["العلمة", "El Eulma"], ["عين ولمان", "Aïn Oulmène"], ["عين أرنات", "Aïn Arnat"], ["بوقاعة", "Bougaa"], ["عموشة", "Amoucha"]]],
  [20, "سعيدة", "Saïda", [["سعيدة", "Saïda"], ["عين الحجر", "Aïn El Hadjar"], ["أولاد خالد", "Ouled Khaled"], ["يوب", "Youb"]]],
  [21, "سكيكدة", "Skikda", [["سكيكدة", "Skikda"], ["عزابة", "Azzaba"], ["القل", "El Harrouch"], ["الحروش", "Collo"], ["تمالوس", "Tamalous"]]],
  [22, "سيدي بلعباس", "Sidi Bel Abbès", [["سيدي بلعباس", "Sidi Bel Abbès"], ["سفيزف", "Sfisef"], ["تلاغ", "Telagh"], ["تسالة", "Tessala"], ["بن باديس", "Ben Badis"]]],
  [23, "عنابة", "Annaba", [["عنابة", "Annaba"], ["البوني", "El Bouni"], ["الحجار", "El Hadjar"], ["برحال", "Berrahal"], ["سرايدي", "Séraïdi"]]],
  [24, "قالمة", "Guelma", [["قالمة", "Guelma"], ["هيليوبوليس", "Héliopolis"], ["عين مخلوف", "Aïn Makhlouf"], ["بوشقوف", "Bouchegouf"], ["وادي الزناتي", "Oued Zenati"]]],
  [25, "قسنطينة", "Constantine", [["قسنطينة", "Constantine"], ["الخروب", "El Khroub"], ["عين السمارة", "Aïn Smara"], ["حامة بوزيان", "Hamma Bouziane"], ["ديدوش مراد", "Didouche Mourad"], ["زيغود يوسف", "Zighoud Youcef"]]],
  [26, "المدية", "Médéa", [["المدية", "Médéa"], ["البرواقية", "Berrouaghia"], ["وزرة", "Ouzera"], ["تابلاط", "Tablat"], ["بني سليمان", "Beni Slimane"], ["شلالة العذاورة", "Chellalet El Adhaoura"], ["العمارية", "El Omaria"]]],
  [27, "مستغانم", "Mostaganem", [["مستغانم", "Mostaganem"], ["عين تادلس", "Aïn Tédelès"], ["سيدي علي", "Sidi Ali"], ["خير الدين", "Khayr Eddine"], ["حاسي ماماش", "Hassi Mameche"]]],
  [28, "المسيلة", "M'Sila", [["المسيلة", "M'Sila"], ["سيدي عيسى", "Sidi Aïssa"], ["مقرة", "Magra"], ["حمام الضلعة", "Hammam Dalaâ"], ["عين الملح", "Aïn El Melh"]]],
  [29, "معسكر", "Mascara", [["معسكر", "Mascara"], ["سيق", "Sig"], ["محمدية", "Mohammadia"], ["تيغنيف", "Tighennif"], ["بوهني", "Bou Hanifia"]]],
  [30, "ورقلة", "Ouargla", [["ورقلة", "Ouargla"], ["حاسي مسعود", "Hassi Messaoud"], ["روسات", "Rouissat"], ["سيدي خويلد", "Sidi Khouiled"], ["النزلة", "N'goussa"]]],
  [31, "وهران", "Oran", [["وهران", "Oran"], ["بئر الجير", "Bir El Djir"], ["السانية", "Es Senia"], ["عين الترك", "Aïn El Turck"], ["أرزيو", "Arzew"], ["وادي تليلات", "Oued Tlelat"], ["سيدي الشحمي", "Sidi Chami"]]],
  [32, "البيض", "El Bayadh", [["البيض", "El Bayadh"], ["بوقطب", "Bougtob"], ["بريزينة", "Brezina"], ["الأبيض سيدي الشيخ", "El Abiodh Sidi Cheikh"]]],
  [33, "إليزي", "Illizi", [["إليزي", "Illizi"], ["دبداب", "Debdeb"], ["عين أمناس", "In Amenas"]]],
  [34, "برج بوعريريج", "Bordj Bou Arréridj", [["برج بوعريريج", "Bordj Bou Arréridj"], ["رأس الوادي", "Ras El Oued"], ["برج الغدير", "Bordj Ghdir"], ["المنصورة", "El Mansoura"], ["مجانة", "Medjana"]]],
  [35, "بومرداس", "Boumerdès", [["بومرداس", "Boumerdès"], ["برج منايل", "Bordj Menaïel"], ["دلس", "Dellys"], ["بودواو", "Boudouaou"], ["الثنية", "Thenia"], ["خميس الخشنة", "Khemis El Khechna"]]],
  [36, "الطارف", "El Tarf", [["الطارف", "El Tarf"], ["القالة", "El Kala"], ["بوحجار", "Bouhadjar"], ["بن مهيدي", "Ben M'Hidi"]]],
  [37, "تندوف", "Tindouf", [["تندوف", "Tindouf"], ["أم العسل", "Oum El Assel"]]],
  [38, "تيسمسيلت", "Tissemsilt", [["تيسمسيلت", "Tissemsilt"], ["ثنية الحد", "Theniet El Had"], ["برج بونعامة", "Bordj Bounaama"], ["خميستي", "Khemisti"]]],
  [39, "الوادي", "El Oued", [["الوادي", "El Oued"], ["قمار", "Guemar"], ["الرباح", "Robbah"], ["الدبيلة", "Debila"], ["الرقيبة", "Reguiba"]]],
  [40, "خنشلة", "Khenchela", [["خنشلة", "Khenchela"], ["قايس", "Kais"], ["عين الطويلة", "Aïn Touila"], ["بابار", "Babar"], ["ششار", "Chechar"]]],
  [41, "سوق أهراس", "Souk Ahras", [["سوق أهراس", "Souk Ahras"], ["سدراتة", "Sedrata"], ["المشروحة", "M'daourouch"], ["تاورة", "Taoura"]]],
  [42, "تيبازة", "Tipaza", [["تيبازة", "Tipaza"], ["القليعة", "Koléa"], ["شرشال", "Cherchell"], ["حجوط", "Hadjout"], ["بوسماعيل", "Bou Ismaïl"], ["فوكة", "Fouka"]]],
  [43, "ميلة", "Mila", [["ميلة", "Mila"], ["فرجيوة", "Ferdjioua"], ["شلغوم العيد", "Chelghoum Laïd"], ["تاجنانت", "Tadjenanet"], ["القرارم قوقة", "Grarem Gouga"]]],
  [44, "عين الدفلى", "Aïn Defla", [["عين الدفلى", "Aïn Defla"], ["خميس مليانة", "Khemis Miliana"], ["مليانة", "Miliana"], ["العطاف", "El Attaf"], ["جندل", "Djendel"]]],
  [45, "النعامة", "Naâma", [["النعامة", "Naâma"], ["مشرية", "Mecheria"], ["عين الصفراء", "Aïn Sefra"], ["عسلة", "Asla"]]],
  [46, "عين تموشنت", "Aïn Témouchent", [["عين تموشنت", "Aïn Témouchent"], ["حمام بوحجر", "Hammam Bou Hadjar"], ["بني صاف", "Beni Saf"], ["المالح", "El Malah"]]],
  [47, "غرداية", "Ghardaïa", [["غرداية", "Ghardaïa"], ["متليلي", "Metlili"], ["بريان", "Berriane"], ["القرارة", "El Guerrara"], ["بنورة", "Bounoura"]]],
  [48, "غليزان", "Relizane", [["غليزان", "Relizane"], ["وادي رهيو", "Oued Rhiou"], ["مازونة", "Mazouna"], ["عين طارق", "Aïn Tarek"], ["الحمادنة", "Hamadna"]]],
  [49, "تيميمون", "Timimoun", [["تيميمون", "Timimoun"], ["أولاد السعيد", "Ouled Saïd"], ["شروين", "Charouine"]]],
  [50, "برج باجي مختار", "Bordj Badji Mokhtar", [["برج باجي مختار", "Bordj Badji Mokhtar"], ["تيمياوين", "Timiaouine"]]],
  [51, "أولاد جلال", "Ouled Djellal", [["أولاد جلال", "Ouled Djellal"], ["سيدي خالد", "Sidi Khaled"], ["الدوسن", "Doucen"]]],
  [52, "بني عباس", "Béni Abbès", [["بني عباس", "Béni Abbès"], ["إقلي", "Igli"], ["تامترت", "Tamtert"]]],
  [53, "عين صالح", "In Salah", [["عين صالح", "In Salah"], ["فقارة الزوى", "Foggaret Ezzaouia"]]],
  [54, "عين قزام", "In Guezzam", [["عين قزام", "In Guezzam"], ["تين زواتين", "Tin Zaouatine"]]],
  [55, "تقرت", "Touggourt", [["تقرت", "Touggourt"], ["المقارين", "Megarine"], ["تماسين", "Temacine"], ["النزلة", "Nezla"]]],
  [56, "جانت", "Djanet", [["جانت", "Djanet"], ["برج الحواس", "Bordj El Haouès"]]],
  [57, "المغير", "El M'Ghair", [["المغير", "El M'Ghair"], ["سيدي خليل", "Sidi Khelil"], ["جامعة", "Djamaa"]]],
  [58, "المنيعة", "El Meniaa", [["المنيعة", "El Meniaa"], ["حاسي القارة", "Hassi El Gara"]]],
  [59, "أفلو", "Aflou", [["أفلو", "Aflou"], ["قصر الحيران", "Ksar El Hirane"]]],
  [60, "العبيض سيدي الشيخ", "El Abiodh Sidi Cheikh", [["العبيض سيدي الشيخ", "El Abiodh Sidi Cheikh"], ["بوقطب", "Bougtob"]]],
  [61, "العريشة", "El Aricha", [["العريشة", "El Aricha"]]],
  [62, "القنطرة", "El Kantara", [["القنطرة", "El Kantara"], ["عين زعطوط", "Aïn Zaatout"]]],
  [63, "بريكة", "Barika", [["بريكة", "Barika"], ["عين التوتة", "Aïn Touta"]]],
  [64, "بوسعادة", "Bou Saâda", [["بوسعادة", "Bou Saâda"], ["أولاد سيدي ابراهيم", "Ouled Sidi Brahim"]]],
  [65, "بئر العاتر", "Bir El Ater", [["بئر العاتر", "Bir El Ater"]]],
  [66, "قصر البخاري", "Ksar El Boukhari", [["قصر البخاري", "Ksar El Boukhari"]]],
  [67, "قصر الشلالة", "Ksar Chellala", [["قصر الشلالة", "Ksar Chellala"], ["سرغين", "Serghine"]]],
  [68, "عين وسارة", "Aïn Oussara", [["عين وسارة", "Aïn Oussara"]]],
  [69, "مسعد", "Messaad", [["مسعد", "Messaad"]]]
];

// data/categories.js
var CATEGORIES = [
  [
    "cars",
    "سيارات",
    "Voitures",
    "Cars",
    "\uD83D\uDE97",
    "both",
    ["سياره", "سيارات", "كليو", "clio", "قطعه غيار", "قطع غيار", "غيار", "voiture", "auto", "pneu", "عجلات", "جنط", "بطاريه سياره", "مكانيكي", "ميكانيسيان", "تيران", "رونو", "renault", "dacia", "داسيا", "symbol", "سيمبول", "golf", "peugeot", "بيجو", "hyundai", "هيونداي", "toyota", "تويوتا", "moto", "دراجه ناريه", "car", "piece de rechange", "pièce"]
  ],
  [
    "real-estate",
    "عقار وبناء",
    "Immobilier & BTP",
    "Real estate & construction",
    "\uD83C\uDFE0",
    "both",
    ["عقار", "شقه", "فيلا", "ارض", "قطعه ارض", "محل", "كراء", "ايجار", "بيع منزل", "مقاول", "بناء", "سور", "بناي", "طلاء", "صباغه", "صباغ", "بلاط", "كارلاج", "سقف", "جبس", "plâtre", "plâtrier", "maçon", "macon", "entrepreneur", "appartement", "terrain", "location", "f3", "f4", "f2", "ترميم", "تبليط", "اسمنت"]
  ],
  [
    "electronics",
    "هواتف وإلكترونيات",
    "Téléphones & électronique",
    "Phones & electronics",
    "\uD83D\uDCF1",
    "product",
    ["هاتف", "تلفون", "تليفون", "جوال", "موبايل", "ايفون", "iphone", "samsung", "سامسونج", "سامسونغ", "xiaomi", "شاومي", "redmi", "huawei", "هواوي", "oppo", "حاسوب", "لابتوب", "laptop", "pc", "اوردينتور", "ordinateur", "tablette", "تابلت", "tv", "تلفزيون", "تلفاز", "écran", "ecran", "شاشه", "ps5", "playstation", "بلايستيشن", "airpods", "سماعات", "écouteurs", "camera", "كاميرا", "imprimante", "طابعه", "ثلاجه", "frigo", "غسالة", "machine à laver", "مكيف", "climatiseur", "smartphone", "telephone", "téléphone", "s24", "s23", "s22"]
  ],
  [
    "repair-services",
    "خدمات وصيانة",
    "Services & maintenance",
    "Services & maintenance",
    "\uD83D\uDD27",
    "service",
    ["كهربائي", "كهرباء", "سباك", "سباكه", "plombier", "électricien", "electricien", "تصليح", "اصلاح", "صيانه", "عطل", "ميكانيسيان", "نجار", "menuisier", "حداد", "تنظيف", "نقل", "نقل اثاث", "déménagement", "demenagement", "شحن", "توصيل", "تركيب", "تكييف", "clim", "تلحيم", "دهان", "جليس", "مربيه", "حارس", "reparation", "réparation", "depannage", "dépannage", "technicien", "تقني"]
  ],
  [
    "furniture",
    "أثاث",
    "Meubles",
    "Furniture",
    "\uD83D\uDECB️",
    "product",
    ["اثاث", "كنبه", "كنب", "اريكه", "سرير", "خزانه", "طاوله", "كرسي", "مطبخ", "ديكور", "sofa", "canapé", "canape", "meuble", "lit", "armoire", "table", "chaise", "cuisine", "matelas", "فراش", "مرتبه", "زربيه", "تابيس", "ستائر", "ريدو"]
  ],
  [
    "clothing",
    "ملابس",
    "Vêtements",
    "Clothing",
    "\uD83D\uDC55",
    "product",
    ["ملابس", "قميص", "سروال", "جاكيت", "حذاء", "صباط", "سباط", "فستان", "عباءه", "قندوره", "برنوس", "veste", "robe", "chaussures", "basket", "vêtement", "vetement", "pantalon", "t-shirt", "tshirt", "جينز", "jean", "كاشير", "سترة", "معطف", "نايك", "nike", "adidas"]
  ],
  [
    "digital-services",
    "خدمات رقمية",
    "Services numériques",
    "Digital services",
    "\uD83D\uDCBB",
    "service",
    ["logo", "لوجو", "يترجم", "ترجم", "يصمم", "يبرمج", "يصور", "شعار", "تصميم", "مصمم", "design", "designer", "موقع", "site web", "website", "تطبيق", "application", "برمجه", "مبرمج", "développeur", "developpeur", "سيو", "seo", "تسويق", "marketing", "مونتاج", "montage", "فيديو", "ترجمه", "traduction", "كتابه", "community manager", "اعلان", "فيسبوك", "انستغرام", "تصوير"]
  ],
  [
    "gifts",
    "هدايا",
    "Cadeaux",
    "Gifts",
    "\uD83C\uDF81",
    "product",
    ["هديه", "هدايا", "عيد ميلاد", "cadeau", "gift", "مناسبه", "زواج", "خطوبه", "باقه ورد", "ورد", "fleurs", "شوكولا", "عطر", "parfum", "ساعه", "montre", "سوار"]
  ],
  ["other", "أخرى", "Autres", "Other", "\uD83D\uDCE6", "both", []]
];

// scripts/seed.js
init_security();
init_config();

// server/lib/geo.js
init_db();

// server/lib/text.js
var AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function normalize(s = "") {
  return String(s).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).normalize("NFKD").replace(/[ً-ٰٟـ]/g, "").replace(/[̀-ͯ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/[٫،,؛;:!?؟"“”«»()[\]{}]/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
}
var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var STOP = new Set(`نحتاج نحب نبغي نبي حاب حابه محتاج محتاجه ابحث لي عن واحد وحده واحدة في من الى الي علي على ب ل و ف او مع بدون
ابي اريد اريدها اريده نشري نشتري شراء بيع للبيع نلقى نلقاو ندير ندير لي
j ai besoin cherche je recherche un une de du des la le les pour à a au en dans et ou avec sans svp s'il vous plait
need want looking for a an the in of to with and or please
بميزانيه ميزانيه ميزانيتي سعر بسعر باقل بأقل اقل اكثر حتي تحت فوق بين دينار دج دا da dzd dinar budget max min moins plus entre
مستعمل جديد مستعمله جديده occasion neuf used new
مليح مليحه رخيص رخيصه ممتاز
قريب قريبه بالقرب`.split(/\s+/));
function tokens(s) {
  return normalize(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
}

// server/lib/geo.js
var cache = null;
function geoIndex() {
  if (cache)
    return cache;
  const wilayas = db.prepare("SELECT * FROM wilayas ORDER BY code").all();
  const communes = db.prepare("SELECT * FROM communes").all();
  const entries = [];
  const aliases = {
    16: ["العاصمه", "الجزائر العاصمه", "dz", "alger centre", "algiers"],
    31: ["wahran", "وهران"],
    25: ["قسنطينه", "constantine"],
    26: ["medea", "المديه"]
  };
  for (const w of wilayas) {
    const names = new Set([normalize(w.name_ar), normalize(w.name_fr), ...(aliases[w.code] || []).map(normalize)]);
    for (const n of names)
      entries.push({ type: "wilaya", wilaya: w.code, commune: null, name: n });
  }
  for (const c of communes) {
    const names = new Set([normalize(c.name_ar), normalize(c.name_fr)]);
    for (const n of names)
      entries.push({ type: "commune", wilaya: c.wilaya_code, commune: c.id, name: n });
  }
  entries.sort((a, b) => b.name.length - a.name.length);
  for (const e of entries) {
    const base = e.name.replace(/^al /, "").replace(/^ال/, "");
    const pre = "(?:^|\\s)(?:[بلوف]|لل|و?ب?ال)?";
    e.re = new RegExp(`${pre}(?:${escapeRe(e.name)}|${escapeRe(base)})(?=\\s|$)`, "u");
  }
  cache = { wilayas, communes, entries };
  return cache;
}
var resetGeoCache = () => {
  cache = null;
};
function findPlaces(text) {
  const { entries } = geoIndex();
  const t = ` ${normalize(text)} `.replace(/\s+/g, " ").trim();
  const found = [];
  const taken = [];
  for (const e of entries) {
    if (e.name.length < 3)
      continue;
    const m = e.re.exec(t);
    if (!m)
      continue;
    const start = m.index, end = m.index + m[0].length;
    if (taken.some(([s, en]) => start < en && end > s))
      continue;
    taken.push([start, end]);
    found.push({ ...e, start });
  }
  return found.sort((a, b) => a.start - b.start);
}
function placeLabel(wilayaCode, communeId, lang = "ar") {
  const { wilayas, communes } = geoIndex();
  const w = wilayas.find((x) => x.code === wilayaCode);
  const c = communeId ? communes.find((x) => x.id === communeId) : null;
  const k = lang === "fr" ? "name_fr" : "name_ar";
  if (c && w)
    return `${c[k]}، ${w[k]}`;
  if (c)
    return c[k];
  return w ? w[k] : "";
}

// scripts/seed.js
function seedReference() {
  db.exec("BEGIN");
  const w = db.prepare("INSERT OR REPLACE INTO wilayas(code,name_ar,name_fr) VALUES (?,?,?)");
  const hasC = db.prepare("SELECT 1 FROM communes WHERE wilaya_code=? AND name_fr=?");
  const c = db.prepare("INSERT INTO communes(wilaya_code,name_ar,name_fr) VALUES (?,?,?)");
  for (const [code, ar, fr, communes] of WILAYAS) {
    w.run(code, ar, fr);
    for (const [car, cfr] of communes)
      if (!hasC.get(code, cfr))
        c.run(code, car, cfr);
  }
  const cat = db.prepare(`INSERT INTO categories(slug,name_ar,name_fr,name_en,icon,kind,sort) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(slug) DO NOTHING`);
  CATEGORIES.forEach(([slug, ar, fr, en, icon, kind], i) => cat.run(slug, ar, fr, en, icon, kind, i));
  db.exec("COMMIT");
  if (getSetting("fee_percent") === null) {
    setSetting("fee_percent", 5);
    setSetting("fee_min", 100);
    setSetting("fee_max", 1e4);
    setSetting("delivery_same_wilaya", 400);
    setSetting("delivery_other_wilaya", 900);
    setSetting("score_weights", { price: 0.35, rating: 0.2, verified: 0.15, condition: 0.1, location: 0.15, delivery: 0.05 });
  }
  resetGeoCache();
  if (config.adminEmail && config.adminPassword) {
    const exists = db.prepare("SELECT 1 FROM users WHERE email=?").get(config.adminEmail.toLowerCase());
    if (!exists) {
      db.prepare(`INSERT INTO users(id,email,name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(uid(), config.adminEmail.toLowerCase(), "Admin", hashPassword(config.adminPassword), "admin", now(), now());
      log("info", "admin_bootstrapped");
    }
  }
}
if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  seedReference();
  if (process.argv.includes("--demo")) {
    await Promise.resolve().then(() => init_seed_demo());
    seedDemo();
  }
  console.log("Seed complete.", process.argv.includes("--demo") ? "(with demo data)" : "(reference data only)");
}

// server/routes/auth.js
init_db();
init_security();
init_db();

// server/lib/notify.js
init_db();
init_config();
function notify(userId, type, title, body = "", link = "") {
  if (!userId)
    return;
  db.prepare("INSERT INTO notifications(id,user_id,type,title,body,link,created_at) VALUES (?,?,?,?,?,?,?)").run(uid(), userId, type, title, body, link, now());
  pushFcm(userId, title, body, link).catch(() => {});
}
async function pushFcm(userId, title, body, link) {
  if (!config.fcmServerKey)
    return;
  const u = db.prepare("SELECT fcm_token FROM users WHERE id=?").get(userId);
  if (!u?.fcm_token)
    return;
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `key=${config.fcmServerKey}` },
    body: JSON.stringify({ to: u.fcm_token, notification: { title, body }, data: { link } })
  });
  if (!res.ok)
    log("warn", "fcm_failed", userId, { status: res.status });
}

// server/routes/auth.js
var publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, wilaya_code: u.wilaya_code, commune_id: u.commune_id, locale: u.locale });
get("/api/meta", () => ({
  categories: db.prepare("SELECT slug,name_ar,name_fr,name_en,icon,kind FROM categories WHERE active=1 ORDER BY sort").all(),
  wilayas: db.prepare("SELECT code,name_ar,name_fr FROM wilayas ORDER BY code").all(),
  fee: { percent: getSetting("fee_percent", 5), min: getSetting("fee_min", 100) }
}), { auth: false });
get("/api/communes", ({ query }) => {
  const w = int(query.wilaya, { min: 1, max: 99, field: "wilaya" });
  return db.prepare("SELECT id,name_ar,name_fr FROM communes WHERE wilaya_code=? ORDER BY id").all(w);
}, { auth: false });
post("/api/auth/register", ({ body, ip }) => {
  if (!rateLimit(`reg:${ip}`, 10, 3600))
    throw new HttpError(429, "محاولات تسجيل كثيرة", "rate_limited");
  const name = str(body.name, { min: 2, max: 80, field: "الاسم" });
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  if (!email && !phone)
    throw bad("أدخل البريد الإلكتروني أو رقم الهاتف", "contact_required");
  const password = str(body.password, { min: 8, max: 100, field: "كلمة السر" });
  const role = oneOf(body.role || "user", ["user", "provider"], "role");
  const wilaya = int(body.wilaya_code, { min: 1, max: 69, optional: true, field: "الولاية" });
  const commune = int(body.commune_id, { optional: true, field: "البلدية" });
  if (email && db.prepare("SELECT 1 FROM users WHERE email=?").get(email))
    throw new HttpError(409, "هذا البريد مستعمل من قبل", "email_taken");
  if (phone && db.prepare("SELECT 1 FROM users WHERE phone=?").get(phone))
    throw new HttpError(409, "رقم الهاتف مستعمل من قبل", "phone_taken");
  const id = uid();
  tx(() => {
    db.prepare(`INSERT INTO users(id,email,phone,name,password_hash,role,wilaya_code,commune_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, email, phone, name, hashPassword(password), role, wilaya, commune, now(), now());
    if (role === "provider") {
      const p = body.provider || {};
      const cats = Array.isArray(p.category_slugs) ? p.category_slugs.filter((c) => CATEGORIES.some((x) => x[0] === c)).slice(0, 8) : [];
      db.prepare(`INSERT INTO providers(id,user_id,business_name,activity,description,phone,wilaya_code,commune_id,category_slugs,working_hours,created_at,updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid(), id, str(p.business_name || name, { min: 2, max: 100, field: "اسم النشاط" }), str(p.activity || "", { max: 100 }), str(p.description || "", { max: 800 }), phone, wilaya, commune, JSON.stringify(cats), str(p.working_hours || "", { max: 120 }), now(), now());
    }
  });
  log("info", "register", id, { role });
  if (role === "provider") {
    for (const a of db.prepare("SELECT id FROM users WHERE role='admin'").all())
      notify(a.id, "status_changed", "مقدم خدمة جديد ينتظر الموافقة", name, "#/admin");
  }
  return { token: signToken({ sub: id }), user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)) };
}, { auth: false });
post("/api/auth/login", ({ body, ip }) => {
  const ident = str(body.identifier, { min: 3, max: 120, field: "identifier" }).toLowerCase();
  const password = str(body.password, { min: 1, max: 100, field: "password" });
  if (!rateLimit(`login:${ip}`, 20, 900) || !rateLimit(`login:${ident}`, 8, 900))
    throw new HttpError(429, "محاولات كثيرة، حاول بعد 15 دقيقة", "rate_limited");
  let u;
  if (ident.includes("@"))
    u = db.prepare("SELECT * FROM users WHERE email=?").get(ident);
  else {
    let ph = null;
    try {
      ph = normalizePhone(ident);
    } catch {}
    u = ph ? db.prepare("SELECT * FROM users WHERE phone=?").get(ph) : null;
  }
  const ok = u ? verifyPassword(password, u.password_hash) : (verifyPassword(password, hashPassword("x")), false);
  if (!ok) {
    log("warn", "login_failed", u?.id, { ident: ident.replace(/.(?=.{3})/g, "*") });
    throw new HttpError(401, "بيانات الدخول غير صحيحة", "bad_credentials");
  }
  if (u.status !== "active")
    throw new HttpError(403, "هذا الحساب موقوف", "suspended");
  log("info", "login", u.id);
  return { token: signToken({ sub: u.id }), user: publicUser(u) };
}, { auth: false });
get("/api/me", ({ user }) => {
  const unread = db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL").get(user.id).n;
  const provider = user.role === "provider" ? db.prepare("SELECT id,business_name,approval_status,verified FROM providers WHERE user_id=?").get(user.id) : null;
  return { user: publicUser(user), unread, provider };
});
patch("/api/me", ({ user, body }) => {
  const name = body.name !== undefined ? str(body.name, { min: 2, max: 80, field: "الاسم" }) : null;
  const wilaya = body.wilaya_code !== undefined ? int(body.wilaya_code, { min: 1, max: 69, optional: true }) : undefined;
  const commune = body.commune_id !== undefined ? int(body.commune_id, { optional: true }) : undefined;
  const locale = body.locale !== undefined ? oneOf(body.locale, ["ar-DZ", "fr-DZ", "en"], "locale") : null;
  db.prepare(`UPDATE users SET name=COALESCE(?,name), locale=COALESCE(?,locale), wilaya_code=CASE WHEN ? THEN ? ELSE wilaya_code END,
              commune_id=CASE WHEN ? THEN ? ELSE commune_id END, updated_at=? WHERE id=?`).run(name, locale, wilaya !== undefined ? 1 : 0, wilaya ?? null, commune !== undefined ? 1 : 0, commune ?? null, now(), user.id);
  return { ok: true };
});
post("/api/me/password", ({ user, body }) => {
  const u = db.prepare("SELECT password_hash FROM users WHERE id=?").get(user.id);
  if (!verifyPassword(str(body.current, { min: 1, max: 100 }), u.password_hash))
    throw new HttpError(400, "كلمة السر الحالية غير صحيحة", "bad_password");
  db.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?").run(hashPassword(str(body.next, { min: 8, max: 100, field: "كلمة السر الجديدة" })), now(), user.id);
  return { ok: true };
});
post("/api/me/fcm-token", ({ user, body }) => {
  db.prepare("UPDATE users SET fcm_token=? WHERE id=?").run(str(body.token, { min: 10, max: 400 }), user.id);
  return { ok: true };
});

// server/routes/requests.js
init_db();
init_security();

// server/agents/llm.js
init_config();
var llmAvailable = () => !!config.openaiKey;
async function chat(body, timeoutMs = 20000) {
  const ctrl = new AbortController;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openaiKey}` },
      body: JSON.stringify({ model: config.openaiModel, temperature: 0, ...body }),
      signal: ctrl.signal
    });
    if (!res.ok)
      throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } finally {
    clearTimeout(timer);
  }
}
async function llmJson({ system, user, schema, maxTokens = 500 }) {
  if (!llmAvailable())
    return null;
  const content = await chat({
    max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_schema", json_schema: schema }
  });
  return content ? JSON.parse(content) : null;
}
async function llmText({ system, user, maxTokens = 350 }) {
  if (!llmAvailable())
    return null;
  return chat({ max_tokens: maxTokens, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
}

// server/agents/parser.js
var SLUGS = CATEGORIES.map((c) => c[0]);
var KIND_BY_SLUG = Object.fromEntries(CATEGORIES.map((c) => [c[0], c[5]]));
var SERVICE_WORDS = ["يترجم", "ترجم", "يصمم", "يصلح", "يبرمج", "يصور", "كهربائي", "سباك", "مقاول", "نقل", "تصليح", "اصلاح", "صيانه", "تصميم", "مصمم", "تنظيف", "نجار", "حداد", "صباغ", "ميكانيسيان", "تركيب", "مبرمج", "ترجمه", "تصوير", "مونتاج", "plombier", "electricien", "maçon", "macon", "menuisier", "demenagement", "déménagement", "reparation", "depannage", "technicien", "designer", "logo", "عطل", "بناء", "ترميم"];
var VAGUE = new Set(["حاجه", "حاجات", "شي", "شيء", "شيي", "حاجتي", "مليحه", "مليح", "رخيص", "رخيصه", "زوينه", "زوين", "باهيه", "باهي", "واحد", "واحده", "something", "quelque", "chose", "truc", "bien", "pas", "cher", "سلعه", "منتج"]);
var NUM = "(\\d{1,3}(?:[ .,]\\d{3})+|\\d+(?:[.,]\\d+)?)";
var UNIT = "(?:\\s*)(مليون|million|m\\b|الف|الاف|ألف|k\\b|mille)?";
var CUR = "(?:\\s*)(دج|دينار|دينارا|دا|da|dzd|dinars?|د\\.ج)?";
function toNumber(raw, unit) {
  let s = raw.replace(/[ ]/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(s))
    s = s.replace(/[.,]/g, "");
  else
    s = s.replace(",", ".");
  let n = parseFloat(s);
  if (!Number.isFinite(n))
    return null;
  const u = (unit || "").toLowerCase();
  if (["مليون", "million", "m"].includes(u))
    n *= 1e6;
  else if (["الف", "الاف", "ألف", "k", "mille"].includes(u))
    n *= 1000;
  return Math.round(n);
}
function parseBudget(text) {
  const t = normalize(text).replace(/(مليون|million)\s*و\s*(\d+)\s*(الف|الاف|k)/g, (_, m, n) => String(1e6 + Number(n) * 1000)).replace(/(\d)\s+(?=\d{3}\b)/g, "$1 ");
  const money = [];
  const re = new RegExp(`${NUM}${UNIT}${CUR}`, "giu");
  let m;
  while (m = re.exec(t)) {
    const [full, raw, unit, cur] = m;
    const n = toNumber(raw, unit);
    if (n === null)
      continue;
    const before = t.slice(Math.max(0, m.index - 14), m.index);
    const hasContext = !!unit || !!cur || /(ميزانيه|ميزانيتي|سعر|باقل|اقل من|حتي|تحت|فوق|اكثر من|budget|moins de|max|entre|بين|من|ب)\s*$/.test(before);
    const looksLikeMoney = unit || cur ? n >= 100 : n >= 1000 && hasContext || n >= 1e4;
    const glued = /[a-z]$/.test(t.slice(Math.max(0, m.index - 1), m.index)) && !unit && !cur;
    if (looksLikeMoney && !glued)
      money.push({ n, index: m.index, end: m.index + full.length, before });
  }
  if (!money.length)
    return { min: null, max: null, raw: null };
  const range = t.match(new RegExp(`(?:بين|entre|من)\\s*${NUM}${UNIT}${CUR}\\s*(?:و|الي|الى|et|a|à|-)\\s*${NUM}${UNIT}${CUR}`, "iu"));
  if (range && money.length >= 2) {
    const a = money[0].n, b = money[1].n;
    return { min: Math.min(a, b), max: Math.max(a, b), raw: "range" };
  }
  const first = money[0];
  const ctx = first.before;
  if (/(اكثر من|فوق|min|plus de|على الاقل|au moins)\s*$/.test(ctx))
    return { min: first.n, max: null, raw: "min" };
  return { min: null, max: first.n, raw: "max" };
}
function parseCondition(text) {
  const t = normalize(text);
  if (/(?:^|\s)(?:ال)?(مستعمل|مستعمله|occasion|used|seconde main|second hand)(?=\s|$)/.test(t))
    return "used";
  if (/(?:^|\s)(?:ال)?(جديد|جديده|neuf|neuve|new|brand new|sous emballage|scelle)(?=\s|$)/.test(t))
    return "new";
  return null;
}
function guessCategory(text) {
  const t = ` ${normalize(text)} `;
  let best = { slug: null, score: 0 };
  for (const [slug, , , , , , kws] of CATEGORIES) {
    let score = 0;
    for (const kw of kws) {
      const k = normalize(kw);
      if (!k)
        continue;
      const re = new RegExp(`(?:^|\\s)(?:[بلوف]|لل|و?ب?ال)?${escapeRe(k)}(?=\\s|$)`, "u");
      if (re.test(t))
        score += k.length >= 5 ? 2 : 1;
    }
    if (score > best.score)
      best = { slug, score };
  }
  return best.slug;
}
function guessKind(slug, text) {
  const t = normalize(text);
  if (SERVICE_WORDS.some((w) => t.includes(normalize(w))))
    return "service";
  const k = KIND_BY_SLUG[slug];
  return k === "service" ? "service" : "product";
}
function extractSubject(text, placeSpans) {
  let t = normalize(text);
  t = t.replace(new RegExp(`(?:بميزانيه|ميزانيه|بسعر|باقل من|اقل من|حتي|تحت|فوق|اكثر من|budget|moins de|entre|بين)?\\s*${NUM}${UNIT}${CUR}`, "giu"), (m) => /\d{4,}|[kK]|الف|مليون|دج|da|dzd/i.test(m) ? " " : m);
  for (const p of placeSpans)
    t = t.replace(new RegExp(`(?:[بلوف]|لل)?${escapeRe(p)}`, "u"), " ");
  const toks = tokens(t).filter((x) => !/^(في|بلدي|ولايه|ولايه|بلديه|قريب)$/.test(x));
  return toks.slice(0, 7).join(" ").trim();
}
function ruleBasedParse(rawText) {
  const text = String(rawText || "").trim();
  const places = findPlaces(text);
  const fromTo = /(?:من|de)\s+.+?\s+(?:الى|إلى|لي|لـ|a|à|vers)\s+/i.test(text);
  const loc = places[0] || null;
  const dest = fromTo && places[1] ? places[1] : null;
  const { min, max } = parseBudget(text);
  const condition = parseCondition(text);
  const category = guessCategory(text);
  const kind = guessKind(category, text);
  const subject = extractSubject(text, places.map((p) => p.name));
  const requirements = [];
  if (dest)
    requirements.push(`destination:${placeLabel(dest.wilaya, dest.commune)}`);
  const colors = text.match(/(أسود|اسود|أبيض|ابيض|أحمر|احمر|أزرق|ازرق|أخضر|اخضر|رمادي|noir|blanc|rouge|bleu|vert|gris)/gi);
  if (colors)
    requirements.push(...new Set(colors.map((c) => `color:${normalize(c)}`)));
  const storage = text.match(/(\d{2,4})\s?(gb|go|جيجا|tb)/i);
  if (storage)
    requirements.push(`storage:${storage[1]}${/tb/i.test(storage[2]) ? "TB" : "GB"}`);
  if (/(ضمان|garantie|warranty)/i.test(text))
    requirements.push("warranty");
  if (/(توصيل|livraison|delivery)/i.test(text))
    requirements.push("delivery");
  if (/(مستعجل|urgent|اليوم|today|دابا|الآن)/i.test(text))
    requirements.push("urgent");
  const subjectTokens = subject.split(" ").filter(Boolean);
  const meaningful = subjectTokens.filter((x) => !VAGUE.has(x.replace(/^و/, "")));
  const vague = !category && meaningful.length < 1;
  const hasSubject = !vague && (subjectTokens.length >= 1 || !!category);
  const out = {
    category: category || "other",
    intent: kind === "service" ? "find_service" : "buy_product",
    kind,
    product_or_service: vague ? "" : subject,
    location: loc ? placeLabel(loc.wilaya, loc.commune) : "",
    location_wilaya: loc ? loc.wilaya : null,
    location_commune: loc ? loc.commune : null,
    budget_min: min,
    budget_max: max,
    condition: condition || "",
    requirements,
    missing_information: [],
    vague,
    engine: "rules"
  };
  out.missing_information = missingInfo(out, hasSubject);
  return out;
}
function missingInfo(p, hasSubject = true) {
  const m = [];
  if (!hasSubject || p.vague || !p.product_or_service) {
    m.push("what");
    return m;
  }
  if (p.kind === "service") {
    if (!p.location_wilaya && p.category !== "digital-services")
      m.push("location");
    return m;
  }
  if (p.budget_max == null && p.budget_min == null)
    m.push("budget");
  return m;
}
var QUESTIONS = {
  what: "أكيد \uD83D\uDC4D واش حاب تشري بالضبط؟",
  budget: "شحال الميزانية تاعك؟",
  location: "في أنهي ولاية ولا بلدية تحتاج الخدمة؟"
};
var SCHEMA = {
  name: "request_understanding",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      category: { type: "string", enum: SLUGS },
      intent: { type: "string", enum: ["buy_product", "find_service", "unclear"] },
      product_or_service: { type: "string" },
      location: { type: "string" },
      budget_min: { type: ["integer", "null"] },
      budget_max: { type: ["integer", "null"] },
      condition: { type: "string", enum: ["new", "used", ""] },
      requirements: { type: "array", items: { type: "string" } },
      missing_information: { type: "array", items: { type: "string", enum: ["what", "budget", "location"] } }
    },
    required: ["category", "intent", "product_or_service", "location", "budget_min", "budget_max", "condition", "requirements", "missing_information"]
  }
};
var SYSTEM = `You extract structured information from a customer's request written in Algerian Arabic (Darija), Arabic, French or a mix.
Rules:
- Extract only what the user actually wrote. NEVER invent products, prices, budgets, places or brands.
- Budgets are in Algerian dinars (DZD). "100 ألف"/"100k" = 100000. "مليون" = 1,000,000.
- "أقل من / حتى / تحت X" => budget_max=X. "أكثر من X" => budget_min=X. "بين X و Y" => both.
- "location" = the place where the user needs the item/service (a wilaya or commune name as written). Empty string if none.
- condition: "used" for مستعمل/occasion, "new" for جديد/neuf, otherwise "".
- If the request is too vague to search (e.g. "something good and cheap"), set intent "unclear" and missing_information ["what"].
- missing_information: list at most ONE item — the most important missing piece: "what" (nothing identifiable), "budget" (a product with no budget), or "location" (a service with no place).
- requirements: short key:value strings such as "color:black", "storage:256GB", "warranty", "urgent".
- product_or_service: short noun phrase in the user's language, without budget/location words.`;
async function llmParse(text) {
  const out = await llmJson({ system: SYSTEM, user: text, schema: SCHEMA, maxTokens: 400 });
  if (!out)
    return null;
  const places = findPlaces(out.location || "");
  const loc = places[0] || findPlaces(text)[0] || null;
  const kind = out.intent === "find_service" ? "service" : "product";
  const toInt = (v) => Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null;
  const p = {
    category: SLUGS.includes(out.category) ? out.category : "other",
    intent: out.intent,
    kind,
    product_or_service: String(out.product_or_service || "").slice(0, 120),
    location: loc ? placeLabel(loc.wilaya, loc.commune) : "",
    location_wilaya: loc ? loc.wilaya : null,
    location_commune: loc ? loc.commune : null,
    budget_min: toInt(out.budget_min),
    budget_max: toInt(out.budget_max),
    condition: out.condition || "",
    requirements: (out.requirements || []).slice(0, 12).map((r) => String(r).slice(0, 60)),
    missing_information: [],
    vague: out.intent === "unclear",
    engine: "llm"
  };
  p.missing_information = missingInfo(p, !p.vague && !!p.product_or_service);
  return p;
}
async function understandRequest(rawText, { fallbackOnly = false } = {}) {
  const rules = ruleBasedParse(rawText);
  if (fallbackOnly || !llmAvailable())
    return rules;
  try {
    const llm = await llmParse(rawText);
    if (!llm)
      return rules;
    if (rules.budget_max != null && llm.budget_max !== rules.budget_max)
      llm.budget_max = rules.budget_max;
    if (rules.budget_min != null && llm.budget_min !== rules.budget_min)
      llm.budget_min = rules.budget_min;
    if (rules.budget_max == null && rules.budget_min == null) {
      llm.budget_max = null;
      llm.budget_min = null;
    }
    if (!llm.condition && rules.condition)
      llm.condition = rules.condition;
    if (!llm.location_wilaya && rules.location_wilaya) {
      llm.location_wilaya = rules.location_wilaya;
      llm.location_commune = rules.location_commune;
      llm.location = rules.location;
    }
    llm.missing_information = missingInfo(llm, !llm.vague && !!llm.product_or_service);
    return llm;
  } catch (e) {
    console.warn("[parser] LLM failed, using rules:", e.message);
    return rules;
  }
}

// server/agents/main.js
init_db();

// server/search/index.js
init_db();
var sources = new Map;
function registerSource(name, fn) {
  sources.set(name, fn);
}
async function search(query, { limit = 12 } = {}) {
  const all = [];
  for (const [name, fn] of sources) {
    try {
      all.push(...(await fn(query)).map((c) => ({ source: name, ...c })));
    } catch (e) {
      console.warn(`[search] source ${name} failed:`, e.message);
    }
  }
  return all.sort((a, b) => b.text_score - a.text_score).slice(0, limit);
}
function textScore(q, hay) {
  const qt = tokens(q.text || "");
  if (!qt.length)
    return 0;
  const h = ` ${normalize(hay)} `;
  let hit = 0;
  for (const t of qt) {
    if (h.includes(` ${t} `) || h.includes(t))
      hit++;
  }
  return hit / qt.length;
}
registerSource("catalog", (q) => {
  const out = [];
  const widen = !!q.widen;
  const maxBudget = q.budgetMax != null ? Math.round(q.budgetMax * (widen ? 1.25 : 1)) : null;
  const wantProduct = q.kind !== "service";
  const minText = widen ? 0.25 : 0.5;
  if (wantProduct) {
    const rows = db.prepare(`
      SELECT p.*, pr.business_name, pr.approval_status, pr.wilaya_code AS pr_wilaya
      FROM products p JOIN providers pr ON pr.id = p.provider_id
      WHERE p.active=1 AND pr.approval_status='approved'
        AND (? IS NULL OR p.category_slug = ? OR ?=1)`).all(q.category || null, q.category || null, widen ? 1 : 0);
    for (const p of rows) {
      const hay = `${p.title} ${p.description || ""} ${p.brand || ""} ${Object.values(j(p.attributes, {})).join(" ")}`;
      const ts = q.text ? textScore(q, hay) : 0.4;
      if (q.text && ts < minText)
        continue;
      if (maxBudget != null && p.price > maxBudget)
        continue;
      if (q.budgetMin != null && p.price < q.budgetMin * (widen ? 0.8 : 1))
        continue;
      if (q.condition && !widen) {
        const isUsed = String(p.condition || "").startsWith("used");
        if (q.condition === "used" ? !isUsed : isUsed)
          continue;
      }
      out.push({
        item_type: "product",
        item_id: p.id,
        provider_id: p.provider_id,
        title: p.title,
        description: p.description,
        image_url: j(p.images)[0] || null,
        price: p.price,
        condition: p.condition,
        wilaya: p.wilaya_code || p.pr_wilaya,
        commune: p.commune_id,
        text_score: ts,
        created_at: p.created_at
      });
    }
  }
  if (q.kind !== "product") {
    const rows = db.prepare(`
      SELECT s.*, pr.business_name, pr.wilaya_code AS pr_wilaya
      FROM services s JOIN providers pr ON pr.id = s.provider_id
      WHERE s.active=1 AND pr.approval_status='approved'
        AND (? IS NULL OR s.category_slug = ? OR ?=1)`).all(q.category || null, q.category || null, widen ? 1 : 0);
    for (const s of rows) {
      const hay = `${s.title} ${s.description || ""}`;
      const ts = q.text ? textScore(q, hay) : 0.4;
      if (q.text && ts < (widen ? 0.2 : 0.34))
        continue;
      const w = s.wilaya_code || s.pr_wilaya;
      const covers = j(s.covers_wilayas);
      const remote = s.category_slug === "digital-services";
      if (!widen && !remote && q.wilaya && w !== q.wilaya && !covers.includes(q.wilaya))
        continue;
      if (maxBudget != null && s.price_from != null && s.price_from > maxBudget)
        continue;
      out.push({
        item_type: "service",
        item_id: s.id,
        provider_id: s.provider_id,
        title: s.title,
        description: s.description,
        image_url: j(s.images)[0] || null,
        price: s.price_from ?? s.price_to ?? 0,
        price_to: s.price_to,
        condition: null,
        wilaya: w,
        commune: s.commune_id,
        text_score: ts,
        created_at: s.created_at,
        covers_wilayas: covers
      });
    }
  }
  return out;
});

// server/agents/comparison.js
init_db();
var GRADE = { new: 1, used_excellent: 0.9, used_good: 0.75, used_fair: 0.55, used: 0.7 };
var CONDITION_LABEL = { new: "جديد", used_excellent: "مستعمل — ممتازة", used_good: "مستعمل — جيدة", used_fair: "مستعمل — مقبولة", used: "مستعمل" };
var bayes = (avg, count) => ((avg || 0) * (count || 0) + 3.5 * 3) / ((count || 0) + 3) / 5;
function compareOffers(request, offers) {
  const W = getSetting("score_weights", { price: 0.35, rating: 0.2, verified: 0.15, condition: 0.1, location: 0.15, delivery: 0.05 });
  if (!offers.length)
    return { ranked: [], best: null };
  const totals = offers.map((o) => o.price + (o.delivery_price || 0));
  const minTotal = Math.min(...totals);
  const maxDelivery = Math.max(1500, ...offers.map((o) => o.delivery_price || 0));
  const maxRating = Math.max(...offers.map((o) => o.rating_count ? o.rating_avg : 0));
  const remote = request.category === "digital-services";
  const scored = offers.map((o, i) => {
    const total = totals[i];
    const priceS = total > 0 ? minTotal / total : 1;
    const ratingS = bayes(o.rating_avg, o.rating_count);
    const verifiedS = o.verified ? 1 : 0;
    let condS = GRADE[o.condition] ?? 0.8;
    if (request.condition === "used" && o.condition === "new")
      condS = 0.8;
    if (request.condition === "new" && String(o.condition || "").startsWith("used"))
      condS *= 0.5;
    const locS = remote ? 1 : request.location_commune && o.location_commune === request.location_commune ? 1 : request.location_wilaya && o.location_wilaya === request.location_wilaya ? 0.85 : request.location_wilaya ? 0.4 : 0.8;
    const delS = 1 - Math.min(1, (o.delivery_price || 0) / maxDelivery);
    const score = 100 * (W.price * priceS + W.rating * ratingS + W.verified * verifiedS + W.condition * condS + W.location * locS + W.delivery * delS);
    const reasons = [];
    if (total === minTotal && offers.length > 1)
      reasons.push({ k: "cheapest", tone: "good", ar: "الأرخص" });
    if (o.rating_count && o.rating_avg === maxRating && offers.length > 1 && o.rating_avg >= 4)
      reasons.push({ k: "best_rated", tone: "good", ar: "الأعلى تقييماً" });
    if (o.verified)
      reasons.push({ k: "verified", tone: "good", ar: "بائع موثق" });
    else
      reasons.push({ k: "unverified", tone: "warn", ar: "غير موثق بعد" });
    if (!remote && locS === 1)
      reasons.push({ k: "nearby", tone: "good", ar: "في نفس البلدية" });
    else if (!remote && locS >= 0.85)
      reasons.push({ k: "nearby", tone: "good", ar: "في نفس الولاية" });
    if (o.condition === "used_excellent" || o.condition === "new")
      reasons.push({ k: "condition", tone: "good", ar: o.condition === "new" ? "جديد" : "حالة ممتازة" });
    if (o.rating_count >= 1 && o.rating_avg < 3.5)
      reasons.push({ k: "low_rating", tone: "warn", ar: "تقييم ضعيف" });
    if (request.budget_max != null && o.price > request.budget_max)
      reasons.push({ k: "over_budget", tone: "warn", ar: "أعلى من ميزانيتك" });
    if (!o.rating_count)
      reasons.push({ k: "new_provider", tone: "warn", ar: "بدون تقييمات بعد" });
    return { ...o, score: Math.round(score * 10) / 10, reasons };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.price - b.price);
  return { ranked, best: ranked[0] };
}

// server/agents/verification.js
init_db();
var median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function verifyOffers(request, offers) {
  const prices = offers.map((o) => o.price).filter((p) => p > 0);
  const med = prices.length >= 3 ? median(prices) : null;
  return offers.map((o) => {
    const warnings = [];
    if (med && o.price < med * 0.5)
      warnings.push("السعر أقل بكثير من باقي العروض — تأكد من التفاصيل قبل الاتفاق.");
    if (med && o.price > med * 2)
      warnings.push("السعر أعلى بكثير من باقي العروض.");
    if (!o.verified)
      warnings.push("هذا مقدم الخدمة لم يتم توثيقه بعد من طرف بلا شقى.");
    const age = (Date.now() - new Date(o.provider_created_at).getTime()) / 86400000;
    if (age < 7 && !o.rating_count)
      warnings.push("حساب جديد بدون تقييمات.");
    return { offerId: o.id, warnings };
  });
}
var ILLEGAL = /(مخدرات|حشيش|كوكايين|زطلة|قنب|اسلحه|سلاح ناري|مسدس|رشاش|جواز سفر مزور|وثائق مزوره|شهاده مزوره|بطاقات مسروقه|drogue|cannabis|cocaine|arme à feu|faux papiers|faux passeport|carte volée)/i;
var OFFSITE_PAYMENT = /(western union|moneygram|paysafe|بطاقه الدفع|ارسل لي المبلغ|حول لي|virement d.?abord)/i;
function screenRequest(rawText, parsed, userId) {
  const reasons = [];
  let block = false;
  if (ILLEGAL.test(rawText)) {
    reasons.push("illegal_item");
    block = true;
  }
  if (OFFSITE_PAYMENT.test(rawText))
    reasons.push("offsite_payment");
  if (/https?:\/\/|www\./i.test(rawText))
    reasons.push("contains_link");
  if (/0[567]\d{8}/.test(rawText.replace(/\s/g, "")))
    reasons.push("contains_phone");
  if (parsed.budget_max != null && parsed.budget_max < 200 && parsed.kind !== "service")
    reasons.push("absurd_budget");
  if (/(.)\1{7,}/.test(rawText))
    reasons.push("repeated_chars");
  const dup = db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE user_id=? AND raw_text=? AND created_at > datetime('now','-1 day')`).get(userId, rawText);
  if (dup.n >= 2)
    reasons.push("duplicate_flood");
  return { suspicious: reasons.length > 0, block, reasons };
}

// server/lib/pricing.js
init_db();
var round10 = (n) => Math.round(n / 10) * 10;
function computeFee(itemPrice) {
  const pct = getSetting("fee_percent", 5);
  const min = getSetting("fee_min", 100);
  const max = getSetting("fee_max", 1e4);
  return Math.min(max, Math.max(min, round10(itemPrice * pct / 100)));
}
function estimateDelivery(kind, itemWilaya, userWilaya) {
  if (kind === "service")
    return 0;
  if (!userWilaya || !itemWilaya)
    return getSetting("delivery_other_wilaya", 900);
  return itemWilaya === userWilaya ? getSetting("delivery_same_wilaya", 400) : getSetting("delivery_other_wilaya", 900);
}
function breakdown(itemPrice, deliveryPrice = 0) {
  const fee = computeFee(itemPrice);
  return { item_price: itemPrice, fee, delivery_price: deliveryPrice, total: itemPrice + fee + deliveryPrice };
}

// server/agents/recommendation.js
var ORD = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن"];
var fmt = (n) => Number(n).toLocaleString("en-US").replace(/,/g, ",");
var NO_RESULT_MSG = "ما لقيناش حاليا عرض مناسب، نقدروا نعاودوا البحث بمعايير أوسع.";
function templateRecommendation(request, ranked) {
  if (!ranked.length)
    return NO_RESULT_MSG;
  const best = ranked[0];
  const idx = 0;
  const why = best.reasons.filter((r) => r.tone === "good").map((r) => r.ar).slice(0, 3);
  let msg = `أفضل عرض حسب السعر + الحالة + التقييم هو العرض ${ORD[idx]}: ${best.title} من ${best.provider_name} بـ ${fmt(best.price)} دج`;
  if (why.length)
    msg += ` (${why.join("، ")})`;
  msg += ".";
  if (ranked.length > 1) {
    const cheapest = [...ranked].sort((a, b) => a.price + a.delivery_price - (b.price + b.delivery_price))[0];
    if (cheapest.id !== best.id)
      msg += ` الأرخص هو "${cheapest.title}" بـ ${fmt(cheapest.price)} دج لكن ${cheapest.reasons.find((r) => r.tone === "warn")?.ar || "ترتيبه أقل في باقي المعايير"}.`;
  }
  return msg;
}
function numbersGrounded(text, facts) {
  const nums = (text.match(/\d[\d,.]*/g) || []).map((x) => x.replace(/[,.]/g, ""));
  const hay = facts.replace(/[,.]/g, "");
  return nums.every((n) => hay.includes(n));
}
async function recommend(request, ranked) {
  const base = templateRecommendation(request, ranked);
  if (!ranked.length || !llmAvailable())
    return base;
  try {
    const facts = JSON.stringify(ranked.slice(0, 5).map((o, i) => ({
      rank: i + 1,
      title: o.title,
      provider: o.provider_name,
      price_dzd: o.price,
      delivery_dzd: o.delivery_price,
      condition: o.condition,
      rating: o.rating_avg,
      rating_count: o.rating_count,
      verified: !!o.verified,
      strengths: o.reasons.filter((r) => r.tone === "good").map((r) => r.ar)
    })));
    const out = await llmText({
      system: 'أنت مساعد في تطبيق "بلا شقى". لخّص أفضل عرض للمستخدم بالدارجة الجزائرية في جملتين على الأكثر، معتمداً فقط على الحقائق المعطاة. لا تذكر أي سعر أو رقم أو اسم غير موجود في الحقائق، ولا تخترع شيئاً.',
      user: `طلب المستخدم: ${request.raw_text}
العروض مرتبة: ${facts}`,
      maxTokens: 160
    });
    if (out && numbersGrounded(out, facts) && out.length < 500)
      return out.trim();
  } catch (e) {}
  return base;
}
function summarizeOffers(ranked) {
  if (!ranked.length)
    return NO_RESULT_MSG;
  const prices = ranked.map((o) => o.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  return `وجدنا ${ranked.length} ${ranked.length === 1 ? "عرض" : "عروض"}${min === max ? ` بسعر ${fmt(min)} دج` : ` بأسعار من ${fmt(min)} إلى ${fmt(max)} دج`}.`;
}

// server/agents/main.js
var DWELL = Number(process.env.STEP_MIN_MS ?? 700);
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var running = new Set;
function loadOffers(requestId) {
  return db.prepare(`
    SELECT o.*, pr.business_name AS provider_name, pr.verified, pr.rating_avg, pr.rating_count,
           pr.created_at AS provider_created_at, pr.wilaya_code AS provider_wilaya, pr.user_id AS provider_user_id
    FROM offers o JOIN providers pr ON pr.id = o.provider_id
    WHERE o.request_id = ? AND o.status IN ('active','selected')`).all(requestId).map((o) => ({ ...o, reasons: j(o.match_reasons) }));
}
function setStep(id, step, status = null) {
  if (status)
    db.prepare("UPDATE requests SET search_step=?, status=?, updated_at=? WHERE id=?").run(step, status, now(), id);
  else
    db.prepare("UPDATE requests SET search_step=?, updated_at=? WHERE id=?").run(step, now(), id);
}
function rescore(requestId) {
  const request = db.prepare("SELECT * FROM requests WHERE id=?").get(requestId);
  const offers = loadOffers(requestId);
  const { ranked } = compareOffers(request, offers);
  const warnings = Object.fromEntries(verifyOffers(request, offers).map((w) => [w.offerId, w.warnings]));
  const upd = db.prepare("UPDATE offers SET match_score=?, match_reasons=? WHERE id=?");
  for (const o of ranked) {
    const reasons = [...o.reasons, ...(warnings[o.id] || []).map((w) => ({ k: "warning", tone: "warn", ar: w }))];
    o.reasons = reasons;
    upd.run(o.score, JSON.stringify(reasons), o.id);
  }
  return ranked;
}
function toQuery(r, widen) {
  return {
    category: r.category,
    kind: r.kind,
    text: r.product_or_service,
    condition: r.condition || null,
    wilaya: r.location_wilaya,
    commune: r.location_commune,
    budgetMin: r.budget_min,
    budgetMax: r.budget_max,
    widen
  };
}
function runPipeline(requestId, opts = {}) {
  if (running.has(requestId))
    return;
  running.add(requestId);
  pipeline(requestId, opts).catch((e) => {
    console.error("[pipeline] failed", e);
    log("error", "pipeline_failed", null, { requestId, error: e.message });
    db.prepare("UPDATE requests SET search_step='done', ai_failed=1, ai_summary=?, updated_at=? WHERE id=?").run("حدث خطأ أثناء البحث. تم إبلاغ الفريق وسيتم التواصل معك.", now(), requestId);
  }).finally(() => running.delete(requestId));
}
async function pipeline(id, { widen = false } = {}) {
  const request = db.prepare("SELECT * FROM requests WHERE id=?").get(id);
  if (!request || ["CANCELLED", "COMPLETED", "USER_SELECTED", "IN_PROGRESS"].includes(request.status))
    return;
  setStep(id, "analyzing", "SEARCHING");
  const t0 = Date.now();
  const screen = screenRequest(request.raw_text, { ...request, budget_max: request.budget_max, kind: request.kind }, request.user_id);
  if (screen.suspicious) {
    db.prepare("UPDATE requests SET suspicious=1, suspicious_reason=? WHERE id=?").run(screen.reasons.join(","), id);
    log("warn", "suspicious_request", request.user_id, { id, reasons: screen.reasons });
  }
  if (screen.block) {
    setStep(id, "done", "NEW");
    db.prepare("UPDATE requests SET ai_failed=1, ai_summary=? WHERE id=?").run("لا يمكننا معالجة هذا الطلب. تمت إحالته للمراجعة من طرف فريق بلا شقى.", id);
    notify(request.user_id, "status_changed", `طلب #${request.number} قيد المراجعة`, "تمت إحالة طلبك للمراجعة.", `#/request/${id}`);
    return;
  }
  await sleep(Math.max(0, DWELL - (Date.now() - t0)));
  setStep(id, "searching");
  const t1 = Date.now();
  const candidates = await search(toQuery(request, widen), { limit: 8 });
  const ins = db.prepare(`INSERT OR IGNORE INTO offers(id,request_id,provider_id,source,product_id,service_id,title,description,image_url,
      price,delivery_price,estimated_time,condition,location_wilaya,location_commune,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`);
  const matchedProviders = new Set;
  for (const c of candidates) {
    ins.run(uid(), id, c.provider_id, "auto", c.item_type === "product" ? c.item_id : null, c.item_type === "service" ? c.item_id : null, c.title, c.description, c.image_url, c.price, estimateDelivery(c.item_type, c.wilaya, request.location_wilaya), null, c.condition, c.wilaya, c.commune, now());
    matchedProviders.add(c.provider_id);
  }
  const interested = db.prepare(`SELECT id, user_id, category_slugs, wilaya_code FROM providers WHERE approval_status='approved'`).all().filter((p) => matchedProviders.has(p.id) || j(p.category_slugs).includes(request.category) && (!request.location_wilaya || p.wilaya_code === request.location_wilaya)).slice(0, 40);
  for (const p of interested) {
    notify(p.user_id, "new_request", `طلب جديد #${request.number}`, request.product_or_service || request.raw_text.slice(0, 80), `#/provider/request/${id}`);
  }
  await sleep(Math.max(0, DWELL - (Date.now() - t1)));
  setStep(id, "comparing");
  const t2 = Date.now();
  rescore(id);
  await sleep(Math.max(0, DWELL - (Date.now() - t2)));
  setStep(id, "verifying");
  const t3 = Date.now();
  const ranked = loadOffers(id).sort((a, b) => b.match_score - a.match_score);
  const rec = await recommend(request, ranked.map((o) => ({ ...o, score: o.match_score })));
  await sleep(Math.max(0, DWELL - (Date.now() - t3)));
  const found = ranked.length;
  db.prepare("UPDATE requests SET ai_summary=?, ai_recommendation=?, ai_failed=?, search_step=?, status=?, updated_at=? WHERE id=?").run(summarizeOffers(ranked), found ? rec : NO_RESULT_MSG, found ? 0 : 1, "done", found ? "OFFERS_FOUND" : "SEARCHING", now(), id);
  if (found)
    notify(request.user_id, "new_offer", `وجدنا ${found} ${found === 1 ? "عرض" : "عروض"} لطلب #${request.number}`, rec.slice(0, 120), `#/request/${id}`);
  else
    notify(request.user_id, "status_changed", `طلب #${request.number}`, NO_RESULT_MSG, `#/request/${id}`);
}

// server/agents/support.js
var STATUS_AR = {
  NEW: "طلبك تسجل ونستناو نبدأو البحث",
  SEARCHING: "جاري البحث عن عروض",
  OFFERS_FOUND: "وجدنا عروض وتنتظر اختيارك",
  COMPARING: "أنت في مرحلة مقارنة العروض",
  USER_SELECTED: "اخترت عرضا وننتظر تأكيد مقدم الخدمة",
  IN_PROGRESS: "الطلب قيد التنفيذ",
  COMPLETED: "الطلب مكتمل",
  CANCELLED: "الطلب ملغى"
};
function ruleAnswer(q, request, ranked) {
  const t = normalize(q);
  const has = (...ws) => ws.some((w) => t.includes(normalize(w)));
  if (has("وين وصل", "الحاله", "حالة", "status", "statut", "وصل طلبي"))
    return `${STATUS_AR[request.status] || request.status}.`;
  if (!ranked.length)
    return NO_RESULT_MSG;
  if (has("كم عرض", "شحال من عرض", "عدد العروض", "combien"))
    return `عندك ${ranked.length} ${ranked.length === 1 ? "عرض" : "عروض"} حاليا.`;
  if (has("ارخص", "اقل سعر", "moins cher", "cheapest")) {
    const c = [...ranked].sort((a, b) => a.price + a.delivery_price - (b.price + b.delivery_price))[0];
    return `الأرخص هو "${c.title}" من ${c.provider_name} بـ ${fmt(c.price)} دج${c.delivery_price ? ` + توصيل ${fmt(c.delivery_price)} دج` : ""}.`;
  }
  if (has("احسن", "افضل", "انصح", "meilleur", "best", "recommand")) {
    const b = ranked[0];
    return `ننصحك بـ "${b.title}" من ${b.provider_name} (${fmt(b.price)} دج)${b.reasons.filter((r) => r.tone === "good").length ? " — " + b.reasons.filter((r) => r.tone === "good").map((r) => r.ar).join("، ") : ""}.`;
  }
  if (has("موثق", "موثوق", "verifie", "vérifié", "verified")) {
    const v = ranked.filter((o) => o.verified);
    return v.length ? `العروض من بائعين موثقين: ${v.map((o) => `"${o.title}" (${o.provider_name})`).join("، ")}.` : "ما عندكش حاليا عروض من بائعين موثقين.";
  }
  if (has("اقرب", "قريب", "proche", "nearest", "نفس الولايه")) {
    const n = ranked.filter((o) => o.reasons.some((r) => r.k === "nearby"));
    return n.length ? `الأقرب: "${n[0].title}" من ${n[0].provider_name}.` : "ما لقيناش عروض قريبة منك حاليا.";
  }
  if (has("توصيل", "livraison", "delivery")) {
    return ranked.map((o) => `"${o.title}": ${o.delivery_price ? fmt(o.delivery_price) + " دج" : "بدون رسوم توصيل"}`).join(" | ");
  }
  if (has("حاله", "condition", "etat", "état", "مستعمل")) {
    return ranked.map((o) => `"${o.title}": ${CONDITION_LABEL[o.condition] || "غير محدد"}`).join(" | ");
  }
  return null;
}
async function answerQuestion(question, request, ranked) {
  const quick = ruleAnswer(question, request, ranked);
  if (quick)
    return { answer: quick, engine: "rules" };
  if (llmAvailable()) {
    try {
      const facts = JSON.stringify({
        request: { text: request.raw_text, status: request.status, budget_max: request.budget_max },
        offers: ranked.map((o, i) => ({ rank: i + 1, title: o.title, provider: o.provider_name, price: o.price, delivery: o.delivery_price, condition: o.condition, rating: o.rating_avg, verified: !!o.verified }))
      });
      const out = await llmText({
        system: 'أنت مساعد دعم في تطبيق "بلا شقى". أجب بالدارجة الجزائرية بإيجاز، معتمداً فقط على البيانات المعطاة. إذا لم تكن الإجابة في البيانات قل أنك لا تعرف واقترح التواصل مع الدعم. لا تخترع أسعاراً أو عروضاً.',
        user: `البيانات: ${facts}
السؤال: ${question}`,
        maxTokens: 200
      });
      if (out)
        return { answer: out.trim(), engine: "llm" };
    } catch {}
  }
  return { answer: "ما قدرتش نلقى جواب دقيق على هذا السؤال في بيانات طلبك. تقدر تسأل مقدم الخدمة مباشرة في الدردشة، أو تتواصل مع الدعم.", engine: "rules" };
}

// server/routes/requests.js
var SLUGS2 = CATEGORIES.map((c) => c[0]);
function requestView(r) {
  return {
    id: r.id,
    number: r.number,
    raw_text: r.raw_text,
    category: r.category,
    intent: r.intent,
    kind: r.kind,
    product_or_service: r.product_or_service,
    location_wilaya: r.location_wilaya,
    location_commune: r.location_commune,
    location_label: placeLabel(r.location_wilaya, r.location_commune),
    budget_min: r.budget_min,
    budget_max: r.budget_max,
    condition: r.condition,
    requirements: j(r.requirements),
    status: r.status,
    search_step: r.search_step,
    ai_summary: r.ai_summary,
    ai_recommendation: r.ai_recommendation,
    ai_failed: !!r.ai_failed,
    suspicious: !!r.suspicious,
    selected_offer_id: r.selected_offer_id,
    created_at: r.created_at,
    updated_at: r.updated_at
  };
}
function offerView(o) {
  const reasons = j(o.match_reasons ?? JSON.stringify(o.reasons || []));
  return {
    id: o.id,
    request_id: o.request_id,
    source: o.source,
    title: o.title,
    description: o.description,
    image_url: o.image_url,
    price: o.price,
    delivery_price: o.delivery_price,
    estimated_time: o.estimated_time,
    condition: o.condition,
    condition_label: CONDITION_LABEL[o.condition] || null,
    location_label: placeLabel(o.location_wilaya, o.location_commune),
    provider: { id: o.provider_id, name: o.provider_name, verified: !!o.verified, rating_avg: o.rating_avg, rating_count: o.rating_count },
    score: o.match_score,
    strengths: reasons.filter((r) => r.tone === "good").map((r) => r.ar),
    warnings: reasons.filter((r) => r.tone === "warn").map((r) => r.ar),
    status: o.status,
    created_at: o.created_at,
    breakdown: breakdown(o.price, o.delivery_price || 0)
  };
}
function ownRequest(id, user) {
  const r = db.prepare("SELECT * FROM requests WHERE id=?").get(id);
  if (!r || r.user_id !== user.id && user.role !== "admin")
    throw new HttpError(404, "الطلب غير موجود", "not_found");
  return r;
}
var ownerOnly = (r, user) => {
  if (r.user_id !== user.id)
    throw new HttpError(403, "غير مسموح", "forbidden");
};
post("/api/requests/parse", async ({ user, body }) => {
  if (!rateLimit(`parse:${user.id}`, 60, 3600))
    throw new HttpError(429, "محاولات كثيرة، حاول لاحقا", "rate_limited");
  const text = str(body.text, { min: 2, max: 600, field: "الطلب" });
  const previous = body.previous ? str(body.previous, { max: 600 }) : "";
  const combined = previous ? `${previous} ${text}` : text;
  if (looksSpammy(combined))
    throw bad("الطلب يحتوي على محتوى غير مقبول (روابط أو تكرار)", "spam");
  const u = await understandRequest(combined);
  const question = u.missing_information[0] ? QUESTIONS[u.missing_information[0]] : null;
  return { understanding: u, question, combined_text: combined };
});
post("/api/requests", ({ user, body }) => {
  if (!rateLimit(`req:${user.id}`, 20, 86400))
    throw new HttpError(429, "وصلت للحد اليومي للطلبات", "rate_limited");
  const raw = str(body.raw_text, { min: 3, max: 600, field: "الطلب" });
  if (looksSpammy(raw))
    throw bad("الطلب يحتوي على محتوى غير مقبول (روابط أو تكرار)", "spam");
  return understandRequest(raw).then((parsed) => {
    const f = body.fields || {};
    const category = f.category !== undefined ? oneOf(f.category, SLUGS2, "category") : parsed.category;
    const kind = f.kind !== undefined ? oneOf(f.kind, ["product", "service"], "kind") : parsed.kind;
    const subject = f.product_or_service !== undefined ? str(f.product_or_service, { max: 120 }) : parsed.product_or_service;
    const wilaya = f.location_wilaya !== undefined ? int(f.location_wilaya, { min: 1, max: 69, optional: true }) : parsed.location_wilaya;
    const commune = f.location_commune !== undefined ? int(f.location_commune, { optional: true }) : parsed.location_commune;
    const bmin = f.budget_min !== undefined ? int(f.budget_min, { min: 0, max: 1e9, optional: true }) : parsed.budget_min;
    const bmax = f.budget_max !== undefined ? int(f.budget_max, { min: 0, max: 1e9, optional: true }) : parsed.budget_max;
    if (bmin != null && bmax != null && bmin > bmax)
      throw bad("الحد الأدنى للميزانية أكبر من الحد الأقصى", "budget_range");
    const condition = f.condition !== undefined ? oneOf(f.condition || "", ["", "new", "used"], "condition") : parsed.condition;
    const reqs = Array.isArray(f.requirements) ? f.requirements.slice(0, 12).map((x) => str(String(x), { max: 60 })) : parsed.requirements;
    const id = uid();
    const number = nextRequestNumber();
    db.prepare(`INSERT INTO requests(id,number,user_id,raw_text,category,intent,product_or_service,kind,location_wilaya,location_commune,location_text,
        budget_min,budget_max,condition,requirements,missing_information,status,search_step,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'NEW','idle',?,?)`).run(id, number, user.id, raw, category, parsed.intent, subject, kind, wilaya, commune, placeLabel(wilaya, commune), bmin, bmax, condition || null, JSON.stringify(reqs), JSON.stringify(parsed.missing_information), now(), now());
    log("info", "request_created", user.id, { id, number, engine: parsed.engine });
    runPipeline(id);
    return { id, number };
  });
});
get("/api/requests", ({ user }) => {
  const rows = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM offers o WHERE o.request_id=r.id AND o.status IN ('active','selected')) AS offers_count,
      (SELECT MIN(price) FROM offers o WHERE o.request_id=r.id AND o.status IN ('active','selected')) AS best_price
      FROM requests r WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 100`).all(user.id);
  return { requests: rows.map((r) => ({ ...requestView(r), offers_count: r.offers_count, best_price: r.best_price })) };
});
get("/api/requests/:id", ({ user, params }) => {
  const r = ownRequest(params.id, user);
  const offers = loadOffers(r.id).sort((a, b) => b.match_score - a.match_score).map(offerView);
  const order = db.prepare(`SELECT o.*, pr.business_name, pr.phone AS provider_phone, pr.id AS pid FROM orders o JOIN providers pr ON pr.id=o.provider_id
      WHERE o.request_id=? AND o.status!='CANCELLED' ORDER BY o.created_at DESC LIMIT 1`).get(r.id);
  let orderView = null;
  if (order) {
    const reviewed = !!db.prepare("SELECT 1 FROM reviews WHERE order_id=? AND direction='user_to_provider'").get(order.id);
    orderView = {
      id: order.id,
      status: order.status,
      offer_id: order.offer_id,
      item_price: order.item_price,
      fee: order.fee,
      delivery_price: order.delivery_price,
      total: order.total,
      payment_method: order.payment_method,
      provider: { id: order.pid, name: order.business_name },
      provider_phone: ["IN_PROGRESS", "COMPLETED"].includes(order.status) ? order.provider_phone : null,
      reviewed
    };
  }
  return { request: requestView(r), offers, order: orderView };
});
get("/api/requests/:id/progress", ({ user, params }) => {
  const r = ownRequest(params.id, user);
  const found = db.prepare("SELECT COUNT(*) n FROM offers WHERE request_id=? AND status IN ('active','selected')").get(r.id).n;
  return { status: r.status, step: r.search_step, found, ai_failed: !!r.ai_failed, summary: r.ai_summary };
});
post("/api/requests/:id/research", ({ user, params }) => {
  const r = ownRequest(params.id, user);
  ownerOnly(r, user);
  if (!["SEARCHING", "OFFERS_FOUND", "COMPARING", "NEW"].includes(r.status))
    throw bad("لا يمكن إعادة البحث في هذه الحالة", "bad_state");
  if (!rateLimit(`research:${user.id}`, 20, 3600))
    throw new HttpError(429, "محاولات كثيرة", "rate_limited");
  db.prepare("UPDATE requests SET search_step='analyzing', ai_failed=0, updated_at=? WHERE id=?").run(now(), r.id);
  runPipeline(r.id, { widen: true });
  return { ok: true };
});
post("/api/requests/:id/compare-view", ({ user, params }) => {
  const r = ownRequest(params.id, user);
  ownerOnly(r, user);
  if (r.status === "OFFERS_FOUND")
    db.prepare("UPDATE requests SET status='COMPARING', updated_at=? WHERE id=?").run(now(), r.id);
  return { ok: true };
});
post("/api/requests/:id/ask", async ({ user, params, body }) => {
  const r = ownRequest(params.id, user);
  if (!rateLimit(`ask:${user.id}`, 40, 3600))
    throw new HttpError(429, "أسئلة كثيرة، حاول لاحقا", "rate_limited");
  const q = str(body.question, { min: 2, max: 300, field: "السؤال" });
  const ranked = loadOffers(r.id).sort((a, b) => b.match_score - a.match_score);
  return answerQuestion(q, r, ranked);
});
post("/api/requests/:id/select", ({ user, params, body }) => {
  const r = ownRequest(params.id, user);
  ownerOnly(r, user);
  if (!["OFFERS_FOUND", "COMPARING", "SEARCHING"].includes(r.status))
    throw bad("لا يمكن اختيار عرض في هذه الحالة", "bad_state");
  const offer = loadOffers(r.id).find((o) => o.id === body.offer_id && o.status === "active");
  if (!offer)
    throw new HttpError(404, "العرض غير متوفر", "offer_missing");
  const method = oneOf(body.payment_method || "cash_on_delivery", ["cash_on_delivery", "direct"], "payment_method");
  const b = breakdown(offer.price, offer.delivery_price || 0);
  const orderId = uid();
  tx(() => {
    db.prepare(`INSERT INTO orders(id,request_id,offer_id,user_id,provider_id,item_price,fee,delivery_price,total,payment_method,status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?, 'PENDING', ?,?)`).run(orderId, r.id, offer.id, user.id, offer.provider_id, b.item_price, b.fee, b.delivery_price, b.total, method, now(), now());
    db.prepare("UPDATE offers SET status='selected' WHERE id=?").run(offer.id);
    db.prepare("UPDATE requests SET status='USER_SELECTED', selected_offer_id=?, updated_at=? WHERE id=?").run(offer.id, now(), r.id);
  });
  notify(offer.provider_user_id, "offer_accepted", `تم اختيار عرضك في طلب #${r.number}`, `${offer.title} — ${b.item_price} دج. أكد الطلب لبدء التنفيذ.`, "#/provider/orders");
  return { ok: true, order_id: orderId };
});
post("/api/requests/:id/complete", ({ user, params }) => {
  const r = ownRequest(params.id, user);
  ownerOnly(r, user);
  const order = db.prepare("SELECT * FROM orders WHERE request_id=? AND status='IN_PROGRESS'").get(r.id);
  if (!order)
    throw bad("لا يوجد طلب قيد التنفيذ", "bad_state");
  tx(() => {
    db.prepare("UPDATE orders SET status='COMPLETED', updated_at=? WHERE id=?").run(now(), order.id);
    db.prepare("UPDATE requests SET status='COMPLETED', updated_at=? WHERE id=?").run(now(), r.id);
    db.prepare(`INSERT INTO transactions(id,order_id,provider_id,amount,fee,provider_net,method,status,created_at) VALUES (?,?,?,?,?,?,?, 'paid', ?)`).run(uid(), order.id, order.provider_id, order.total, order.fee, order.item_price + order.delivery_price, order.payment_method, now());
  });
  const pu = db.prepare("SELECT user_id FROM providers WHERE id=?").get(order.provider_id);
  notify(pu.user_id, "status_changed", `اكتمل طلب #${r.number}`, "قيّم العميل من لوحة الطلبات.", "#/provider/orders");
  return { ok: true };
});
post("/api/requests/:id/cancel", ({ user, params }) => {
  const r = ownRequest(params.id, user);
  ownerOnly(r, user);
  if (["COMPLETED", "CANCELLED"].includes(r.status))
    throw bad("لا يمكن إلغاء هذا الطلب", "bad_state");
  const order = db.prepare("SELECT * FROM orders WHERE request_id=? AND status IN ('PENDING','IN_PROGRESS')").get(r.id);
  tx(() => {
    if (order)
      db.prepare("UPDATE orders SET status='CANCELLED', updated_at=? WHERE id=?").run(now(), order.id);
    db.prepare("UPDATE requests SET status='CANCELLED', search_step='done', updated_at=? WHERE id=?").run(now(), r.id);
  });
  const providers = db.prepare("SELECT DISTINCT pr.user_id FROM offers o JOIN providers pr ON pr.id=o.provider_id WHERE o.request_id=? AND o.source='provider'").all(r.id);
  if (order)
    providers.push(db.prepare("SELECT user_id FROM providers WHERE id=?").get(order.provider_id));
  for (const p of new Set(providers.map((x) => x.user_id)))
    notify(p, "request_cancelled", `تم إلغاء طلب #${r.number}`, "", "#/provider");
  return { ok: true };
});

// server/routes/provider.js
init_db();
init_security();
var ROLE = { roles: ["provider"] };
var SLUGS3 = CATEGORIES.map((c) => c[0]);
var CONDITIONS = ["new", "used_excellent", "used_good", "used_fair"];
function me(user) {
  const p = db.prepare("SELECT * FROM providers WHERE user_id=?").get(user.id);
  if (!p)
    throw new HttpError(404, "حساب مقدم الخدمة غير موجود", "no_provider");
  return p;
}
function approved(user) {
  const p = me(user);
  if (p.approval_status !== "approved")
    throw new HttpError(403, "حسابك ينتظر موافقة الإدارة", "not_approved");
  return p;
}
get("/api/provider/profile", ({ user }) => {
  const p = me(user);
  return { provider: { ...p, category_slugs: j(p.category_slugs), location_label: placeLabel(p.wilaya_code, p.commune_id) } };
}, ROLE);
patch("/api/provider/profile", ({ user, body }) => {
  const p = me(user);
  const cats = Array.isArray(body.category_slugs) ? body.category_slugs.filter((c) => SLUGS3.includes(c)).slice(0, 8) : j(p.category_slugs);
  db.prepare(`UPDATE providers SET business_name=?, activity=?, description=?, working_hours=?, wilaya_code=?, commune_id=?, category_slugs=?, logo_url=?, updated_at=? WHERE id=?`).run(str(body.business_name ?? p.business_name, { min: 2, max: 100 }), str(body.activity ?? p.activity ?? "", { max: 100 }), str(body.description ?? p.description ?? "", { max: 800 }), str(body.working_hours ?? p.working_hours ?? "", { max: 120 }), body.wilaya_code !== undefined ? int(body.wilaya_code, { min: 1, max: 69, optional: true }) : p.wilaya_code, body.commune_id !== undefined ? int(body.commune_id, { optional: true }) : p.commune_id, JSON.stringify(cats), body.logo_url ?? p.logo_url, now(), p.id);
  return { ok: true };
}, ROLE);
var prodCols = (b) => ({
  title: str(b.title, { min: 2, max: 120, field: "العنوان" }),
  description: str(b.description || "", { max: 1000 }),
  category_slug: oneOf(b.category_slug, SLUGS3, "category"),
  price: int(b.price, { min: 1, max: 1e9, field: "السعر" }),
  condition: oneOf(b.condition || "new", CONDITIONS, "condition"),
  brand: str(b.brand || "", { max: 60 }),
  images: JSON.stringify(Array.isArray(b.images) ? b.images.filter((x) => typeof x === "string" && x.startsWith("/uploads/")).slice(0, 6) : [])
});
get("/api/provider/products", ({ user }) => ({ products: db.prepare("SELECT * FROM products WHERE provider_id=? ORDER BY created_at DESC").all(me(user).id).map((p) => ({ ...p, images: j(p.images) })) }), ROLE);
post("/api/provider/products", ({ user, body }) => {
  const p = approved(user);
  const c = prodCols(body);
  const id = uid();
  if (looksSpammy(c.title + " " + c.description))
    throw bad("المحتوى غير مقبول", "spam");
  db.prepare(`INSERT INTO products(id,provider_id,category_slug,title,description,price,condition,brand,images,wilaya_code,commune_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, p.id, c.category_slug, c.title, c.description, c.price, c.condition, c.brand, c.images, p.wilaya_code, p.commune_id, now(), now());
  return { id };
}, ROLE);
patch("/api/provider/products/:id", ({ user, params, body }) => {
  const p = me(user);
  const c = prodCols(body);
  const r = db.prepare(`UPDATE products SET category_slug=?,title=?,description=?,price=?,condition=?,brand=?,images=?,active=?,updated_at=? WHERE id=? AND provider_id=?`).run(c.category_slug, c.title, c.description, c.price, c.condition, c.brand, c.images, body.active === false ? 0 : 1, now(), params.id, p.id);
  if (!r.changes)
    throw new HttpError(404, "غير موجود", "not_found");
  return { ok: true };
}, ROLE);
del("/api/provider/products/:id", ({ user, params }) => {
  db.prepare("UPDATE products SET active=0 WHERE id=? AND provider_id=?").run(params.id, me(user).id);
  return { ok: true };
}, ROLE);
var svcCols = (b) => ({
  title: str(b.title, { min: 2, max: 120, field: "العنوان" }),
  description: str(b.description || "", { max: 1000 }),
  category_slug: oneOf(b.category_slug, SLUGS3, "category"),
  price_from: int(b.price_from, { min: 0, max: 1e9, optional: true }),
  price_to: int(b.price_to, { min: 0, max: 1e9, optional: true }),
  price_unit: oneOf(b.price_unit || "job", ["job", "hour", "day", "m2", "km"], "unit"),
  covers: JSON.stringify(Array.isArray(b.covers_wilayas) ? b.covers_wilayas.map(Number).filter((n) => n >= 1 && n <= 69).slice(0, 69) : [])
});
get("/api/provider/services", ({ user }) => ({ services: db.prepare("SELECT * FROM services WHERE provider_id=? ORDER BY created_at DESC").all(me(user).id).map((s) => ({ ...s, covers_wilayas: j(s.covers_wilayas) })) }), ROLE);
post("/api/provider/services", ({ user, body }) => {
  const p = approved(user);
  const c = svcCols(body);
  const id = uid();
  db.prepare(`INSERT INTO services(id,provider_id,category_slug,title,description,price_from,price_to,price_unit,wilaya_code,commune_id,covers_wilayas,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, p.id, c.category_slug, c.title, c.description, c.price_from, c.price_to, c.price_unit, p.wilaya_code, p.commune_id, c.covers, now(), now());
  return { id };
}, ROLE);
del("/api/provider/services/:id", ({ user, params }) => {
  db.prepare("UPDATE services SET active=0 WHERE id=? AND provider_id=?").run(params.id, me(user).id);
  return { ok: true };
}, ROLE);
function relevant(p, r) {
  const cats = j(p.category_slugs);
  return cats.includes(r.category) && (!r.location_wilaya || !p.wilaya_code || p.wilaya_code === r.location_wilaya || r.category === "digital-services");
}
get("/api/provider/requests", ({ user }) => {
  const p = approved(user);
  const rows = db.prepare(`SELECT r.*, (SELECT id FROM offers o WHERE o.request_id=r.id AND o.provider_id=? AND o.source='provider' AND o.status IN ('active','selected') LIMIT 1) AS my_offer_id
      FROM requests r WHERE r.status IN ('SEARCHING','OFFERS_FOUND','COMPARING') AND r.suspicious=0 ORDER BY r.created_at DESC LIMIT 200`).all(p.id);
  const mine = rows.filter((r) => relevant(p, r) || r.my_offer_id).slice(0, 60);
  return { requests: mine.map((r) => ({ ...requestView(r), raw_text: r.raw_text, my_offer_id: r.my_offer_id })) };
}, ROLE);
get("/api/provider/requests/:id", ({ user, params }) => {
  const p = approved(user);
  const r = db.prepare("SELECT * FROM requests WHERE id=?").get(params.id);
  if (!r || r.suspicious)
    throw new HttpError(404, "الطلب غير موجود", "not_found");
  const mine = db.prepare("SELECT * FROM offers WHERE request_id=? AND provider_id=? AND status IN ('active','selected')").all(r.id, p.id);
  const others = db.prepare("SELECT COUNT(*) n FROM offers WHERE request_id=? AND status IN ('active','selected')").get(r.id).n;
  return { request: requestView(r), my_offers: mine, offers_count: others };
}, ROLE);
post("/api/provider/requests/:id/offers", ({ user, params, body }) => {
  const p = approved(user);
  if (!rateLimit(`offer:${user.id}`, 60, 3600))
    throw new HttpError(429, "عروض كثيرة، حاول لاحقا", "rate_limited");
  const r = db.prepare("SELECT * FROM requests WHERE id=?").get(params.id);
  if (!r || !["SEARCHING", "OFFERS_FOUND", "COMPARING"].includes(r.status))
    throw bad("هذا الطلب لم يعد يستقبل عروضا", "closed");
  if (db.prepare("SELECT 1 FROM offers WHERE request_id=? AND provider_id=? AND source='provider' AND status='active'").get(r.id, p.id))
    throw new HttpError(409, "سبق أن أرسلت عرضا على هذا الطلب", "duplicate");
  const title = str(body.title, { min: 2, max: 120, field: "العنوان" });
  const description = str(body.description || "", { max: 1000 });
  if (looksSpammy(title + " " + description))
    throw bad("المحتوى غير مقبول (روابط أو تكرار) — التواصل يتم عبر الدردشة داخل التطبيق", "spam");
  const price = int(body.price, { min: 1, max: 1e9, field: "السعر" });
  const delivery = int(body.delivery_price ?? 0, { min: 0, max: 1e7, field: "التوصيل" });
  const condition = body.condition ? oneOf(body.condition, CONDITIONS, "condition") : null;
  const image = typeof body.image_url === "string" && body.image_url.startsWith("/uploads/") ? body.image_url : null;
  const id = uid();
  db.prepare(`INSERT INTO offers(id,request_id,provider_id,source,title,description,image_url,price,delivery_price,estimated_time,condition,location_wilaya,location_commune,status,created_at)
              VALUES (?,?,?,'provider',?,?,?,?,?,?,?,?,?, 'active', ?)`).run(id, r.id, p.id, title, description, image, price, delivery, str(body.estimated_time || "", { max: 60 }), condition, p.wilaya_code, p.commune_id, now());
  rescore(r.id);
  db.prepare("UPDATE requests SET status=CASE WHEN status='SEARCHING' THEN 'OFFERS_FOUND' ELSE status END, ai_failed=0, updated_at=? WHERE id=?").run(now(), r.id);
  notify(r.user_id, "new_offer", `عرض جديد على طلب #${r.number}`, `${p.business_name}: ${price} دج`, `#/request/${r.id}`);
  log("info", "offer_sent", user.id, { request: r.id, offer: id });
  return { id };
}, ROLE);
del("/api/provider/offers/:id", ({ user, params }) => {
  const p = approved(user);
  const o = db.prepare("SELECT * FROM offers WHERE id=? AND provider_id=? AND status='active'").get(params.id, p.id);
  if (!o)
    throw new HttpError(404, "غير موجود", "not_found");
  db.prepare("UPDATE offers SET status='withdrawn' WHERE id=?").run(o.id);
  rescore(o.request_id);
  return { ok: true };
}, ROLE);
get("/api/provider/orders", ({ user }) => {
  const p = me(user);
  const rows = db.prepare(`SELECT o.*, r.number, r.id AS request_id, r.raw_text, u.name AS customer_name, u.phone AS customer_phone, u.id AS customer_id,
        of.title AS offer_title,
        (SELECT 1 FROM reviews rv WHERE rv.order_id=o.id AND rv.direction='provider_to_user') AS reviewed
      FROM orders o JOIN requests r ON r.id=o.request_id JOIN users u ON u.id=o.user_id JOIN offers of ON of.id=o.offer_id
      WHERE o.provider_id=? ORDER BY o.created_at DESC LIMIT 100`).all(p.id);
  return { orders: rows.map((o) => ({
    id: o.id,
    request_id: o.request_id,
    number: o.number,
    status: o.status,
    offer_title: o.offer_title,
    raw_text: o.raw_text,
    customer_name: o.customer_name,
    customer_phone: ["IN_PROGRESS", "COMPLETED"].includes(o.status) ? o.customer_phone : null,
    item_price: o.item_price,
    fee: o.fee,
    delivery_price: o.delivery_price,
    total: o.total,
    payment_method: o.payment_method,
    your_net: o.item_price + o.delivery_price,
    reviewed: !!o.reviewed,
    created_at: o.created_at
  })) };
}, ROLE);
post("/api/provider/orders/:id/accept", ({ user, params }) => {
  const p = approved(user);
  const o = db.prepare("SELECT * FROM orders WHERE id=? AND provider_id=? AND status='PENDING'").get(params.id, p.id);
  if (!o)
    throw new HttpError(404, "غير موجود", "not_found");
  tx(() => {
    db.prepare("UPDATE orders SET status='IN_PROGRESS', updated_at=? WHERE id=?").run(now(), o.id);
    db.prepare("UPDATE requests SET status='IN_PROGRESS', updated_at=? WHERE id=?").run(now(), o.request_id);
  });
  const r = db.prepare("SELECT number FROM requests WHERE id=?").get(o.request_id);
  notify(o.user_id, "status_changed", `${p.business_name} أكد طلبك #${r.number}`, "الطلب الآن قيد التنفيذ. تقدر تتواصل معه.", `#/request/${o.request_id}`);
  return { ok: true };
}, ROLE);
post("/api/provider/orders/:id/decline", ({ user, params }) => {
  const p = me(user);
  const o = db.prepare("SELECT * FROM orders WHERE id=? AND provider_id=? AND status='PENDING'").get(params.id, p.id);
  if (!o)
    throw new HttpError(404, "غير موجود", "not_found");
  tx(() => {
    db.prepare("UPDATE orders SET status='CANCELLED', updated_at=? WHERE id=?").run(now(), o.id);
    db.prepare("UPDATE offers SET status='rejected' WHERE id=?").run(o.offer_id);
    const left = db.prepare("SELECT COUNT(*) n FROM offers WHERE request_id=? AND status='active'").get(o.request_id).n;
    db.prepare("UPDATE requests SET status=?, selected_offer_id=NULL, updated_at=? WHERE id=?").run(left ? "OFFERS_FOUND" : "SEARCHING", now(), o.request_id);
  });
  rescore(o.request_id);
  const r = db.prepare("SELECT number FROM requests WHERE id=?").get(o.request_id);
  notify(o.user_id, "status_changed", `العرض المختار لم يعد متاحا (طلب #${r.number})`, "اختر عرضا آخر من القائمة.", `#/request/${o.request_id}`);
  return { ok: true };
}, ROLE);
get("/api/provider/stats", ({ user }) => {
  const p = me(user);
  const t = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(provider_net),0) net, COALESCE(SUM(fee),0) fees FROM transactions WHERE provider_id=? AND status='paid'`).get(p.id);
  const pending = db.prepare(`SELECT COALESCE(SUM(item_price+delivery_price),0) s FROM orders WHERE provider_id=? AND status IN ('PENDING','IN_PROGRESS')`).get(p.id).s;
  const offers = db.prepare("SELECT COUNT(*) n FROM offers WHERE provider_id=? AND source='provider'").get(p.id).n;
  const won = db.prepare("SELECT COUNT(*) n FROM offers WHERE provider_id=? AND status='selected'").get(p.id).n;
  const month = db.prepare(`SELECT COALESCE(SUM(provider_net),0) s FROM transactions WHERE provider_id=? AND status='paid' AND created_at >= ?`).get(p.id, new Date(Date.now() - 30 * 86400000).toISOString()).s;
  return {
    completed_orders: t.n,
    earnings_total: t.net,
    earnings_30d: month,
    pending_amount: pending,
    offers_sent: offers,
    offers_won: won,
    rating_avg: p.rating_avg,
    rating_count: p.rating_count,
    approval_status: p.approval_status,
    verified: !!p.verified
  };
}, ROLE);

// server/routes/social.js
init_db();
init_security();
init_config();
import { mkdirSync as mkdirSync2, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var MAGIC = [
  { ext: "jpg", test: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255 },
  { ext: "png", test: (b) => b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 },
  { ext: "webp", test: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" }
];
post("/api/upload", ({ user, body }) => {
  if (!rateLimit(`upload:${user.id}`, 30, 3600))
    throw new HttpError(429, "صور كثيرة، حاول لاحقا", "rate_limited");
  const b64 = str(body.data, { min: 100, max: 2400000, field: "الصورة" }).replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 1800000)
    throw bad("الصورة كبيرة (الحد 1.8MB)", "too_large");
  const kind = MAGIC.find((m) => m.test(buf));
  if (!kind)
    throw bad("نوع الملف غير مدعوم (jpg / png / webp فقط)", "bad_type");
  mkdirSync2(config.uploadDir, { recursive: true });
  const name = `${uid()}.${kind.ext}`;
  writeFileSync(join2(config.uploadDir, name), buf);
  return { url: `/uploads/${name}` };
}, { bodyLimit: 3500000 });
get("/api/notifications", ({ user }) => ({
  notifications: db.prepare("SELECT id,type,title,body,link,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 60").all(user.id),
  unread: db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL").get(user.id).n
}));
post("/api/notifications/read-all", ({ user }) => {
  db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").run(now(), user.id);
  return { ok: true };
});
post("/api/notifications/:id/read", ({ user, params }) => {
  db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?").run(now(), params.id, user.id);
  return { ok: true };
});
function threadAccess(user, requestId, providerId) {
  const r = db.prepare("SELECT * FROM requests WHERE id=?").get(requestId);
  const p = db.prepare("SELECT * FROM providers WHERE id=?").get(providerId);
  if (!r || !p)
    throw new HttpError(404, "غير موجود", "not_found");
  const isCustomer = r.user_id === user.id;
  const isProvider = p.user_id === user.id;
  if (!isCustomer && !isProvider)
    throw new HttpError(403, "غير مسموح", "forbidden");
  const hasOffer = db.prepare("SELECT 1 FROM offers WHERE request_id=? AND provider_id=? AND status IN ('active','selected')").get(requestId, providerId);
  const hasOrder = db.prepare("SELECT 1 FROM orders WHERE request_id=? AND provider_id=?").get(requestId, providerId);
  if (!hasOffer && !hasOrder)
    throw new HttpError(403, "لا توجد محادثة لهذا العرض", "no_thread");
  const accepted = !!db.prepare("SELECT 1 FROM orders WHERE request_id=? AND provider_id=? AND status IN ('IN_PROGRESS','COMPLETED')").get(requestId, providerId);
  return { r, p, isCustomer, isProvider, accepted };
}
var msgView = (m, me) => ({ id: m.id, kind: m.kind, body: m.body, image_url: m.image_url, offer_id: m.offer_id, mine: m.sender_id === me, created_at: m.created_at });
get("/api/chat/:requestId/:providerId", ({ user, params }) => {
  const a = threadAccess(user, params.requestId, params.providerId);
  const msgs = db.prepare("SELECT * FROM messages WHERE request_id=? AND provider_id=? ORDER BY created_at ASC LIMIT 300").all(params.requestId, params.providerId);
  db.prepare("UPDATE messages SET read_at=? WHERE request_id=? AND provider_id=? AND sender_id!=? AND read_at IS NULL").run(now(), params.requestId, params.providerId, user.id);
  const offers = db.prepare("SELECT id,title,price,delivery_price FROM offers WHERE request_id=? AND provider_id=? AND status IN ('active','selected')").all(params.requestId, params.providerId);
  const other = a.isCustomer ? { name: a.p.business_name, verified: !!a.p.verified } : { name: db.prepare("SELECT name FROM users WHERE id=?").get(a.r.user_id).name, verified: false };
  return { messages: msgs.map((m) => msgView(m, user.id)), request: { id: a.r.id, number: a.r.number, product_or_service: a.r.product_or_service }, other, offers, contact_open: a.accepted };
});
post("/api/chat/:requestId/:providerId", ({ user, params, body }) => {
  const a = threadAccess(user, params.requestId, params.providerId);
  if (["CANCELLED", "COMPLETED"].includes(a.r.status))
    throw bad("المحادثة مغلقة لأن الطلب انتهى", "closed");
  if (!rateLimit(`chat:${user.id}`, 20, 60))
    throw new HttpError(429, "رسائل كثيرة بسرعة — انتظر قليلا", "rate_limited");
  const kind = oneOf(body.kind || "text", ["text", "image", "offer"], "kind");
  let text = null, image = null, offerId = null;
  if (kind === "text") {
    text = str(body.text, { min: 1, max: 1000, field: "الرسالة" });
    if (looksSpammy(text))
      throw bad("الرسالة تحتوي على روابط أو تكرار مشبوه", "spam");
    if (!a.accepted && /0[567][\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2}|\+?213\s?[567]/.test(text.replace(/\s{2,}/g, " ")))
      throw bad("لا يمكن مشاركة أرقام الهاتف قبل تأكيد الطلب. سيتم إظهار الرقم تلقائيا بعد التأكيد.", "phone_blocked");
    const dup = db.prepare("SELECT 1 FROM messages WHERE sender_id=? AND body=? AND created_at > ?").get(user.id, text, new Date(Date.now() - 60000).toISOString());
    if (dup)
      throw bad("رسالة مكررة", "duplicate");
  } else if (kind === "image") {
    image = String(body.image_url || "");
    if (!image.startsWith("/uploads/"))
      throw bad("صورة غير صالحة", "bad_image");
  } else {
    offerId = String(body.offer_id || "");
    if (!db.prepare("SELECT 1 FROM offers WHERE id=? AND request_id=? AND provider_id=?").get(offerId, params.requestId, params.providerId))
      throw bad("عرض غير صالح", "bad_offer");
  }
  const id = uid();
  db.prepare("INSERT INTO messages(id,request_id,provider_id,sender_id,kind,body,image_url,offer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, params.requestId, params.providerId, user.id, kind, text, image, offerId, now());
  const toUser = a.isCustomer ? a.p.user_id : a.r.user_id;
  const link = a.isCustomer ? `#/provider/chat/${params.requestId}/${params.providerId}` : `#/chat/${params.requestId}/${params.providerId}`;
  notify(toUser, "new_message", `رسالة جديدة — طلب #${a.r.number}`, kind === "text" ? text.slice(0, 80) : kind === "image" ? "\uD83D\uDCF7 صورة" : "\uD83E\uDDFE معلومات عرض", link);
  return { id };
});
get("/api/threads", ({ user }) => {
  const rows = user.role === "provider" ? db.prepare(`SELECT DISTINCT r.id AS request_id, r.number, r.product_or_service, pr.id AS provider_id, u.name AS other_name
        FROM offers o JOIN requests r ON r.id=o.request_id JOIN providers pr ON pr.id=o.provider_id JOIN users u ON u.id=r.user_id
        WHERE pr.user_id=? AND o.status IN ('active','selected') ORDER BY r.created_at DESC LIMIT 60`).all(user.id) : db.prepare(`SELECT DISTINCT r.id AS request_id, r.number, r.product_or_service, pr.id AS provider_id, pr.business_name AS other_name
        FROM offers o JOIN requests r ON r.id=o.request_id JOIN providers pr ON pr.id=o.provider_id
        WHERE r.user_id=? AND o.status IN ('active','selected') AND o.source='provider' ORDER BY r.created_at DESC LIMIT 60`).all(user.id);
  return { threads: rows.map((t) => {
    const last = db.prepare("SELECT body,kind,created_at,sender_id FROM messages WHERE request_id=? AND provider_id=? ORDER BY created_at DESC LIMIT 1").get(t.request_id, t.provider_id);
    const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE request_id=? AND provider_id=? AND sender_id!=? AND read_at IS NULL").get(t.request_id, t.provider_id, user.id).n;
    return { ...t, last: last ? last.kind === "text" ? last.body : last.kind === "image" ? "\uD83D\uDCF7 صورة" : "\uD83E\uDDFE عرض" : null, last_at: last?.created_at, unread };
  }) };
});
post("/api/orders/:id/review", ({ user, params, body }) => {
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(params.id);
  if (!o)
    throw new HttpError(404, "غير موجود", "not_found");
  if (o.status !== "COMPLETED")
    throw bad("يمكن التقييم بعد اكتمال الطلب فقط", "bad_state");
  const prov = db.prepare("SELECT * FROM providers WHERE id=?").get(o.provider_id);
  const rating = int(body.rating, { min: 1, max: 5, field: "التقييم" });
  const comment = str(body.comment || "", { max: 500 });
  if (looksSpammy(comment))
    throw bad("التعليق غير مقبول", "spam");
  let direction, targetUser, targetProvider = null;
  if (o.user_id === user.id) {
    direction = "user_to_provider";
    targetUser = prov.user_id;
    targetProvider = prov.id;
  } else if (prov.user_id === user.id) {
    direction = "provider_to_user";
    targetUser = o.user_id;
  } else
    throw new HttpError(403, "غير مسموح", "forbidden");
  if (db.prepare("SELECT 1 FROM reviews WHERE order_id=? AND direction=?").get(o.id, direction))
    throw new HttpError(409, "سبق أن قيّمت هذا الطلب", "duplicate");
  tx(() => {
    db.prepare("INSERT INTO reviews(id,order_id,author_id,target_user_id,target_provider_id,direction,rating,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(uid(), o.id, user.id, targetUser, targetProvider, direction, rating, comment, now());
    recomputeRatings(targetUser, targetProvider);
  });
  notify(targetUser, "status_changed", "تلقيت تقييما جديدا", `${"⭐".repeat(rating)} ${comment.slice(0, 60)}`, "#/");
  return { ok: true };
});
function recomputeRatings(userId, providerId) {
  const u = db.prepare("SELECT COUNT(*) n, AVG(rating) a FROM reviews WHERE target_user_id=? AND hidden=0").get(userId);
  db.prepare("UPDATE users SET rating_avg=?, rating_count=? WHERE id=?").run(u.a ? Math.round(u.a * 10) / 10 : 0, u.n, userId);
  if (providerId) {
    const p = db.prepare("SELECT COUNT(*) n, AVG(rating) a FROM reviews WHERE target_provider_id=? AND direction='user_to_provider' AND hidden=0").get(providerId);
    db.prepare("UPDATE providers SET rating_avg=?, rating_count=? WHERE id=?").run(p.a ? Math.round(p.a * 10) / 10 : 0, p.n, providerId);
  }
}
get("/api/providers/:id", ({ user, params }) => {
  const p = db.prepare("SELECT * FROM providers WHERE id=? AND approval_status='approved'").get(params.id);
  if (!p)
    throw new HttpError(404, "غير موجود", "not_found");
  const reviews = db.prepare(`SELECT rv.rating, rv.comment, rv.created_at, u.name AS author FROM reviews rv JOIN users u ON u.id=rv.author_id
      WHERE rv.target_provider_id=? AND rv.direction='user_to_provider' AND rv.hidden=0 ORDER BY rv.created_at DESC LIMIT 20`).all(p.id);
  const products = db.prepare("SELECT id,title,price,condition,images FROM products WHERE provider_id=? AND active=1 ORDER BY created_at DESC LIMIT 12").all(p.id).map((x) => ({ ...x, images: j(x.images) }));
  const services = db.prepare("SELECT id,title,price_from,price_to,price_unit FROM services WHERE provider_id=? AND active=1 ORDER BY created_at DESC LIMIT 12").all(p.id);
  const done = db.prepare("SELECT COUNT(*) n FROM orders WHERE provider_id=? AND status='COMPLETED'").get(p.id).n;
  const fav = !!db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND provider_id=?").get(user.id, p.id);
  return {
    provider: {
      id: p.id,
      name: p.business_name,
      activity: p.activity,
      description: p.description,
      working_hours: p.working_hours,
      verified: !!p.verified,
      rating_avg: p.rating_avg,
      rating_count: p.rating_count,
      location_label: placeLabel(p.wilaya_code, p.commune_id),
      categories: j(p.category_slugs),
      member_since: p.created_at,
      completed_orders: done
    },
    reviews,
    products,
    services,
    favorite: fav
  };
});
get("/api/favorites", ({ user }) => ({ favorites: db.prepare(`SELECT pr.id, pr.business_name AS name, pr.verified, pr.rating_avg, pr.rating_count, pr.activity, pr.wilaya_code, pr.commune_id
    FROM favorites f JOIN providers pr ON pr.id=f.provider_id WHERE f.user_id=? ORDER BY f.created_at DESC`).all(user.id).map((p) => ({ ...p, verified: !!p.verified, location_label: placeLabel(p.wilaya_code, p.commune_id) })) }));
post("/api/favorites/:providerId", ({ user, params }) => {
  if (!db.prepare("SELECT 1 FROM providers WHERE id=?").get(params.providerId))
    throw new HttpError(404, "غير موجود", "not_found");
  db.prepare("INSERT OR IGNORE INTO favorites(user_id,provider_id,created_at) VALUES (?,?,?)").run(user.id, params.providerId, now());
  return { ok: true };
});
del("/api/favorites/:providerId", ({ user, params }) => {
  db.prepare("DELETE FROM favorites WHERE user_id=? AND provider_id=?").run(user.id, params.providerId);
  return { ok: true };
});
post("/api/complaints", ({ user, body }) => {
  if (!rateLimit(`complaint:${user.id}`, 5, 3600))
    throw new HttpError(429, "شكاوى كثيرة، حاول لاحقا", "rate_limited");
  const id = uid();
  db.prepare("INSERT INTO complaints(id,user_id,request_id,provider_id,subject,body,created_at) VALUES (?,?,?,?,?,?,?)").run(id, user.id, body.request_id || null, body.provider_id || null, str(body.subject, { min: 3, max: 120, field: "الموضوع" }), str(body.body || "", { max: 1500 }), now());
  for (const a of db.prepare("SELECT id FROM users WHERE role='admin'").all())
    notify(a.id, "status_changed", "شكوى جديدة", body.subject, "#/admin");
  return { id };
});

// server/routes/admin.js
init_db();
init_security();
var ADMIN = { roles: ["admin"] };
get("/api/admin/stats", () => {
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  const byStatus = db.prepare("SELECT status, COUNT(*) n FROM requests GROUP BY status").all();
  const rev = db.prepare("SELECT COALESCE(SUM(fee),0) fees, COALESCE(SUM(amount),0) gmv, COUNT(*) n FROM transactions WHERE status='paid'").get();
  return {
    users: n("SELECT COUNT(*) n FROM users WHERE role='user'"),
    providers: n("SELECT COUNT(*) n FROM providers"),
    providers_pending: n("SELECT COUNT(*) n FROM providers WHERE approval_status='pending'"),
    requests: n("SELECT COUNT(*) n FROM requests"),
    requests_failed: n("SELECT COUNT(*) n FROM requests WHERE ai_failed=1 AND status IN ('NEW','SEARCHING')"),
    requests_suspicious: n("SELECT COUNT(*) n FROM requests WHERE suspicious=1"),
    offers: n("SELECT COUNT(*) n FROM offers"),
    orders_completed: rev.n,
    gmv: rev.gmv,
    platform_fees: rev.fees,
    complaints_open: n("SELECT COUNT(*) n FROM complaints WHERE status='open'"),
    by_status: byStatus
  };
}, ADMIN);
get("/api/admin/users", ({ query }) => {
  const q = `%${(query.q || "").trim()}%`;
  return { users: db.prepare(`SELECT id,name,email,phone,role,status,wilaya_code,rating_avg,rating_count,created_at FROM users
      WHERE (name LIKE ? OR email LIKE ? OR phone LIKE ?) ORDER BY created_at DESC LIMIT 200`).all(q, q, q) };
}, ADMIN);
patch("/api/admin/users/:id", ({ user, params, body }) => {
  if (params.id === user.id)
    throw bad("لا يمكنك تعديل حسابك", "self");
  const status = oneOf(body.status, ["active", "suspended"], "status");
  db.prepare("UPDATE users SET status=?, updated_at=? WHERE id=?").run(status, now(), params.id);
  log("info", "admin_user_status", user.id, { target: params.id, status });
  return { ok: true };
}, ADMIN);
get("/api/admin/providers", ({ query }) => {
  const st = query.status && ["pending", "approved", "rejected"].includes(query.status) ? query.status : null;
  const rows = db.prepare(`SELECT pr.*, u.email, u.status AS user_status FROM providers pr JOIN users u ON u.id=pr.user_id WHERE (? IS NULL OR pr.approval_status=?) ORDER BY pr.created_at DESC LIMIT 200`).all(st, st);
  return { providers: rows.map((p) => ({ ...p, category_slugs: j(p.category_slugs), location_label: placeLabel(p.wilaya_code, p.commune_id), verified: !!p.verified })) };
}, ADMIN);
post("/api/admin/providers/:id/:action", ({ user, params }) => {
  const action = oneOf(params.action, ["approve", "reject", "verify", "unverify"], "action");
  const p = db.prepare("SELECT * FROM providers WHERE id=?").get(params.id);
  if (!p)
    throw new HttpError(404, "غير موجود", "not_found");
  if (action === "approve")
    db.prepare("UPDATE providers SET approval_status='approved', updated_at=? WHERE id=?").run(now(), p.id);
  if (action === "reject")
    db.prepare("UPDATE providers SET approval_status='rejected', verified=0, updated_at=? WHERE id=?").run(now(), p.id);
  if (action === "verify")
    db.prepare("UPDATE providers SET verified=1, approval_status='approved', updated_at=? WHERE id=?").run(now(), p.id);
  if (action === "unverify")
    db.prepare("UPDATE providers SET verified=0, updated_at=? WHERE id=?").run(now(), p.id);
  const msg = { approve: "تمت الموافقة على حسابك. تقدر الآن تستقبل الطلبات.", reject: "تم رفض حسابك. تواصل مع الدعم لمعرفة السبب.", verify: "تم توثيق حسابك ✓", unverify: "تم سحب التوثيق من حسابك." }[action];
  notify(p.user_id, "status_changed", "حالة حسابك", msg, "#/provider");
  log("info", `admin_provider_${action}`, user.id, { provider: p.id });
  return { ok: true };
}, ADMIN);
get("/api/admin/requests", ({ query }) => {
  const f = query.filter;
  const where = f === "failed" ? "r.ai_failed=1 AND r.status IN ('NEW','SEARCHING')" : f === "suspicious" ? "r.suspicious=1" : "1=1";
  const rows = db.prepare(`SELECT r.*, u.name AS user_name, (SELECT COUNT(*) FROM offers o WHERE o.request_id=r.id AND o.status IN ('active','selected')) AS offers_count
      FROM requests r JOIN users u ON u.id=r.user_id WHERE ${where} ORDER BY r.created_at DESC LIMIT 200`).all();
  return { requests: rows.map((r) => ({
    id: r.id,
    number: r.number,
    raw_text: r.raw_text,
    user_name: r.user_name,
    status: r.status,
    category: r.category,
    product_or_service: r.product_or_service,
    budget_max: r.budget_max,
    location_label: placeLabel(r.location_wilaya, r.location_commune),
    offers_count: r.offers_count,
    ai_failed: !!r.ai_failed,
    suspicious: !!r.suspicious,
    suspicious_reason: r.suspicious_reason,
    created_at: r.created_at
  })) };
}, ADMIN);
post("/api/admin/requests/:id/rerun", ({ user, params }) => {
  const r = db.prepare("SELECT * FROM requests WHERE id=?").get(params.id);
  if (!r)
    throw new HttpError(404, "غير موجود", "not_found");
  db.prepare("UPDATE requests SET suspicious=0, suspicious_reason=NULL, ai_failed=0, status='NEW', updated_at=? WHERE id=?").run(now(), r.id);
  runPipeline(r.id, { widen: true });
  return { ok: true };
}, ADMIN);
post("/api/admin/requests/:id/cancel", ({ user, params }) => {
  const r = db.prepare("SELECT * FROM requests WHERE id=?").get(params.id);
  if (!r)
    throw new HttpError(404, "غير موجود", "not_found");
  db.prepare("UPDATE requests SET status='CANCELLED', search_step='done', updated_at=? WHERE id=?").run(now(), r.id);
  notify(r.user_id, "request_cancelled", `تم إلغاء طلب #${r.number} من طرف الإدارة`, "", `#/request/${r.id}`);
  log("info", "admin_request_cancel", user.id, { id: r.id });
  return { ok: true };
}, ADMIN);
get("/api/admin/offers", () => ({ offers: db.prepare(`SELECT o.id,o.title,o.price,o.status,o.source,o.created_at,r.number,pr.business_name AS provider FROM offers o
    JOIN requests r ON r.id=o.request_id JOIN providers pr ON pr.id=o.provider_id ORDER BY o.created_at DESC LIMIT 200`).all() }), ADMIN);
get("/api/admin/categories", () => ({ categories: db.prepare("SELECT * FROM categories ORDER BY sort").all() }), ADMIN);
post("/api/admin/categories", ({ body }) => {
  const slug = str(body.slug, { min: 2, max: 40 }).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug))
    throw bad("slug غير صالح", "invalid_input");
  db.prepare(`INSERT INTO categories(slug,name_ar,name_fr,name_en,icon,kind,sort) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(slug) DO UPDATE SET name_ar=excluded.name_ar,name_fr=excluded.name_fr,name_en=excluded.name_en,icon=excluded.icon,kind=excluded.kind`).run(slug, str(body.name_ar, { min: 1, max: 60 }), str(body.name_fr, { min: 1, max: 60 }), str(body.name_en, { min: 1, max: 60 }), str(body.icon || "\uD83D\uDCE6", { max: 8 }), oneOf(body.kind || "both", ["product", "service", "both"]), int(body.sort ?? 50, { min: 0, max: 999 }));
  return { ok: true };
}, ADMIN);
patch("/api/admin/categories/:slug", ({ params, body }) => {
  db.prepare("UPDATE categories SET active=? WHERE slug=?").run(body.active ? 1 : 0, params.slug);
  return { ok: true };
}, ADMIN);
get("/api/admin/settings", () => ({
  fee_percent: getSetting("fee_percent", 5),
  fee_min: getSetting("fee_min", 100),
  fee_max: getSetting("fee_max", 1e4),
  delivery_same_wilaya: getSetting("delivery_same_wilaya", 400),
  delivery_other_wilaya: getSetting("delivery_other_wilaya", 900),
  score_weights: getSetting("score_weights", {})
}), ADMIN);
patch("/api/admin/settings", ({ user, body }) => {
  const set = (k, v) => setSetting(k, v);
  if (body.fee_percent !== undefined) {
    const v = Number(body.fee_percent);
    if (!(v >= 0 && v <= 30))
      throw bad("النسبة بين 0 و30", "invalid_input");
    set("fee_percent", v);
  }
  for (const k of ["fee_min", "fee_max", "delivery_same_wilaya", "delivery_other_wilaya"])
    if (body[k] !== undefined)
      set(k, int(body[k], { min: 0, max: 1e7, field: k }));
  if (body.score_weights) {
    const w = body.score_weights;
    const keys = ["price", "rating", "verified", "condition", "location", "delivery"];
    const clean = Object.fromEntries(keys.map((k) => [k, Math.max(0, Math.min(1, Number(w[k]) || 0))]));
    const sum = Object.values(clean).reduce((a, b) => a + b, 0) || 1;
    set("score_weights", Object.fromEntries(keys.map((k) => [k, Math.round(clean[k] / sum * 1000) / 1000])));
  }
  log("info", "admin_settings", user.id, body);
  return { ok: true };
}, ADMIN);
get("/api/admin/complaints", () => ({ complaints: db.prepare(`SELECT c.*, u.name AS user_name FROM complaints c JOIN users u ON u.id=c.user_id ORDER BY (c.status='open') DESC, c.created_at DESC LIMIT 200`).all() }), ADMIN);
patch("/api/admin/complaints/:id", ({ params, body }) => {
  db.prepare("UPDATE complaints SET status=?, admin_note=? WHERE id=?").run(oneOf(body.status, ["open", "resolved", "dismissed"]), str(body.admin_note || "", { max: 500 }), params.id);
  return { ok: true };
}, ADMIN);
get("/api/admin/reviews", () => ({ reviews: db.prepare(`SELECT rv.id, rv.rating, rv.comment, rv.hidden, rv.direction, rv.created_at, a.name AS author, t.name AS target FROM reviews rv
    JOIN users a ON a.id=rv.author_id JOIN users t ON t.id=rv.target_user_id ORDER BY rv.created_at DESC LIMIT 200`).all() }), ADMIN);
patch("/api/admin/reviews/:id", ({ params, body }) => {
  const rv = db.prepare("SELECT * FROM reviews WHERE id=?").get(params.id);
  if (!rv)
    throw new HttpError(404, "غير موجود", "not_found");
  db.prepare("UPDATE reviews SET hidden=? WHERE id=?").run(body.hidden ? 1 : 0, rv.id);
  recomputeRatings(rv.target_user_id, rv.target_provider_id);
  return { ok: true };
}, ADMIN);
get("/api/admin/logs", () => ({ logs: db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 200").all() }), ADMIN);

// server/index.js
init_db();
init_config();
seedReference();
if (config.demoSeed && !db.prepare("SELECT 1 FROM users WHERE email='demo.user@blashaqa.dz'").get()) {
  await Promise.resolve().then(() => init_seed_demo());
  seedDemo();
}
startServer();

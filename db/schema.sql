-- طرح دیتابیس تاسیسات دایان (PostgreSQL ≥ 13)
-- اجرای مجدد بی‌خطر است (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- نشست‌های ادمین؛ فقط هش توکن ذخیره می‌شود
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id                SERIAL PRIMARY KEY,
  category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  brand             TEXT NOT NULL DEFAULT '',
  sku               TEXT UNIQUE,
  short_description TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  price             BIGINT NOT NULL CHECK (price >= 0),          -- تومان
  old_price         BIGINT CHECK (old_price IS NULL OR old_price >= 0),
  track_stock       BOOLEAN NOT NULL DEFAULT FALSE,              -- اگر false موجودی نامحدود است
  stock             INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  badge             TEXT NOT NULL DEFAULT '',
  warranty          TEXT NOT NULL DEFAULT '',
  features          JSONB NOT NULL DEFAULT '[]'::jsonb,          -- ["ویژگی ۱", ...]
  specs             JSONB NOT NULL DEFAULT '[]'::jsonb,          -- [{"label":"ظرفیت","value":"۲۴ کیلووات"}]
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);
CREATE INDEX IF NOT EXISTS products_active_idx ON products (is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS product_images (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images (product_id, sort_order);

-- سفارش‌ها: بدون درگاه پرداخت؛ پرداخت پس از هماهنگی/تماس تیم فروش
CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,                            -- کد پیگیری، مثل DN48291035
  customer_name TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  province      TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  postal_code   TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  items_total   BIGINT NOT NULL CHECK (items_total >= 0),
  shipping_cost BIGINT NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  total         BIGINT NOT NULL CHECK (total >= 0),
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','confirmed','processing','shipped','delivered','cancelled')),
  admin_note    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_phone_idx ON orders (phone);

-- نام و قیمت در لحظه‌ی ثبت کپی می‌شود تا تغییر بعدی محصول، سفارش قدیمی را عوض نکند
CREATE TABLE IF NOT EXISTS order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  image      TEXT
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- درخواست استعلام قیمت / مشاوره
CREATE TABLE IF NOT EXISTS inquiries (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- پیام‌های فرم تماس
CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  topic      TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- تنظیمات سایت (اطلاعات شرکت، ارسال، ...)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

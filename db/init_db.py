#!/usr/bin/env python3
"""Initialize the ovmclo database with tables and seed data."""
import sqlite3
import hashlib
import json
import os
import time

DB_PATH = os.path.join(os.path.dirname(__file__), 'ovm.db')

def hash_password(password: str) -> str:
    salt = "ovmclo_salt_2025"
    return hashlib.sha256(f"{password}{salt}".encode()).hexdigest()

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # ── USERS ──────────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        first_name  TEXT,
        last_name   TEXT,
        phone       TEXT,
        role        TEXT DEFAULT 'customer',
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
    )''')

    # ── PRODUCTS ───────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS products (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        slug        TEXT UNIQUE NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        price       REAL NOT NULL,
        category    TEXT,
        pattern     TEXT,
        stock       INTEGER DEFAULT 100,
        tag         TEXT,
        featured    INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
    )''')

    # ── PRODUCT SIZES ──────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS product_sizes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id  INTEGER NOT NULL,
        size        TEXT NOT NULL,
        stock       INTEGER DEFAULT 20,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')

    # ── CART ───────────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS cart_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        user_id     INTEGER,
        product_id  INTEGER NOT NULL,
        size        TEXT,
        quantity    INTEGER DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')

    # ── ORDERS ─────────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS orders (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number    TEXT UNIQUE NOT NULL,
        user_id         INTEGER,
        session_id      TEXT,
        status          TEXT DEFAULT 'pending',
        subtotal        REAL,
        shipping        REAL DEFAULT 0,
        total           REAL,
        shipping_name   TEXT,
        shipping_email  TEXT,
        shipping_phone  TEXT,
        shipping_address TEXT,
        shipping_city   TEXT,
        shipping_state  TEXT,
        shipping_country TEXT DEFAULT 'Nigeria',
        payment_method  TEXT,
        payment_status  TEXT DEFAULT 'unpaid',
        notes           TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
    )''')

    # ── ORDER ITEMS ────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS order_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id    INTEGER NOT NULL,
        product_id  INTEGER NOT NULL,
        product_name TEXT,
        size        TEXT,
        quantity    INTEGER,
        unit_price  REAL,
        total_price REAL,
        FOREIGN KEY(order_id) REFERENCES orders(id)
    )''')

    # ── NEWSLETTER ─────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS newsletter (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT UNIQUE NOT NULL,
        subscribed_at TEXT DEFAULT (datetime('now'))
    )''')

    # ── REVIEWS ────────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS reviews (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id  INTEGER NOT NULL,
        user_id     INTEGER,
        author_name TEXT,
        rating      INTEGER CHECK(rating BETWEEN 1 AND 5),
        body        TEXT,
        approved    INTEGER DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )''')

    # ── CONTACT MESSAGES ───────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS contact_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL,
        subject     TEXT,
        message     TEXT NOT NULL,
        read        INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
    )''')

    conn.commit()

    # ── SEED DATA ──────────────────────────────────────────────────────
    # Admin user
    c.execute("SELECT id FROM users WHERE email = ?", ("admin@ovmclo.ng",))
    if not c.fetchone():
        c.execute("""
            INSERT INTO users (email, password, first_name, last_name, role)
            VALUES (?, ?, ?, ?, ?)
        """, ("admin@ovmclo.ng", hash_password("admin123"), "Admin", "ovm", "admin"))

    # Sample customer
    c.execute("SELECT id FROM users WHERE email = ?", ("test@example.com",))
    if not c.fetchone():
        c.execute("""
            INSERT INTO users (email, password, first_name, last_name, phone)
            VALUES (?, ?, ?, ?, ?)
        """, ("test@example.com", hash_password("password123"), "Chukwuemeka", "Adeyemi", "+234 801 234 5678"))

    products = [
        ("Ovm Retro Jersey",    "Ovm Retro Jersey",          "A statement piece rooted in Yoruba power. Heavyweight cotton with screen-printed adire-inspired graphics. The Ìjọba (government/authority) graphic channels ancestral strength.", 28500, "tshirt",  "pattern-1", 120, "BESTSELLER", 1),
        ("eko-hoodie-forest",  "Eko Hoodie — Forest",         "Lagos runs deep in every stitch. Premium 400gsm fleece hoodie with embroidered map-coordinates of Lagos Island. Kangaroo pocket with hidden aso-oke lining.", 55000, "hoodie",   "pattern-2", 80,  "NEW",       1),
        ("agbada-cargo-amber", "Àgbádá Cargo — Amber",        "Where tradition meets utility. Wide-leg cargo silhouette inspired by the flowing Àgbádá, with six functional pockets and drawstring hem. Woven amber-stripe trim.", 42000, "pants",    "pattern-3", 60,  "LIMITED",   1),
        ("kente-bomber",       "Kente Bomber Jacket",          "The crown jewel. Full Kente-woven body panels from Iseyin artisans, flight-satin lining, ribbed collar. Each jacket is uniquely numbered. A wearable heirloom.", 85000, "jacket",   "pattern-4", 25,  "EXCLUSIVE", 1),
        ("naija-wave-tee",     "Naija Wave Tee — Rust",        "Ride the wave. Rust-dyed 100% organic Nigerian cotton tee with large 'NAIJA' bold-type back print and subtle woven label at hem.", 25000, "tshirt",   "pattern-5", 150, "HOT",       0),
        ("adire-pullover",     "Adire Pullover — Cream",       "Hand-dyed adire-inspired print on a relaxed-fit french terry pullover. Each piece features unique dye variations — no two are identical. Cream/indigo colourway.", 48000, "hoodie",   "pattern-6", 45,  "NEW",       0),
        ("heritage-agbada",    "Heritage Àgbádá Set",          "The full ceremonial Àgbádá silhouette reimagined as premium streetwear. Three-piece set: top, inner, and trousers. Aso-Oke fabric sourced from Iseyin master weavers.", 180000, "set",    "pattern-4", 15,  "EXCLUSIVE", 1),
        ("eko-cap",            "Eko Snapback Cap",             "Structured 6-panel cap with embroidered coordinates of Lagos 6.45°N. Adjustable snapback. Available in black/amber and forest/cream.", 15000, "accessory","pattern-1", 200, "BESTSELLER",0),
    ]

    sizes_map = {
        "tshirt":    ["XS","S","M","L","XL","XXL"],
        "hoodie":    ["S","M","L","XL","XXL"],
        "pants":     ["28","30","32","34","36","38"],
        "jacket":    ["S","M","L","XL"],
        "set":       ["S","M","L","XL"],
        "accessory": ["ONE SIZE"],
    }

    for p in products:
        c.execute("SELECT id FROM products WHERE slug = ?", (p[0],))
        if not c.fetchone():
            c.execute("""
                INSERT INTO products (slug,name,description,price,category,pattern,stock,tag,featured)
                VALUES (?,?,?,?,?,?,?,?,?)
            """, p)
            pid = c.lastrowid
            for sz in sizes_map.get(p[4], ["S","M","L","XL"]):
                c.execute("INSERT INTO product_sizes (product_id, size, stock) VALUES (?,?,?)", (pid, sz, 20))

    # Seed reviews
    review_seeds = [
        (1, "Chukwuemeka A.", 5, "Finally a brand that makes me feel proud of where I'm from. The Ìjọba tee gets compliments everywhere in London. Pure quality."),
        (2, "Amara O.",        5, "The Heritage Bomber is genuinely the best piece of clothing I own. The aso-oke details are incredible."),
        (1, "Damilola K.",     5, "ovmclo is not a brand, it's a movement. Every piece tells a story."),
        (3, "Ngozi E.",        4, "The cargo pants are so well made. The amber trim is a gorgeous detail. Runs slightly large."),
        (4, "Bello M.",        5, "Received my Kente Bomber. I literally cannot stop wearing it. Museum-quality craft."),
    ]
    for r in review_seeds:
        c.execute("SELECT id FROM reviews WHERE product_id=? AND author_name=?", (r[0], r[1]))
        if not c.fetchone():
            c.execute("INSERT INTO reviews (product_id, author_name, rating, body) VALUES (?,?,?,?)", r)

    conn.commit()
    conn.close()
    print(f"✅ Database initialised at {DB_PATH}")

if __name__ == "__main__":
    init_db()

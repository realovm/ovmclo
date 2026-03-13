#!/usr/bin/env python3
"""
OVM CLO DB Bridge
Called by Node.js via child_process.execFileSync.
Receives JSON on stdin: { action, params }
Returns JSON on stdout: { ok, data, error }
"""
import sys
import json
import sqlite3
import hashlib
import os
import time
import random
import string

DB_PATH = os.path.join(os.path.dirname(__file__), 'ovm.db')
SALT = "ovm_clo_salt_2025"

def hash_pw(pw: str) -> str:
    return hashlib.sha256(f"{pw}{SALT}".encode()).hexdigest()

def rows_to_dicts(rows):
    if rows is None:
        return None
    if isinstance(rows, sqlite3.Row):
        return dict(rows)
    return [dict(r) for r in rows]

def order_number():
    ts = str(int(time.time()))[-6:]
    rand = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"OVM-{ts}-{rand}"

def run(action, params):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    c = conn.cursor()

    try:
        if action == "products.list":
            category = params.get("category")
            featured = params.get("featured")
            search   = params.get("search")
            limit    = int(params.get("limit", 50))
            offset   = int(params.get("offset", 0))
            sql = "SELECT * FROM products WHERE 1=1"
            args = []
            if category:  sql += " AND category=?";  args.append(category)
            if featured:  sql += " AND featured=1"
            if search:    sql += " AND (name LIKE ? OR description LIKE ?)"; args += [f"%{search}%", f"%{search}%"]
            sql += " ORDER BY featured DESC, id DESC LIMIT ? OFFSET ?"
            args += [limit, offset]
            c.execute(sql, args)
            products = rows_to_dicts(c.fetchall())
            for p in products:
                c.execute("SELECT size, stock FROM product_sizes WHERE product_id=? ORDER BY id", (p['id'],))
                p['sizes'] = rows_to_dicts(c.fetchall())
                c.execute("SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE product_id=? AND approved=1", (p['id'],))
                r = c.fetchone()
                p['rating_avg'] = round(r['avg'], 1) if r['avg'] else 0
                p['rating_count'] = r['cnt']
            return {"ok": True, "data": products}

        elif action == "products.get":
            c.execute("SELECT * FROM products WHERE slug=? OR id=?", (params.get("slug",""), params.get("id",0)))
            p = c.fetchone()
            if not p: return {"ok": False, "error": "Product not found"}
            p = dict(p)
            c.execute("SELECT size, stock FROM product_sizes WHERE product_id=? ORDER BY id", (p['id'],))
            p['sizes'] = rows_to_dicts(c.fetchall())
            c.execute("SELECT * FROM reviews WHERE product_id=? AND approved=1 ORDER BY created_at DESC", (p['id'],))
            p['reviews'] = rows_to_dicts(c.fetchall())
            c.execute("SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE product_id=? AND approved=1", (p['id'],))
            r = c.fetchone()
            p['rating_avg'] = round(r['avg'], 1) if r['avg'] else 0
            p['rating_count'] = r['cnt']
            return {"ok": True, "data": p}

        elif action == "cart.get":
            session_id = params["session_id"]
            c.execute("""
                SELECT ci.*, p.name, p.price, p.pattern, p.slug, p.category
                FROM cart_items ci
                JOIN products p ON p.id = ci.product_id
                WHERE ci.session_id=?
            """, (session_id,))
            items = rows_to_dicts(c.fetchall())
            total = sum(i['price'] * i['quantity'] for i in items)
            return {"ok": True, "data": {"items": items, "total": total, "count": len(items)}}

        elif action == "cart.add":
            session_id = params["session_id"]
            product_id = params["product_id"]
            size       = params.get("size", "M")
            qty        = int(params.get("quantity", 1))
            c.execute("SELECT id, quantity FROM cart_items WHERE session_id=? AND product_id=? AND size=?",
                      (session_id, product_id, size))
            existing = c.fetchone()
            if existing:
                c.execute("UPDATE cart_items SET quantity=? WHERE id=?",
                          (existing['quantity'] + qty, existing['id']))
            else:
                c.execute("INSERT INTO cart_items (session_id, product_id, size, quantity) VALUES (?,?,?,?)",
                          (session_id, product_id, size, qty))
            conn.commit()
            return {"ok": True, "data": {"message": "Added to cart"}}

        elif action == "cart.update":
            c.execute("UPDATE cart_items SET quantity=? WHERE id=? AND session_id=?",
                      (params["quantity"], params["item_id"], params["session_id"]))
            conn.commit()
            return {"ok": True}

        elif action == "cart.remove":
            c.execute("DELETE FROM cart_items WHERE id=? AND session_id=?",
                      (params["item_id"], params["session_id"]))
            conn.commit()
            return {"ok": True}

        elif action == "cart.clear":
            c.execute("DELETE FROM cart_items WHERE session_id=?", (params["session_id"],))
            conn.commit()
            return {"ok": True}

        elif action == "orders.create":
            session_id = params["session_id"]
            c.execute("""
                SELECT ci.*, p.name, p.price FROM cart_items ci
                JOIN products p ON p.id=ci.product_id
                WHERE ci.session_id=?
            """, (session_id,))
            items = rows_to_dicts(c.fetchall())
            if not items:
                return {"ok": False, "error": "Cart is empty"}
            subtotal = sum(i['price'] * i['quantity'] for i in items)
            shipping = 0 if subtotal >= 50000 else 3500
            total    = subtotal + shipping
            onum     = order_number()
            s = params.get("shipping", {})
            c.execute("""
                INSERT INTO orders
                (order_number, session_id, user_id, status, subtotal, shipping, total,
                 shipping_name, shipping_email, shipping_phone,
                 shipping_address, shipping_city, shipping_state, shipping_country,
                 payment_method, notes)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (onum, session_id, params.get("user_id"),
                  "pending", subtotal, shipping, total,
                  s.get("name"), s.get("email"), s.get("phone"),
                  s.get("address"), s.get("city"), s.get("state","Lagos"),
                  s.get("country","Nigeria"),
                  params.get("payment_method","paystack"), params.get("notes","")))
            order_id = c.lastrowid
            for item in items:
                c.execute("""
                    INSERT INTO order_items
                    (order_id, product_id, product_name, size, quantity, unit_price, total_price)
                    VALUES (?,?,?,?,?,?,?)
                """, (order_id, item['product_id'], item['name'], item['size'],
                      item['quantity'], item['price'], item['price']*item['quantity']))
            c.execute("DELETE FROM cart_items WHERE session_id=?", (session_id,))
            conn.commit()
            return {"ok": True, "data": {"order_number": onum, "order_id": order_id, "total": total, "shipping": shipping}}

        elif action == "orders.create_direct":
            items    = params.get("items", [])
            if not items:
                return {"ok": False, "error": "No items provided"}
            onum     = params.get("order_number")
            subtotal = params.get("subtotal", 0)
            shipping = params.get("shipping", 0)
            total    = params.get("total", 0)
            s        = params.get("shipping_info", {})
            c.execute("""
                INSERT INTO orders
                (order_number, session_id, user_id, status, subtotal, shipping, total,
                 shipping_name, shipping_email, shipping_phone,
                 shipping_address, shipping_city, shipping_state, shipping_country,
                 payment_method)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (onum, params.get("session_id"), params.get("user_id"),
                  "pending", subtotal, shipping, total,
                  s.get("name"), s.get("email"), s.get("phone"),
                  s.get("address"), s.get("city"), s.get("state","Lagos"),
                  s.get("country","Nigeria"), params.get("payment_method","paystack")))
            order_id = c.lastrowid
            for item in items:
                c.execute("""
                    INSERT INTO order_items
                    (order_id, product_id, product_name, size, quantity, unit_price, total_price)
                    VALUES (?,?,?,?,?,?,?)
                """, (order_id, item.get("product_id"), item.get("product_name"),
                      item.get("size"), item.get("quantity"),
                      item.get("unit_price"), item.get("total_price")))
            conn.commit()
            return {"ok": True, "data": {"order_number": onum, "order_id": order_id, "total": total}}

        elif action == "orders.get":
            c.execute("SELECT * FROM orders WHERE order_number=? OR id=?",
                      (params.get("order_number",""), params.get("id",0)))
            order = c.fetchone()
            if not order: return {"ok": False, "error": "Order not found"}
            order = dict(order)
            c.execute("SELECT * FROM order_items WHERE order_id=?", (order['id'],))
            order['items'] = rows_to_dicts(c.fetchall())
            return {"ok": True, "data": order}

        elif action == "orders.list":
            user_id    = params.get("user_id")
            session_id = params.get("session_id")
            if user_id:
                c.execute("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC", (user_id,))
            else:
                c.execute("SELECT * FROM orders WHERE session_id=? ORDER BY created_at DESC", (session_id,))
            orders = rows_to_dicts(c.fetchall())
            return {"ok": True, "data": orders}

        elif action == "orders.update_status":
            c.execute("UPDATE orders SET status=? WHERE id=?",
                      (params["status"], params["id"]))
            conn.commit()
            return {"ok": True}

        elif action == "auth.register":
            email = params["email"].lower().strip()
            c.execute("SELECT id FROM users WHERE email=?", (email,))
            if c.fetchone(): return {"ok": False, "error": "Email already registered"}
            c.execute("""
                INSERT INTO users (email, password, first_name, last_name, phone)
                VALUES (?,?,?,?,?)
            """, (email, hash_pw(params["password"]),
                  params.get("first_name",""), params.get("last_name",""),
                  params.get("phone","")))
            conn.commit()
            uid = c.lastrowid
            return {"ok": True, "data": {"id": uid, "email": email,
                    "first_name": params.get("first_name",""), "role": "customer"}}

        elif action == "auth.login":
            email = params["email"].lower().strip()
            c.execute("SELECT * FROM users WHERE email=?", (email,))
            user = c.fetchone()
            if not user or user['password'] != hash_pw(params["password"]):
                return {"ok": False, "error": "Invalid email or password"}
            u = dict(user)
            u.pop('password', None)
            return {"ok": True, "data": u}

        elif action == "auth.get_user":
            c.execute("SELECT id,email,first_name,last_name,phone,role,created_at FROM users WHERE id=?", (params["id"],))
            u = c.fetchone()
            if not u: return {"ok": False, "error": "User not found"}
            return {"ok": True, "data": dict(u)}

        elif action == "auth.update_profile":
            c.execute("""
                UPDATE users SET first_name=?, last_name=?, phone=?
                WHERE id=?
            """, (params.get("first_name"), params.get("last_name"), params.get("phone"), params["id"]))
            conn.commit()
            return {"ok": True}

        elif action == "newsletter.subscribe":
            email = params["email"].lower().strip()
            try:
                c.execute("INSERT INTO newsletter (email) VALUES (?)", (email,))
                conn.commit()
                return {"ok": True, "data": {"message": "Subscribed! Welcome to the movement."}}
            except sqlite3.IntegrityError:
                return {"ok": True, "data": {"message": "You're already subscribed."}}

        elif action == "reviews.add":
            c.execute("""
                INSERT INTO reviews (product_id, user_id, author_name, rating, body)
                VALUES (?,?,?,?,?)
            """, (params["product_id"], params.get("user_id"),
                  params.get("author_name","Anonymous"),
                  int(params["rating"]), params["body"]))
            conn.commit()
            return {"ok": True, "data": {"message": "Review submitted for approval."}}

        elif action == "contact.send":
            c.execute("""
                INSERT INTO contact_messages (name, email, subject, message)
                VALUES (?,?,?,?)
            """, (params["name"], params["email"],
                  params.get("subject","General Enquiry"), params["message"]))
            conn.commit()
            return {"ok": True, "data": {"message": "Message received. We'll respond within 24hrs."}}

        elif action == "admin.dashboard":
            c.execute("SELECT COUNT(*) as cnt FROM orders")
            total_orders = c.fetchone()['cnt']
            c.execute("SELECT COALESCE(SUM(total),0) as rev FROM orders WHERE payment_status='paid'")
            revenue = c.fetchone()['rev']
            c.execute("SELECT COUNT(*) as cnt FROM users WHERE role='customer'")
            customers = c.fetchone()['cnt']
            c.execute("SELECT COUNT(*) as cnt FROM newsletter")
            subscribers = c.fetchone()['cnt']
            c.execute("""
                SELECT o.*, COUNT(oi.id) as item_count
                FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
                GROUP BY o.id ORDER BY o.created_at DESC LIMIT 10
            """)
            recent_orders = rows_to_dicts(c.fetchall())
            return {"ok": True, "data": {
                "total_orders": total_orders,
                "revenue": revenue,
                "customers": customers,
                "subscribers": subscribers,
                "recent_orders": recent_orders
            }}

        elif action == "admin.orders":
            status = params.get("status")
            sql  = "SELECT o.*, COUNT(oi.id) as item_count FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id"
            args = []
            if status: sql += " WHERE o.status=?"; args.append(status)
            sql += " GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100"
            c.execute(sql, args)
            return {"ok": True, "data": rows_to_dicts(c.fetchall())}

        elif action == "admin.products.update":
            c.execute("""
                UPDATE products SET name=?, price=?, stock=?, description=?, tag=?, featured=?
                WHERE id=?
            """, (params["name"], params["price"], params["stock"],
                  params.get("description",""), params.get("tag",""),
                  int(params.get("featured", 0)), params["id"]))
            conn.commit()
            return {"ok": True}

        else:
            return {"ok": False, "error": f"Unknown action: {action}"}

    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        conn.close()

if __name__ == "__main__":
    raw = sys.stdin.read()
    payload = json.loads(raw)
    result = run(payload.get("action"), payload.get("params", {}))
    print(json.dumps(result))

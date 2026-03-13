# OVM CLO — Project File Structure

```
ovm-clo/
├── index.html      ← HTML structure only (no inline CSS or JS)
├── styles.css      ← All styles — old money palette, typography, layout
├── cart.js         ← All client-side JS — cart, Paystack checkout, UI
│
├── server.js       ← Node.js backend (pure built-ins, no npm required)
├── db/
│   ├── init_db.py  ← Run once to create the SQLite database + seed data
│   ├── db_bridge.py← Python/SQLite bridge called by server.js
│   └── agbada.db   ← SQLite database (created by init_db.py)
└── README.md
```

## Frontend (no server needed)

Open `index.html` directly in a browser. The cart and checkout work
fully client-side via `localStorage`.

**Before going live**, replace the Paystack test key in `cart.js`:
```js
// cart.js line 6
const PKEY = 'pk_live_YOUR_KEY_HERE';
```
Get your live key at https://dashboard.paystack.com/#/settings/developer

---

## Backend (optional — for orders, auth, newsletter API)

**Requirements:** Node.js ≥ 16, Python 3

```bash
# 1. Initialise the database (first time only)
python3 db/init_db.py

# 2. Start the server
node server.js
# → http://localhost:3000
```

The frontend will automatically use the backend API when served
through Node.js (same origin). When opened as a plain file it falls
back to the client-side localStorage cart.

### Test accounts
| Email                  | Password   | Role  |
|------------------------|------------|-------|
| admin@ovmclo.ng  | admin123   | Admin |
| test@example.com       | password123| User  |

### API endpoints
| Method | Path                    | Auth    | Description           |
|--------|-------------------------|---------|-----------------------|
| GET    | /api/health             | —       | Health check          |
| GET    | /api/products           | —       | List products         |
| POST   | /api/cart               | Session | Add to cart           |
| GET    | /api/cart               | Session | Get cart              |
| POST   | /api/orders             | Session | Create order          |
| POST   | /api/auth/register      | —       | Register              |
| POST   | /api/auth/login         | —       | Login                 |
| GET    | /api/auth/me            | JWT     | Current user          |
| POST   | /api/newsletter         | —       | Subscribe             |
| GET    | /api/admin/dashboard    | Admin   | Stats + recent orders |

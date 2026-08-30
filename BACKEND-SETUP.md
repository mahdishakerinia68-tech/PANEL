# STRIX VIP PANEL v1.2 — Backend
این نسخه Backend واقعی پایه دارد:
- Node.js + Express
- SQLite
- JWT login
- bcrypt برای رمزها
- Multi-Tenant با customer_id
- CRUD مشتری، سرور، پلن، کاربر و سرویس
- هر مشتری فقط داده‌های خودش را می‌بیند.
- مدیر اصلی همه داده‌ها را می‌بیند.

## اجرا
داخل backend:
1. `npm install`
2. `.env.example` را به `.env` کپی کن.
3. `JWT_SECRET` و `ADMIN_PASSWORD` را حتماً عوض کن.
4. `npm start`

## اتصال Marzban
لایه مدیریت سرور در این نسخه آماده است، اما قبل از اتصال عملی باید API دقیق نسخه Marzban مقصد، توکن احراز هویت و سیاست امنیتی مشخص شود. توکن‌های Marzban را داخل Frontend/GitHub Pages قرار نده؛ فقط در Backend و متغیر محیطی امن نگهداری کن.

# STRIX VIP PANEL V1.2

## اولین اجرا
اگر جدول `admins` در دیتابیس خالی باشد، پنل به‌جای Login صفحه «ساخت اولین ادمین» را نمایش می‌دهد. Username باید حداقل ۳ کاراکتر و Password حداقل ۸ کاراکتر باشد و Password دوبار وارد می‌شود.

پس از ساخت موفق، Backend توکن Session را صادر می‌کند و کاربر مستقیماً وارد پنل می‌شود. هیچ Username یا Password پیش‌فرضی در کد پروژه وجود ندارد.

## احراز هویت
- Login واقعی از طریق Backend و SQLite انجام می‌شود.
- Passwordها فقط با `bcrypt` به صورت hash ذخیره می‌شوند.
- با تغییر Username یا Password، `session_version` افزایش می‌یابد و Session قبلی بلافاصله نامعتبر می‌شود.
- حذف آخرین ادمین مجاز نیست.
- اگر دیتابیس قبلی وجود داشته باشد، بر اساس تعداد واقعی رکوردهای جدول `admins` تصمیم‌گیری می‌شود و هیچ ادمین مخفی/جعلی ساخته نمی‌شود.

## اجرا
```bash
cd backend
npm install
cp .env.example .env
npm start
```

Backend باید روی سروری اجرا شود که `/api` را سرو کند؛ GitHub Pages به تنهایی Backend را اجرا نمی‌کند.

## ساختار
- `backend/` — API و SQLite
- `assets/strix-dashboard-bg.png` — پس‌زمینه داشبورد، حفظ شده
- `index.html`, `app.js`, `style.css` — رابط کاربری

نسخه: **V1.2.0**

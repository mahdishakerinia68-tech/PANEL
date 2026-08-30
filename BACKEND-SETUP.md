# STRIX VIP PANEL V1.3 — Backend Setup

1. وارد `backend/` شوید.
2. `npm install`
3. `.env.example` را به `.env` کپی کنید.
4. یک `JWT_SECRET` طولانی و تصادفی تنظیم کنید.
5. `npm start`

### First Admin
در اولین اجرای واقعی، اگر `admins` خالی باشد، API زیر وضعیت Setup را اعلام می‌کند:
`GET /api/setup/status`

سپس:
`POST /api/setup/create-admin`

این API فقط وقتی کار می‌کند که تعداد ادمین‌ها صفر باشد. Username حداقل ۳ کاراکتر، Password حداقل ۸ کاراکتر و تکرار Password الزامی است. Password به صورت bcrypt hash ذخیره می‌شود.

### Account Settings
`PUT /api/account/me` برای حساب فعلی Username/Password را تغییر می‌دهد و با افزایش `session_version` تمام Sessionهای قبلی را باطل می‌کند.

### دیتابیس قبلی
دیتابیس قبلی حفظ می‌شود. Backend فقط ستون `session_version` را در صورت نبودن اضافه می‌کند و هرگز Username/Password پیش‌فرض ایجاد نمی‌کند.

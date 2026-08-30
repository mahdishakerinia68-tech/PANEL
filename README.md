# STRIX VIP PANEL V1.3

پنل مدیریتی مشکی/طلایی با ساختار نزدیک به پنل Marzban، احراز هویت واقعی Backend و دیتابیس SQLite.

## امکانات V1.3
- First Admin Setup فقط در صورت خالی بودن جدول `admins`.
- ترتیب Setup: رمز ادمین، تکرار رمز، سپس آیدی ادمین.
- بدون Username/Password پیش‌فرض.
- ذخیره رمز فقط به صورت bcrypt hash.
- Login مشترک برای Admin و Panel User.
- ساخت کاربران پنل توسط Admin؛ هر کاربر پنل حساب مستقل و دسترسی محدود دارد.
- Admin: مدیریت کاربران پنل، مدیران، سرورها، کاربران، سرویس‌ها و پلن‌ها.
- Panel User: فقط مدیریت کاربران، سرویس‌ها، پلن‌ها و حساب خودش.
- ایجاد، ویرایش و حذف در بخش‌های مدیریتی.
- تغییر Username/Password حساب؛ با تغییر اطلاعات، Session قبلی باطل می‌شود.
- پس‌زمینه `assets/strix-dashboard-bg.png` حفظ شده.
- Responsive برای موبایل و دسکتاپ.

## اجرا
```bash
cd backend
npm install
cp .env.example .env
# JWT_SECRET را در .env با یک مقدار تصادفی قوی تنظیم کنید.
npm start
```

سپس فایل‌های ریشه را با یک Static Server سرو کنید و API را روی همان Origin یا با Proxy به Backend متصل کنید.


### مهم برای ورود
برای اجرای کامل پنل، Frontend و Backend را از یک سرور اجرا کنید: داخل `backend/` دستور `npm install` و سپس `npm start` را اجرا کنید و پنل را از `http://SERVER:3000/` باز کنید. باز کردن مستقیم `index.html` با `file://` یا فقط GitHub Pages باعث می‌شود APIهای Login/Setup به Backend وصل نشوند. اگر Frontend روی دامنه جداست، قبل از `app.js` مقدار `window.STRIX_API_BASE` را برابر آدرس Backend قرار دهید.

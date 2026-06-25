# 🚀 Melody AI — دليل النشر الكامل

## الملفات المُصلَحة

| الملف | المشكلة | الإصلاح |
|-------|---------|---------|
| `middleware.ts` | ملفان متعارضان + CORS مكسور | middleware واحد شامل: CORS + Auth + Rate Limit |
| `lib/redis.ts` | instance مكرر مع BullMQ | singleton واحد مع `maxRetriesPerRequest: null` |
| `lib/auth.ts` | JWT typing + refresh token لا يُحذف | Token rotation + session table + cookie fix |
| `lib/prisma.ts` | Connection leak على Render | Singleton مع graceful shutdown |
| `middleware/rate-limit.ts` | يعتمد على `@upstash/redis` منفصل | يستخدم ioredis المشترك + in-memory fallback |
| `infrastructure/queue/generation-queue.ts` | ينشئ ioredis connection جديد | يستخدم redis singleton |
| `app/api/auth/login` | CORS مكرر + response format غير موحّد | حُذف CORS (middleware) + `{ success, data, error }` |
| `app/api/auth/register` | نفس المشكلة | نفس الإصلاح |
| `app/api/auth/refresh` | لا يدعم Authorization header | يدعم cookie + Bearer |
| `app/api/auth/logout` | **مفقود!** | أُضيف من جديد |
| `app/api/me` | يستدعي DB لتحقق auth | يستخدم `x-user-id` header من middleware |
| `app/api/songs` | نفس المشكلة | نفس الإصلاح |
| `app/api/health` | **مفقود!** | أُضيف لـ Render health checks |
| `enterprise/core/api-response.ts` | `fromError` و `paginated` مفقودان | أُضيفا |
| `frontend/lib/api.ts` | `credentials: 'include'` مفقود = Failed to fetch | أُضيف + auto token refresh |
| `tsconfig.json` | workers folder يسبب type errors | أُضيف إلى exclude |
| `next.config.js` | `ignoreBuildErrors: true` يخفي أخطاء | حُذف |

---

## ⚡ خطوات النشر

### 1. Backend على Render

```bash
# 1. أضف متغيرات البيئة في Render Dashboard:
DATABASE_URL=postgresql://...  # من Neon
REDIS_URL=rediss://...         # من Upstash
FRONTEND_URL=https://your-app.netlify.app
JWT_SECRET=<random 48 chars>
JWT_REFRESH_SECRET=<random 48 chars>

# 2. Build Command في Render:
npm install && npx prisma generate && npm run build

# 3. Start Command:
npm start

# 4. Health Check Path:
/api/health
```

### 2. قاعدة البيانات (Neon)

```bash
# شغّل migration على Neon:
npx prisma migrate deploy

# أو لأول مرة:
npx prisma db push
```

### 3. Frontend على Netlify

```bash
# أضف في Netlify Dashboard > Environment Variables:
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com

# Build Command:
npm run build

# Publish Directory:
.next
```

---

## 🔐 متغيرات البيئة المطلوبة

### Backend (Render) — إلزامية
```env
DATABASE_URL=postgresql://USER:PASS@HOST/DB?sslmode=require
REDIS_URL=rediss://default:TOKEN@HOST:6379
JWT_SECRET=<min 32 random chars>
FRONTEND_URL=https://your-app.netlify.app
NODE_ENV=production
```

### Frontend (Netlify) — إلزامية
```env
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
```

---

## 🏗️ Architecture الحل

```
Browser (Netlify)
    │
    │ fetch + credentials:'include' + Bearer token
    ▼
middleware.ts (Global)
    ├── CORS headers (allow Netlify origin)
    ├── OPTIONS preflight → 204
    ├── Public routes → pass through
    ├── JWT verify → inject x-user-id header
    ├── Rate limit (in-memory fallback)
    └── Admin check
    │
    ▼
API Route Handler
    ├── reads x-user-id (no extra DB call)
    ├── business logic
    └── returns { success, data, error }
    │
    ▼
Prisma (Neon PostgreSQL)
Redis (BullMQ Queue)
```

---

## ✅ Checklist قبل النشر

- [ ] `DATABASE_URL` مضبوط وصحيح (Neon)
- [ ] `REDIS_URL` مضبوط (Upstash أو Redis Cloud)
- [ ] `JWT_SECRET` عشوائي (min 32 chars)
- [ ] `FRONTEND_URL` = رابط Netlify الفعلي
- [ ] `NEXT_PUBLIC_API_URL` = رابط Render الفعلي
- [ ] `npx prisma migrate deploy` شُغّل على DB
- [ ] Health check `/api/health` يرجع `{ status: "healthy" }`

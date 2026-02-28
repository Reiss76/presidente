# Deploy Runbook (Vercel + Railway)

Este proyecto está en monorepo:

- `apps/frontend` (Next.js) → **Vercel**
- `apps/backend` (NestJS) → **Railway**

---

## 1) Variables de entorno

### Railway (backend)
Configura mínimo:

- `PORT=8080`
- `DATABASE_URL=...`
- `JWT_SECRET=...`
- `FRONTEND_URLS=https://cosmosx.tech,https://www.cosmosx.tech`

Opcionales según uso actual:

- `GEOCODING_API_KEY=...`
- `R2_BUCKET=...`
- `R2_ENDPOINT=...`
- `R2_ACCESS_KEY_ID=...`
- `R2_SECRET_ACCESS_KEY=...`

### Vercel (frontend)
Configura mínimo:

- `NEXT_PUBLIC_API_URL=https://<tu-backend-railway>`

---

## 2) Deploy Railway (backend)

1. Conecta repo `Reiss76/presidente`
2. Root directory del servicio: `apps/backend`
3. Build command: `npm run build`
4. Start command: `npm run start:prod`
5. Verifica endpoint:
   - `GET /health` devuelve `{ "ok": true, ... }`

---

## 3) Deploy Vercel (frontend)

1. Conecta repo `Reiss76/presidente`
2. Root directory del proyecto: `apps/frontend`
3. Framework: Next.js
4. Build command: `npm run build`
5. Output: default de Next.js
6. Verifica que `NEXT_PUBLIC_API_URL` apunte al backend de Railway

---

## 4) Orden recomendado de release

1. Deploy backend (Railway)
2. Validar `https://<backend>/health`
3. Deploy frontend (Vercel)
4. Validar login + flujo principal (buscador/mapas)

---

## 5) Checklist final

- [ ] Front responde en dominio público
- [ ] Backend responde `/health`
- [ ] CORS correcto (`FRONTEND_URLS`)
- [ ] Login funciona
- [ ] Búsqueda de PL funciona
- [ ] Mapas cargan sin errores
- [ ] No hay secretos en repositorio

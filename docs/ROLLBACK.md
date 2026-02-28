# Rollback Express (Producción)

## Cuándo usar
- Deploy en rojo
- Error 5xx sostenido
- Login/flujo crítico roto después de release

## Vercel (frontend)
1. Entra a **Deployments** del proyecto.
2. Elige el último deploy estable (Ready).
3. `...` → **Promote to Production** (o Redeploy de ese commit).
4. Verifica `https://www.cosmosx.tech/login?next=%2F`.

## Railway (backend)
1. Entra al servicio `codes-backend`.
2. Abre historial de deploys.
3. Selecciona último deploy estable.
4. **Redeploy** (con `Clear build cache` si hubo error de runtime/libs).
5. Verifica `https://codes-backend-production.up.railway.app/health`.

## Smoke post-rollback (obligatorio)
- Front login carga
- `/health` backend = `ok:true`
- Crear/editar PL básico
- Catálogos en Configuración (grupo/usuario/sub)

## Criterio de cierre
Solo se cierra incidente cuando:
- Front + backend estables por 10+ minutos
- Sin errores críticos en consola/runtime

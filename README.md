# presidente (monorepo)

Monorepo unificado del proyecto con frontend y backend bajo un solo flujo de trabajo.

## Estructura

- `apps/frontend` → app Next.js
- `apps/backend` → API backend (NestJS)
- `packages` → código compartido (futuro)
- `docs` → documentación

## Requisitos

- Node.js 20+
- npm 10+

## Configuración

1. Instala dependencias:

```bash
npm install --workspaces
```

2. Crea tus variables de entorno desde el ejemplo raíz y las de cada app:

```bash
cp .env.example .env
cp apps/frontend/.env.example apps/frontend/.env.local
```

> Ajusta valores según tu entorno local.

## Scripts principales

Desde la raíz del repo:

- `npm run dev:frontend` → levanta frontend
- `npm run dev:backend` → levanta backend en modo watch
- `npm run build` → build frontend + backend
- `npm run lint` → lint/type-check frontend + backend
- `npm run test` → comando base de tests (placeholder por ahora)

## CI

Se ejecuta en GitHub Actions (`.github/workflows/ci.yml`) para:

- instalación de dependencias
- lint
- build

## Próxima fase

- Agregar tests reales (unit/integration)
- Compartir tipos entre front y back en `packages/`
- Pipeline de deploy por entorno

# Release strategy

## Branch model

- `main`: always releasable
- feature branches: `feat/*`, `fix/*`, `chore/*`

## Versioning

Use semantic versioning (`MAJOR.MINOR.PATCH`).

- `PATCH`: bug fixes
- `MINOR`: backwards-compatible features
- `MAJOR`: breaking changes

## Release checklist

1. CI green on `main`
2. Update env variables/secrets in target environment
3. Tag release: `vX.Y.Z`
4. Deploy backend then frontend
5. Smoke test `/health` and critical UI flow
6. Post release notes

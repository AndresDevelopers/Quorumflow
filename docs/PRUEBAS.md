# Pruebas

## Stack

- **Vitest** + **@testing-library/react** + **jsdom**
- Scripts: `pnpm test` (CI), `pnpm test:watch` (local)
- Complementario: `pnpm test:roles` (node:test sobre `scripts/test-roles.ts`)

## Dónde poner tests

| Tipo | Ubicación | Ejemplo |
| --- | --- | --- |
| Unitarios de utilidades | `src/lib/__tests__/*.test.ts` | roles, birthdays, geocode |
| Componentes | `src/components/__tests__/*.test.tsx` | sheets, forms aislados |
| Smoke de páginas | `src/app/__tests__/pages/*.pages.test.tsx` | montar cada ruta con mocks |

## Helpers

- `src/test-support/setup.ts` — mocks globales de Firebase client y polyfills jsdom
- `src/test-support/render.tsx` — `renderWithProviders` (I18n)
- `src/test-support/page-mocks.ts` — mocks de Next, auth, Firestore y loaders para páginas
- `src/test-support/mocks/auth.ts` — estado de `useAuth` por defecto (leadership)

## Convención smoke de páginas

1. Importar `@/test-support/page-mocks` primero.
2. Renderizar el `default` export de la página con `renderWithProviders`.
3. Assert mínimo: el body tiene contenido (y, si es barato, un heading o control clave).
4. No hacer CRUD real ni red; los loaders devuelven listas vacías.

## Ejecutar

```bash
pnpm test
pnpm test:watch
pnpm test src/lib/__tests__/roles.test.ts
```

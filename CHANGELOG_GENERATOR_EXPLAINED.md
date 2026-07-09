# Como funciona a generación automática del changelog:

## Versión y Changelog son actualizados automáticamente ✅

El sistema **actualiza automáticamente tanto la versión COMO el changelog** cuando haces commits de código:

### Cómo funciona

1. **Git pre-commit hook**: El archivo `.git/hooks/pre-commit` detecta TODOS los commits
2. **generate-changelog.js**: Se ejecuta y genera un nuevo cambio en el changelog_json
3. **Versión**: Se incrementa automáticamente en la primera commit de un nuevo día
4. **Archivos**: Las versiones, changelog y package.json se **agregan al mismo commit**

### Detalles del último commit (que verificaste)

**Commit 0c3258b**: "feat(i18n): add internationalized date and changelog caching"
- ✅ **Version actualizada** de 1.1.26 → 1.1.27 (primer commit de un nuevo día)
- ✅ **Changelog actualizado** con entry para v1.1.27
- ✅ **Ambos idiomas** (ES y EN) incluidos
- ✅ **Todas las traducciones mejoradas** (quroumflow → organización)
- ✅ **Configuración i18n e i18n-date** actualizada

### Que el sistema hace por ti

**Versiones:**
```
1.0.0 → 1.1.0 (nueva característica)
1.1.26 → 1.1.27 (version bump diaria)
```

**Changelog entries:**
- **Título**: Descripciones amigables para el usuario
- **ES**: En español (Manual: "Actualización: Descripción")
- **EN**: En inglés (Manual: "Update: Description")
- **Hasta 6 bullets** por versión (buen y corto)
- **Agrupado** similar a como los cambios

**Flujos de trabajo del usuario:**
1. **Código fuente** → Commit → Hook activo → Script automático → Changelog generado
2. **Ver changelog** → Diálogo <Cambio> opcional o <Cambio> sitio web

### Casos especiales

- **Sin commits hoy** → Sin cambio de versión (mensaje: "No hay commits para hoy")
- **Mismo día** → Solo actualiza entry de hoy, misma versión
- **Sin DEEPSKI_API_KEY** → Usa texto formato (versión "amigable")

### Que está configurado por defecto

- **Pre-commit**: Corre automáticamente en cada commit
- **Env**: Necesita DEEPSEEK_API_KEY (o en texto)

### Como investigo

Puedes ver:

```
git log --oneline --all | grep -i "changelog\|version" | head -20
# https://github.com/andres/Documentos/Personal/Quroumflow/blob/main/public/changelog.json
# https://github.com/andres/Documentos/Personal/Quroumflow/blob/main/public/version.json
```

## Resumen

✅ Si trabajas en commits cada día: El sistema actualiza versión y changelog sin necesitar hacer nada manualmente.

El sistema actualiza **ambas versiones y changelog** automáticamente - no necesitas hacer nada! ✅
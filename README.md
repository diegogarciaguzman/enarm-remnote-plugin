# ENARM · Resúmenes diarios — Plugin de RemNote

Mete los resúmenes ENARM diarios directo en el RemNote de Diego, ordenados
por especialidad, sin que él copie ni ordene nada. Él solo estudia el tema
y ve las flashcards.

## Cómo funciona

1. La extracción diaria de las 6:30 deja el resumen del día en el espacio
   "Resumen ENARM diario" y actualiza la cola pública (`queue.json`).
   La cola vive en GitHub raw:
   https://raw.githubusercontent.com/diegogarciaguzman/enarm-remnote-plugin/main/queue.json
   (GitHub raw envía CORS `*` y el enlace no caduca, por eso se mudó ahí
   desde el enlace de Muse, que se cayó con un 403 el 13 nov 2026).
2. El plugin, al abrir RemNote (o con el botón "Sincronizar ahora" / el
   comando `ENARM: sincronizar resúmenes ahora`), descarga la cola y crea
   lo que falte con esta estructura (desde v0.1.3 cada tema es su propio
   documento independiente dentro de su especialidad, no una viñeta
   anidada):

```
ENARM
└─ GINECOLOGÍA Y OBSTETRICIA
     └─ Control prenatal  (DOCUMENTO: se abre solo, aparece en la barra lateral)
          ├─ ⭐ Detalles.
          ├─ Puntos de oro.
          │    ├─ Flashcards.   (solo las del simulador del curso, formato >>)
          │    ├─ Resumen GPC.
          │    └─ Preguntas destacadas (anki).
          ├─ Puntos a reforzar.
          ├─ Generalidades
          └─ CONTROL PRENATAL
               ├─ Definición.
               ├─ Clínica.
               ├─ Epidemiología.
               ├─ Etiología Factores de riesgo.
               ├─ Diagnóstico.
               ├─ Tratamiento.
               ├─ Perlas ENARM.
               └─ Discrepancias.
```

3. Es idempotente: si el tema ya existe bajo su especialidad, se salta.
   Nunca borra ni modifica rems existentes (salvo el flag de documento del
   propio tema, v0.1.3). Los temas que ya existían anidados se promueven a
   documento en su lugar (mismo rem, mismos hijos, mismas tarjetas).

## Reglas (de Diego)

- NUNCA genera flashcards: solo van como flashcards las del simulador del
  curso (deck Anki), mejoradas como pregunta completa con contexto, que ya
  vienen en el markdown como líneas `pregunta >> respuesta`. El parser de
  markdown de RemNote las convierte en flashcards automáticamente.
- El resumen usa su plantilla exacta (Detalles / Puntos de oro / Puntos a
  reforzar / Generalidades / tema en mayúsculas con sus 8 subsecciones).
- Un documento por tema, bajo el rem padre de su especialidad (`#Especialidad`).
  Desde v0.1.3 el rem raíz del tema se marca como documento con
  `Rem.setIsDocument(true)`: se abre solo y aparece en la barra lateral,
  sin moverse de su especialidad.

## Cambios

- **v0.1.4 (18 nov 2026) — visibilidad de documentos (reveal)**: las
  páginas de los 31 documentos se veían casi vacías aunque el contenido
  está completo en el árbol: los hijos estaban ocultos en el contexto de
  portal de la página del documento (se crearon por programa y nunca se
  marcaron como visibles en esa página). Nuevo comando `ENARM:
  diagnosticar visibilidad de documentos` (SOLO LECTURA: cuenta
  hidden/included/none por tema y verifica el padre de la sección en
  mayúsculas) y comando `ENARM: revelar contenido de documentos`
  (marca `included` lo que esté `hidden` + `expand` recursivo;
  idempotente, reversible, sin mover ni borrar). **Secuencia: primero
  diagnóstico, y solo si confirma ocultos, reveal.** También: verificación
  de tarjetas por tema (`ENARM: verificar tarjetas por tema`, solo
  lectura, `getAll()` + `getDescendants()` contra los `>>` de la cola),
  candado único de corrida para el sync (auto-sync, comando y botón no
  se solapan), detección de duplicados tras crear (avisa si hay más de
  un documento con el mismo nombre bajo la especialidad, sin borrar
  nada) y registro persistente de las últimas 10 corridas del sync en
  el widget. La contingencia del segundo `#` ya corre también en el
  camino "ya-existia" (antes era código muerto tras la promoción).
- **v0.1.3 (18 nov 2026) — documentos independientes**: cada tema pasa a
  ser su propio documento (`setIsDocument(true)`); los 31 temas anidados
  que ya existían se promueven en su lugar (status `convertido` en el
  reporte del sync). Contingencia: si el parser dejó la sección en
  mayúsculas (`# TEMA`) como raíz hermana del título, el sync la mueve
  bajo el título para que el documento contenga el tema completo. Nada que
  borrar: el árbol viejo ES el documento nuevo.
- **v0.1.2 (16 nov 2026)**: errores por paso, `setParent`, caché de
  carpetas, `createTreeWithMarkdown` (SDK 0.0.20).

## Nota del SDK (0.0.20, vigente)

El SDK es `@remnote/plugin-sdk` 0.0.20. El motor usa
`createTreeWithMarkdown(markdown, parentId)` para crear el árbol del tema
(`createWithMarkdown` fue eliminado en 0.0.20), `Rem.setParent()` para los
movimientos y `Rem.setIsDocument(true)` / `Rem.isDocument()` para marcar
cada tema como documento independiente. `npm run check-types` (tsc) pasa
limpio y el build genera `PluginZip.zip`.

## CORS

El plugin descarga la cola con `fetch()` desde RemNote. La cola vive en
GitHub raw, que envía la cabecera `Access-Control-Allow-Origin: *` y no
caduca, así que el sync no depende de ningún enlace temporal. Antes vivía
en un enlace de Muse, que se cayó (403) el 13 nov 2026; esa es la razón
del cambio.

## Archivos

- `public/manifest.json` — id `enarm-resumenes-diarios`, scope `All` con
  nivel `ReadCreateModify` (crear y modificar; no borra nada).
- `src/settings.ts` — ajustes: URL de la cola y auto-sync.
- `src/queue.ts` — tipos y descarga/validación de la cola.
- `src/sync.ts` — motor: crea raíz ENARM → especialidad → tema.
- `src/verify.ts` — v0.1.4: diagnóstico de visibilidad, reveal y verificación de tarjetas por tema.
- `src/widgets/index.tsx` — onActivate: registra ajustes, comando y widget.
- `src/widgets/enarm_sync.tsx` — widget lateral con botón y reporte de sync.
- `../data/queue.json` — cola actual (tema de prueba: Control prenatal).
- `../data/control-prenatal.md` — markdown del tema de prueba.

## Desarrollo

```bash
npm install
npm run dev      # sirve el plugin en http://localhost:8080
npm run build    # valida el manifiesto, compila y genera PluginZip.zip
```

El build corre `remnote-plugin validate` antes de compilar.

## Instalación (para Diego)

El plugin se instala desde el ZIP, pero RemNote 1.30.2 ya no tiene la
opción "Install From Zip" en Developer: la subida es por la pestaña Build
y exige que el repo de GitHub sea público (el `repoUrl` del manifiesto
apunta a https://github.com/diegogarciaguzman/enarm-remnote-plugin).

1. Descarga `PluginZip.zip` (está en la carpeta del plugin).
2. En RemNote: Ajustes → Plugins → Build → "Upload plugin" → elige el ZIP.
3. Acepta los permisos (acceso a todos los Rem, crear y modificar).
4. Abre la pestaña "ENARM · Resúmenes" en la barra lateral derecha y pulsa
   "Sincronizar ahora". El tema de prueba (Control prenatal, 9 nov) debe
   aparecer bajo ENARM → GINECOLOGÍA Y OBSTETRICIA, con sus 16 flashcards.

**Para actualizar a una versión nueva**: se sube el ZIP nuevo por la misma
ruta (Build → "Upload plugin"); RemNote reemplaza la versión instalada.
Después, pulsa "Sincronizar ahora" para que el sync nuevo corra (o reabre
RemNote y deja que el auto-sync lo haga solo).

## Secuencia v0.1.4 (páginas vacías)

Si al abrir un tema su página se ve casi vacía (solo el encabezado en
mayúsculas y viñetas vacías), el contenido NO se perdió: sus hijos están
ocultos en la vista de esa página. Secuencia:

1. Corre `ENARM: diagnosticar visibilidad de documentos` (Ctrl/Cmd+K) o
   el botón "Diagnosticar visibilidad" del widget. Solo lee: cuenta por
   tema cuántos hijos están ocultos/incluidos/sin estado y verifica el
   padre de la sección en mayúsculas. El detalle queda en el widget.
2. Si el diagnóstico confirma hijos ocultos, corre `ENARM: revelar
   contenido de documentos` (o el botón "Revelar contenido"). Marca
   incluidos los hijos ocultos y expande el documento. Es idempotente
   (una segunda corrida no toca nada) y reversible, sin mover ni borrar
   nada. El reveal NUNCA corre solo desde el diagnóstico: son comandos
   separados a propósito.
3. Opcional: `ENARM: verificar tarjetas por tema` cuenta las tarjetas
   reales por tema contra los `>>` de la cola (724 en total) y reporta
   por tema esperadas/reales/estado en el widget.

El widget también muestra el registro de las últimas 10 corridas del
sync (con sus errores) y avisa si hay duplicados bajo una especialidad.

Si algo sale mal: abre RemNote con los plugins desactivados en
http://www.remnote.com/notes?disablePlugins y quita el plugin.

## Automatización diaria

La extracción de las 6:30, después de guardar el resumen del día en el
espacio, debe actualizar la cola: agregar el tema nuevo al arreglo
`topics` de `~/workspace/remnote-enarm-plugin/data/queue.json`, copiarlo
a `plugin/queue.json` y pushearlo al repo público
(diegogarciaguzman/enarm-remnote-plugin). El plugin lo recoge solo la
próxima vez que Diego abra RemNote (auto-sync) o cuando pulse
"Sincronizar ahora".

## Origen

Plantilla oficial de RemNote (`remnoteio/remnote-plugin-template-react`,
licencia MIT). SDK: `@remnote/plugin-sdk`.

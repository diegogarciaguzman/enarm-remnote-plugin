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
   lo que falte con esta estructura:

```
ENARM
└─ GINECOLOGÍA Y OBSTETRICIA
     └─ Control prenatal
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
   Nunca borra ni modifica rems existentes.

## Reglas (de Diego)

- NUNCA genera flashcards: solo van como flashcards las del simulador del
  curso (deck Anki), mejoradas como pregunta completa con contexto, que ya
  vienen en el markdown como líneas `pregunta >> respuesta`. El parser de
  markdown de RemNote las convierte en flashcards automáticamente.
- El resumen usa su plantilla exacta (Detalles / Puntos de oro / Puntos a
  reforzar / Generalidades / tema en mayúsculas con sus 8 subsecciones).
- Un documento por tema, bajo el rem padre de su especialidad (`#Especialidad`).

## Limitación conocida (v1)

El markdown no expresa los colores de la plantilla (encabezados grises y
amarillos) ni los tamaños de letra. La estructura y el contenido sí llegan
tal cual. Mejora posible en v2 (API verificada en la documentación del
Plugin SDK): tras crear el árbol, buscar los rems de encabezado y aplicar
`rem.setFontSize('H1' | 'H2' | 'H3')` y `plugin.richText.text('...', ['Yellow' | 'Gray'])`.
No se hizo en v1 para no arriesgar la estructura base.

## Nota del SDK (0.0.14)

La plantilla oficial fija `@remnote/plugin-sdk` en 0.0.14. En esa versión
NO existen `createTreeWithMarkdown` / `createSingleRemWithMarkdown` (son
de versiones más nuevas del SDK). El motor usa la API real de 0.0.14:
`createWithMarkdown()` crea el árbol del tema y `moveRems()` lo coloca
bajo su especialidad (`createRem()` + `setText()` + `moveRems()` para los
rems padre). `npm run check-types` (tsc) pasa limpio y el build genera
`PluginZip.zip`.

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

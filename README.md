# Filtro Elote Ranchero — Esquites Santa Cruz

Prototipo móvil estático, sin frameworks ni compilación. Solo cámara y seguimiento de un rostro. No incluye ruleta, capturas ni compartir.

## Iniciar

Desde esta carpeta ejecuta:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Abre http://localhost:8000 en el navegador de la computadora y pulsa **ACTIVAR CÁMARA**. Cerrar cámara libera el dispositivo; también se libera al salir de la página o cambiar de pestaña.

En un teléfono debes servir estos archivos mediante **HTTPS** y abrir esa dirección en Safari o Chrome. Una dirección HTTP de la computadora en la red local no habilita la cámara del teléfono. `localhost` en el teléfono se refiere al teléfono. No abrir `index.html` con doble clic. Para despliegue posterior, publica `index.html`, `style.css`, `app.js` y `assets/` juntos en cualquier alojamiento estático HTTPS; no requiere backend.

## Tecnología y dependencias

MediaPipe Face Landmarker, `@mediapipe/tasks-vision@0.10.21`, modelo oficial Face Landmarker float16 v1. Descarga JavaScript/WASM de jsDelivr y el modelo de Google cuando activas la cámara, por lo que necesita internet. No transmite imágenes: la inferencia ocurre en el navegador. GPU con respaldo CPU. Un rostro, sin blendshapes ni matrices 3D; inferencia limitada a 30 fps y solo para cuadros nuevos. `detectForVideo` es síncrono; en equipos lentos puede bajar la fluidez. No se ha medido rendimiento en Android/iPhone físicos.

Video y overlay comparten un contenedor reflejado y la misma geometría `object-fit: cover`. La distancia entre ojos controla el ancho, la línea de ojos controla el giro y la distancia vertical a la boca ajusta la altura. Se suavizan posición, escalas y ángulo; sin rostro se elimina la máscara inmediatamente. Se prioriza vista frontal e inclinación lateral: un giro muy grande de perfil requiere una máscara 3D para mantenerse convincente.

Referencia: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js

## Ajustes en app.js

| Parámetro | Uso |
| --- | --- |
| `MASK_SCALE` | Tamaño global; 1 original, 1.1 aumenta 10%. |
| `MASK_OFFSET_X` | Desplazamiento horizontal en píxeles de la imagen; se escala/rota con la máscara. Positivo aparece hacia la izquierda en la vista espejo. |
| `MASK_OFFSET_Y` | Desplazamiento vertical en píxeles de imagen; positivo hacia abajo. |
| `MASK_ROTATION_OFFSET` | Giro adicional en grados antes del espejo. |
| `SMOOTHING` | 0 inmediato; 0.65 predeterminado; mayor valor reduce vibración pero aumenta retraso. Mantener entre 0 y 0.98. |
| `DEBUG` | `true` muestra centro, ojos, contorno y valores; `false` oculta toda la depuración. |
| `PNG_ANCHORS` | Centros normalizados de los huecos, entre 0 y 1, en coordenadas del archivo original. Cambiar al sustituir el PNG por otra composición. |

Para alinear ojos y boca, primero ajusta `PNG_ANCHORS`, después escala y offsets. Guardar y recargar. La máscara es 2D con ajuste vertical: no puede coincidir exactamente con todas las expresiones o giros en profundidad.

## Transparencia verificada

El original se conserva en la raíz; hay una copia idéntica en `assets/elote-ranchero.png`.

PNG de 1024 × 1536, RGBA de 8 bits. Inspección de los datos PNG descomprimidos, sin depender de la apariencia de una previsualización:

- 627 504 píxeles tienen alfa 0.
- Fondo (0,0): alfa 0.
- Centro ojo (390,705): alfa 0.
- Centro ojo (645,705): alfa 1/255, prácticamente transparente.
- Centro boca (515,923): alfa 0.
- El alfa máximo es 254: el dibujo tampoco es completamente opaco; la mayor parte del personaje está cerca de 252–253.

El archivo sí contiene transparencia real. Los huecos tienen un residuo mínimo; para transparencia exactamente cero en toda su superficie se puede limpiar el activo posteriormente. No se ha modificado el original ni ocultado su fondo con CSS. `python verify_png.py` reproduce la inspección (solo biblioteca estándar).

En cada inicio, el navegador verifica transparencia y pequeñas zonas alrededor de los tres anclajes. Si el PNG falta, falla o no pasa la comprobación, usa una máscara temporal creada por canvas con tres aperturas de alfa cero, sin ojos ni boca artificiales. Aparece un aviso de máscara de prueba.

## Prueba manual pendiente en teléfono

1. Abrir por HTTPS, autorizar cámara y comprobar vista selfie.
2. Con buena luz, mirar de frente: ojos y boca reales visibles.
3. Moverse a ambos lados, acercarse, alejarse e inclinarse.
4. Salir del encuadre: desaparece el overlay y aparece el aviso.
5. Volver al encuadre y rotar el teléfono: revisar alineación y recorte.
6. Cerrar cámara y reabrir; probar también permiso denegado y reintento.
7. Cambiar `DEBUG` a `false`: no debe haber puntos, contorno ni valores.

Validaciones realizadas: sintaxis JavaScript; HTTP 200 de entrada, JS, CSS y PNG; HTTP 200 de bundle, WASM y modelo remoto; inspección de alfa. Prueba en vivo en el navegador integrado: cámara activa, rostro detectado, PNG original superpuesto, ojos y boca reales visibles, valores de escala y giro actualizándose y cierre de cámara correcto. Quedan pendientes la calibración final, movimientos amplios y el rendimiento en Android/iPhone físicos.

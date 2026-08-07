# SketchAR Studio

Aplicación web progresiva para preparar referencias y calcarlas sobre papel utilizando la cámara del dispositivo.

## Funciones

- Cámara frontal y trasera con zoom y linterna cuando el dispositivo los permite.
- Referencia táctil con arrastre, zoom, rotación, espejado y bloqueo.
- Conversión local de fotografías a escala de grises, blanco y negro o contornos.
- Ajustes de brillo, contraste, opacidad y modos de fusión.
- Cuadrícula, regla de tercios y guías centrales.
- Deshacer y rehacer transformaciones y ajustes.
- Proyectos con autoguardado local en IndexedDB.
- Capturas PNG y grabación WebM del proceso.
- Instalable y disponible sin conexión como PWA.

## Ejecución local

La cámara y el service worker necesitan un origen seguro. Serví la carpeta con un servidor local en lugar de abrir `index.html` directamente:

```bash
python -m http.server 8080
```

Luego abrí `http://localhost:8080`.

## Privacidad

Las imágenes y los proyectos se procesan y guardan localmente en el navegador. La aplicación no necesita un servidor ni sube contenido.

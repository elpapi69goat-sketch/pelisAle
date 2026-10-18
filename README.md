# pelisAle

Duelos 1 contra 1 entre 35 películas, con estética de Friends, para armar un ranking exacto.

- `app/src/engine.js`: el algoritmo. Tiene tres rondas: merge-insertion (Ford-Johnson, como máximo 136 duelos), verificación de vecinos (34) y dudas, hasta llegar a unos 200 duelos. Los empates se resuelven por transitividad.
- `app/src/app.js`, `styles.css`, `index.html`: la interfaz, pensada para el celular.
- `app/posters/`: los pósters recortados de las capturas de Letterboxd (`tools/crop_posters.py`).

```sh
node app/build.mjs           # arma app/dist/index.html (autocontenido + pósters)
node app/test/engine.test.js # simula usuarios y verifica el algoritmo
```

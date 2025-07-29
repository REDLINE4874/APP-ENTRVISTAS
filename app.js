const express = require('express');
const path = require('path');
const dayjs = require('dayjs'); // 1. Importa dayjs
const app = express();
const entrevistasRouter = require('./routes/entrevistas');

// Configuración de middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 2. Agrega dayjs a las variables locales (accesible en TODAS las vistas)
app.locals.dayjs = dayjs; // ¡Esto es clave!
app.locals.basePath = '/entrevistas';

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Ruta base para el router de entrevistas
app.use('/entrevistas', entrevistasRouter);

// Ruta raíz redirige a entrevistas
app.get('/', (req, res) => {
  res.redirect('/entrevistas');
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
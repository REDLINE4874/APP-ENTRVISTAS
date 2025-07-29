const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db/entrevistas.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS entrevistas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    celular TEXT,
    fecha TEXT,
    hora TEXT,
    edad INTEGER,
    campania TEXT,
    observaciones TEXT,
    completada INTEGER DEFAULT 0,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
});

module.exports = db;

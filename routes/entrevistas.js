const express = require("express");
const router = express.Router();
const db = require("../db/database");
const XLSX = require("xlsx");
const dayjs = require("dayjs");
const rateLimit = require("express-rate-limit");

// Configuración de rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite por IP
  message: "Demasiadas peticiones, por favor intenta más tarde"
});

// Middleware de sanitización
const sanitizeInput = (req, res, next) => {
  for (const key in req.body) {
    if (typeof req.body[key] === 'string') {
      req.body[key] = req.body[key].replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }
  next();
};

// Helper para manejo de errores
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Mostrar entrevistas del día actual con paginación
router.get("/", asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const hoy = dayjs().format("YYYY-MM-DD");
  const offset = (page - 1) * limit;

  const [rows, count] = await Promise.all([
    new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM entrevistas 
         WHERE fecha = ? AND completada = 0 
         ORDER BY hora ASC 
         LIMIT ? OFFSET ?`,
        [hoy, limit, offset],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    }),
    new Promise((resolve, reject) => {
      db.get(
        "SELECT COUNT(*) as total FROM entrevistas WHERE fecha = ? AND completada = 0",
        [hoy],
        (err, count) => err ? reject(err) : resolve(count)
      );
    })
  ]);

  res.render("index", {
    entrevistas: rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count.total / limit),
      totalItems: count.total
    },
    error: null,
    currentPath: req.path
  });
}));

// Mostrar todas las entrevistas con filtros
router.get("/todos", asyncHandler(async (req, res) => {
  const { fechaInicio, fechaFin, estado, campania } = req.query;

  if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
    return res.render("todos", {
      entrevistasAgrupadas: {},
      error: "La fecha inicial no puede ser mayor a la fecha final",
      currentPath: req.path,
      fechaInicio: fechaInicio || "",
      fechaFin: fechaFin || "",
      estado: estado || "",
      campania: campania || "",
      campanias: []
    });
  }

  let sql = "SELECT * FROM entrevistas WHERE 1=1";
  const params = [];

  if (fechaInicio) {
    sql += " AND fecha >= ?";
    params.push(fechaInicio);
  }

  if (fechaFin) {
    sql += " AND fecha <= ?";
    params.push(fechaFin);
  }

  if (estado !== undefined && estado !== "") {
    sql += " AND completada = ?";
    params.push(parseInt(estado));
  }

  if (campania) {
    sql += " AND campania = ?";
    params.push(campania);
  }

  sql += " ORDER BY fecha DESC, hora ASC";

  const rows = await new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });

  // Calcular estadísticas
  const total = rows.length;
  const asistieron = rows.filter((e) => e.completada === 1).length;
  const asistencia = total > 0 ? Math.round((asistieron / total) * 100) : 0;

  // Obtener campañas únicas
  const campanias = [...new Set(rows.map((e) => e.campania))].filter(Boolean);

  // Agrupar por fecha
  const agrupadas = rows.reduce((acc, entrevista) => {
    if (!acc[entrevista.fecha]) acc[entrevista.fecha] = [];
    acc[entrevista.fecha].push(entrevista);
    return acc;
  }, {});

  res.render("todos", {
    entrevistasAgrupadas: agrupadas,
    estadisticas: {
      total,
      asistencia,
      noAsistencia: 100 - asistencia,
      asistieron,
      noAsistieron: total - asistieron
    },
    fechaInicio: fechaInicio || "",
    fechaFin: fechaFin || "",
    estado: estado || "",
    campania: campania || "",
    campanias,
    currentPath: req.path,
    error: null
  });
}));

// Mostrar formulario para nueva entrevista
router.get("/nueva", (req, res) => {
  res.render("nueva", {
    currentPath: req.path,
    error: req.query.error
  });
});

// Registrar nueva entrevista con validación mejorada
router.post("/nueva", sanitizeInput, asyncHandler(async (req, res) => {
  const { nombre, celular, fecha, hora, edad, campania, observaciones } = req.body;

  // Validaciones
  if (!nombre || !celular || !fecha || !hora) {
    return res.redirect("/entrevistas/nueva?error=Faltan campos obligatorios");
  }

  if (!/^\d{10}$/.test(celular)) {
    return res.redirect("/entrevistas/nueva?error=Teléfono inválido (debe tener 10 dígitos)");
  }

  if (edad && (isNaN(edad) || edad < 18 || edad > 100)) {
    return res.redirect("/entrevistas/nueva?error=Edad inválida (debe ser entre 18 y 100)");
  }

  await new Promise((resolve, reject) => {
    const stmt = db.prepare(
      "INSERT INTO entrevistas (nombre, celular, fecha, hora, edad, campania, observaciones, completada) VALUES (?, ?, ?, ?, ?, ?, ?, 0)"
    );
    stmt.run(
      [nombre, celular, fecha, hora, edad || null, campania || null, observaciones || null],
      (err) => err ? reject(err) : resolve()
    );
    stmt.finalize();
  });

  res.redirect("/entrevistas");
}));

// Actualizar estado de entrevista con rate limiting
router.post("/completar/:id", apiLimiter, sanitizeInput, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const estado = req.body.estado === "1" ? 1 : 0;

  await new Promise((resolve, reject) => {
    db.run(
      "UPDATE entrevistas SET completada = ? WHERE id = ?",
      [estado, id],
      (err) => err ? reject(err) : resolve()
    );
  });

  res.json({ success: true });
}));

// Descargar Excel con mejor formato
router.get("/descargar", asyncHandler(async (req, res) => {
  const { fechaInicio, fechaFin, estado, campania } = req.query;

  let sql = "SELECT * FROM entrevistas WHERE 1=1";
  const params = [];

  if (fechaInicio) {
    sql += " AND fecha >= ?";
    params.push(fechaInicio);
  }

  if (fechaFin) {
    sql += " AND fecha <= ?";
    params.push(fechaFin);
  }

  if (estado !== undefined && estado !== "") {
    sql += " AND completada = ?";
    params.push(parseInt(estado));
  }

  if (campania) {
    sql += " AND campania = ?";
    params.push(campania);
  }

  sql += " ORDER BY fecha DESC, hora ASC";

  const rows = await new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });

  // Formatear datos para Excel
  const datos = rows.map((e) => ({
    Nombre: e.nombre,
    Celular: e.celular,
    Fecha: dayjs(e.fecha).format("DD/MM/YYYY"),
    Hora: e.hora,
    Edad: e.edad,
    Campaña: e.campania,
    Estado: e.completada ? "Asistió" : "No asistió",
    Observaciones: e.observaciones
  }));

  const worksheet = XLSX.utils.json_to_sheet(datos);
  const workbook = XLSX.utils.book_new();
  
  // Configurar anchos de columna
  worksheet['!cols'] = [
    {wch: 20}, {wch: 15}, {wch: 12}, 
    {wch: 8}, {wch: 6}, {wch: 20}, 
    {wch: 15}, {wch: 30}
  ];
  
  // Agregar filtros
  worksheet['!autofilter'] = {ref: "A1:H" + (rows.length + 1)};
  
  XLSX.utils.book_append_sheet(workbook, worksheet, "Entrevistas");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Disposition", 'attachment; filename="entrevistas.xlsx"');
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buffer);
}));

// Manejador de errores global
router.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { 
    message: 'Ocurrió un error en el servidor',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

module.exports = router;
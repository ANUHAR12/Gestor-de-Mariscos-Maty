const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const db = new Database('pos_mariscos.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────────────
//  ESQUEMA DE BASE DE DATOS
// ─────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('Administrador','Cajero','Mesero')),
    pin TEXT NOT NULL,
    token TEXT DEFAULT '',
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    ip TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    expires_at TEXT DEFAULT (datetime('now','+12 hours')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS retiros_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    monto REAL NOT NULL,
    concepto TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    fecha TEXT DEFAULT (datetime('now','localtime')),
    mesa TEXT NOT NULL,
    subtotal REAL NOT NULL,
    propina REAL DEFAULT 0,
    metodo TEXT NOT NULL,
    propina_metodo TEXT DEFAULT 'Efectivo',
    items TEXT NOT NULL,
    cancelado INTEGER DEFAULT 0,
    motivo_cancelacion TEXT DEFAULT '',
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS estado_app (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mesas TEXT DEFAULT '[]',
    virtuales TEXT DEFAULT '[]',
    comandas TEXT DEFAULT '[]',
    menu TEXT DEFAULT '{}'
  );
`);

// ─────────────────────────────────────────────────────
//  MIGRACIÓN: bases de datos antiguas que usaban turnos.
//  Se conservan ventas y gastos históricos quitando la
//  dependencia de turno_id; el corte de caja ahora se
//  calcula por rango de fechas, sin bloquear la operación.
// ─────────────────────────────────────────────────────
function columnaExiste(tabla, columna) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().some(c => c.name === columna);
}

if (columnaExiste('ventas', 'turno_id')) {
  db.exec(`
    ALTER TABLE ventas RENAME TO ventas_legado;
    CREATE TABLE ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      fecha TEXT DEFAULT (datetime('now','localtime')),
      mesa TEXT NOT NULL,
      subtotal REAL NOT NULL,
      propina REAL DEFAULT 0,
      metodo TEXT NOT NULL,
      propina_metodo TEXT DEFAULT 'Efectivo',
      items TEXT NOT NULL,
      cancelado INTEGER DEFAULT 0,
      motivo_cancelacion TEXT DEFAULT '',
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
    INSERT INTO ventas (id, usuario_id, fecha, mesa, subtotal, propina, metodo, propina_metodo, items, cancelado, motivo_cancelacion)
      SELECT id, usuario_id, fecha, mesa, subtotal, propina, metodo, propina_metodo, items, cancelado, motivo_cancelacion FROM ventas_legado;
    DROP TABLE ventas_legado;
  `);
}

if (columnaExiste('retiros_caja', 'turno_id')) {
  db.exec(`
    ALTER TABLE retiros_caja RENAME TO retiros_caja_legado;
    CREATE TABLE retiros_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      monto REAL NOT NULL,
      concepto TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
    INSERT INTO retiros_caja (id, usuario_id, monto, concepto, created_at)
      SELECT id, usuario_id, monto, concepto, created_at FROM retiros_caja_legado;
    DROP TABLE retiros_caja_legado;
  `);
}

try { db.exec("DROP TABLE IF EXISTS turnos"); } catch (e) {}

// ─────────────────────────────────────────────────────
//  ASEGURAR FILA ÚNICA DE ESTADO (mesas/virtuales/comandas/menu) (REPARADO)
// ─────────────────────────────────────────────────────
const filaEstado = db.prepare('SELECT COUNT(*) as cuenta FROM estado_app').get();
if (filaEstado.cuenta === 0) {
  db.prepare(`INSERT INTO estado_app (id, mesas, virtuales, comandas, menu) VALUES (1, '[]', '[]', '[]', '{}')`).run();
}

// ─────────────────────────────────────────────────────
//  AUTOGENERAR ADMINISTRADOR SI LA BD ESTÁ VACÍA (AÑADIDO)
// ─────────────────────────────────────────────────────
const verificarAdmin = db.prepare("SELECT COUNT(*) as cuenta FROM usuarios").get();
if (verificarAdmin.cuenta === 0) {
  db.prepare(`
    INSERT INTO usuarios (nombre, rol, pin, activo) 
    VALUES ('Administrador', 'Administrador', '1234', 1)
  `).run();
  console.log("▲ [Base de Datos] Base de datos vacía detectada en Railway.");
  console.log("▲ [Base de Datos] Usuario Administrador creado automáticamente (PIN: 1234)");
}

// ─── MIDDLEWARES DE AUTH ───
function requireRol(...rolesPermitidos) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
    const token = authHeader.replace('Bearer ', '');
    const sesion = db.prepare('SELECT * FROM sesiones WHERE token = ? AND expires_at > datetime(\'now\',\'localtime\')').get(token);
    if (!sesion) return res.status(401).json({ error: 'Sesión expirada o inválida' });
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(sesion.usuario_id);
    if (!user || !rolesPermitidos.includes(user.rol)) return res.status(403).json({ error: 'Permisos insuficientes' });
    req.usuario = user;
    next();
  };
}

// ─── ENDPOINTS DE AUTH ───
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN requerido' });
  const user = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE pin = ? AND activo = 1').get(pin);
  if (!user) return res.status(401).json({ error: 'PIN incorrecto' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (usuario_id, token) VALUES (?, ?)').run(user.id, token);
  res.json({ token, usuario: user });
});

app.get('/api/estado', (req, res) => {
  // Ventas y gastos del día en curso, para el resumen que se ve en el panel de administración.
  // El corte de caja completo por rango de fechas vive en /api/reportes/corte.
  const ventas = db.prepare("SELECT * FROM ventas WHERE date(fecha) = date('now','localtime')").all();
  const gastos = db.prepare("SELECT * FROM retiros_caja WHERE date(created_at) = date('now','localtime')").all();
  const usuarios = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE activo = 1').all();

  const estado = db.prepare('SELECT mesas, virtuales, comandas, menu FROM estado_app WHERE id = 1').get();
  let mesas = [], virtuales = [], comandas = [], menu = {};
  if (estado) {
    try { mesas = JSON.parse(estado.mesas || '[]'); } catch (e) { mesas = []; }
    try { virtuales = JSON.parse(estado.virtuales || '[]'); } catch (e) { virtuales = []; }
    try { comandas = JSON.parse(estado.comandas || '[]'); } catch (e) { comandas = []; }
    try { menu = JSON.parse(estado.menu || '{}'); } catch (e) { menu = {}; }
  }

  res.json({
    ventas,
    gastos,
    usuarios,
    mesas,
    virtuales,
    comandas,
    menu
  });
});

app.post('/api/estado', (req, res) => {
  const { mesas, virtuales, comandas, menu } = req.body;
  db.prepare('UPDATE estado_app SET mesas = ?, virtuales = ?, comandas = ?, menu = ? WHERE id = 1').run(
    JSON.stringify(mesas || []),
    JSON.stringify(virtuales || []),
    JSON.stringify(comandas || []),
    JSON.stringify(menu || {})
  );
  res.json({ okey: true });
});

// ─── ENDPOINTS DE GESTIÓN DE USUARIOS (Administrador, Cajero, Mesero) ───
const ROLES_VALIDOS = ['Administrador', 'Cajero', 'Mesero'];

// Lista completa (activos e inactivos) para el panel de administración. No incluye el PIN.
app.get('/api/usuarios', requireRol('Administrador'), (req, res) => {
  const usuarios = db.prepare('SELECT id, nombre, rol, activo, created_at FROM usuarios ORDER BY activo DESC, nombre ASC').all();
  res.json({ okey: true, usuarios });
});

app.post('/api/usuarios', requireRol('Administrador'), (req, res) => {
  const { nombre, rol, pin } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (!pin || !/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'El PIN debe tener entre 4 y 6 dígitos' });
  const pinExistente = db.prepare('SELECT id FROM usuarios WHERE pin = ? AND activo = 1').get(pin);
  if (pinExistente) return res.status(400).json({ error: 'Ese PIN ya está en uso por otro usuario activo' });

  const info = db.prepare('INSERT INTO usuarios (nombre, rol, pin, activo) VALUES (?, ?, ?, 1)').run(nombre.trim(), rol, pin);
  const usuario = db.prepare('SELECT id, nombre, rol, activo, created_at FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
  res.json({ okey: true, usuario });
});

app.put('/api/usuarios/:id', requireRol('Administrador'), (req, res) => {
  const { nombre, rol, pin } = req.body;
  const existente = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });

  if (pin) {
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'El PIN debe tener entre 4 y 6 dígitos' });
    const pinExistente = db.prepare('SELECT id FROM usuarios WHERE pin = ? AND activo = 1 AND id != ?').get(pin, req.params.id);
    if (pinExistente) return res.status(400).json({ error: 'Ese PIN ya está en uso por otro usuario activo' });
    db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, pin = ? WHERE id = ?').run(nombre.trim(), rol, pin, req.params.id);
  } else {
    db.prepare('UPDATE usuarios SET nombre = ?, rol = ? WHERE id = ?').run(nombre.trim(), rol, req.params.id);
  }
  const usuario = db.prepare('SELECT id, nombre, rol, activo, created_at FROM usuarios WHERE id = ?').get(req.params.id);
  res.json({ okey: true, usuario });
});

// Activar/desactivar en vez de borrar, para conservar la integridad de ventas y gastos ya registrados.
app.post('/api/usuarios/:id/toggle', requireRol('Administrador'), (req, res) => {
  const existente = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (existente.rol === 'Administrador' && existente.activo === 1) {
    const adminsActivos = db.prepare("SELECT COUNT(*) as cuenta FROM usuarios WHERE rol = 'Administrador' AND activo = 1").get();
    if (adminsActivos.cuenta <= 1) return res.status(400).json({ error: 'No puedes desactivar al único Administrador activo' });
  }
  const nuevoEstado = existente.activo ? 0 : 1;
  db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(nuevoEstado, req.params.id);
  res.json({ okey: true, activo: nuevoEstado });
});

// ─── ENDPOINTS DE VENTAS Y GASTOS ───
app.post('/api/ventas', (req, res) => {
  const { mesa, subtotal, propina, metodo, propina_metodo, items, mesero_id } = req.body;
  if (!mesa || subtotal === undefined) return res.status(400).json({ error: 'Datos de venta incompletos' });

  const info = db.prepare(`INSERT INTO ventas (usuario_id, mesa, subtotal, propina, metodo, propina_metodo, items)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(mesero_id || 1, mesa, subtotal, propina || 0, metodo, propina_metodo || 'Efectivo', JSON.stringify(items));

  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(info.lastInsertRowid);
  res.json({ okey: true, venta });
});

// Cancelar una venta ya registrada (con motivo) para que no se contabilice en el corte de caja
app.post('/api/ventas/:id/cancelar', requireRol('Administrador','Cajero'), (req, res) => {
  const { motivo } = req.body;
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(req.params.id);
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
  db.prepare("UPDATE ventas SET cancelado = 1, motivo_cancelacion = ? WHERE id = ?").run(motivo || '', req.params.id);
  res.json({ okey: true });
});

app.post('/api/retiros', (req, res) => {
  const { usuario_id, monto, concepto } = req.body;
  if (!concepto || !monto || monto <= 0) return res.status(400).json({ error: 'Concepto y monto son requeridos' });
  const info = db.prepare('INSERT INTO retiros_caja (usuario_id, monto, concepto) VALUES (?, ?, ?)').run(usuario_id || 1, monto, concepto);
  const gasto = db.prepare('SELECT * FROM retiros_caja WHERE id = ?').get(info.lastInsertRowid);
  res.json({ okey: true, gasto });
});

// Eliminar un gasto/retiro (antes solo se borraba en el navegador y "resucitaba" al refrescar)
app.delete('/api/retiros/:id', (req, res) => {
  const info = db.prepare('DELETE FROM retiros_caja WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Gasto no encontrado' });
  res.json({ okey: true });
});

// ─── CORTE DE CAJA POR RANGO DE FECHAS ───
// Ya no depende de "abrir/cerrar turno": el sistema siempre está operando y el
// corte se genera bajo demanda para el rango de fechas que se necesite (hoy,
// ayer, la semana, un día específico, etc.), igual que en Soft Restaurant.
app.get('/api/reportes/corte', requireRol('Administrador', 'Cajero'), (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = req.query.desde || hoy;
  const hasta = req.query.hasta || hoy;

  const ventas = db.prepare(
    "SELECT * FROM ventas WHERE date(fecha) BETWEEN date(?) AND date(?) AND cancelado = 0 ORDER BY fecha ASC"
  ).all(desde, hasta);
  const ventasCanceladas = db.prepare(
    "SELECT * FROM ventas WHERE date(fecha) BETWEEN date(?) AND date(?) AND cancelado = 1 ORDER BY fecha ASC"
  ).all(desde, hasta);
  const gastos = db.prepare(
    "SELECT * FROM retiros_caja WHERE date(created_at) BETWEEN date(?) AND date(?) ORDER BY created_at ASC"
  ).all(desde, hasta);

  let efectivo = 0, tarjeta = 0, transferencia = 0, propinas = 0;
  for (const v of ventas) {
    propinas += v.propina || 0;
    if (v.metodo.includes('Efectivo')) efectivo += v.subtotal;
    else if (v.metodo.includes('Tarjeta')) tarjeta += v.subtotal;
    else transferencia += v.subtotal;
  }
  const totalGastos = gastos.reduce((a, g) => a + g.monto, 0);
  const totalBruto = efectivo + tarjeta + transferencia;
  const totalNeto = totalBruto - totalGastos;

  res.json({
    okey: true,
    rango: { desde, hasta },
    desglose: {
      efectivo, tarjeta, transferencia, propinas,
      gastos: totalGastos, totalBruto, totalNeto
    },
    ventas,
    ventasCanceladas,
    gastosDetalle: gastos
  });
});

// Borrar las ventas del día (usado al cerrar caja después de imprimir el corte).
// No toca las ventas de otros días.
app.delete('/api/ventas/dia', requireRol('Administrador', 'Cajero'), (req, res) => {
  const info = db.prepare("DELETE FROM ventas WHERE date(fecha) = date('now','localtime')").run();
  res.json({ okey: true, eliminadas: info.changes });
});

// Borrar los gastos/retiros del día (usado junto con /api/ventas/dia al cerrar caja,
// para que el balance también quede en blanco). No toca gastos de otros días.
app.delete('/api/retiros/dia', requireRol('Administrador', 'Cajero'), (req, res) => {
  const info = db.prepare("DELETE FROM retiros_caja WHERE date(created_at) = date('now','localtime')").run();
  res.json({ okey: true, eliminados: info.changes });
});

// ─── PARA REEMPLAZAR EL setInterval DE APP.JS (REPARADO) ───
app.get('/api/comandas/desde/:timestamp', (req, res) => {
  res.json({ comandas: [] });
});

// Enrutado SPA - Servir index.html para rutas no reconocidas
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
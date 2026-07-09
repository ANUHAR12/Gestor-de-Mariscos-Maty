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
//  SCHEMA (REPARADO)
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

  CREATE TABLE IF NOT EXISTS turnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    fondo_inicial REAL DEFAULT 0,
    fecha_apertura TEXT DEFAULT (datetime('now','localtime')),
    fecha_cierre TEXT DEFAULT '',
    total_efectivo_sistema REAL DEFAULT 0,
    total_tarjeta_sistema REAL DEFAULT 0,
    total_transferencia_sistema REAL DEFAULT 0,
    total_efectivo_real REAL DEFAULT 0,
    total_tarjeta_real REAL DEFAULT 0,
    total_transferencia_real REAL DEFAULT 0,
    total_propinas REAL DEFAULT 0,
    total_gastos REAL DEFAULT 0,
    total_ventas_bruto REAL DEFAULT 0,
    diferencia REAL DEFAULT 0,
    estado TEXT DEFAULT 'abierto' CHECK(estado IN ('abierto','cerrado')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS retiros_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turno_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    monto REAL NOT NULL,
    concepto TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (turno_id) REFERENCES turnos(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turno_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    fecha TEXT DEFAULT (datetime('now','localtime')),
    mesa TEXT NOT NULL,
    subtotal REAL NOT NULL,
    propina REAL DEFAULT 0,
    metodo TEXT NOT NULL,
    propina_metodo TEXT DEFAULT 'Efectivo',
    items TEXT NOT NULL,
    cancelado INTEGER DEFAULT 0,
    FOREIGN KEY (turno_id) REFERENCES turnos(id),
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
  const turnoActivo = db.prepare('SELECT * FROM turnos WHERE estado = \'abierto\' ORDER BY id DESC LIMIT 1').get();
  let ventas = [];
  let gastos = [];
  if (turnoActivo) {
    ventas = db.prepare('SELECT * FROM ventas WHERE turno_id = ?').all(turnoActivo.id);
    gastos = db.prepare('SELECT * FROM retiros_caja WHERE turno_id = ?').all(turnoActivo.id);
  }
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
    turnoActivo: turnoActivo || null,
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

// ─── ENDPOINTS DE VENTAS Y RETIROS ───
app.post('/api/ventas', (req, res) => {
  const { mesa, subtotal, propina, metodo, propina_metodo, items, mesero_id, turno_id } = req.body;
  if (!turno_id) return res.status(400).json({ error: 'No hay turno activo para registrar la venta' });
  
  db.prepare(`INSERT INTO ventas (turno_id, usuario_id, mesa, subtotal, propina, metodo, propina_metodo, items) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(turno_id, mesero_id || 1, mesa, subtotal, propina || 0, metodo, propina_metodo || 'Efectivo', JSON.stringify(items));
  
  res.json({ okey: true });
});

app.post('/api/retiros', (req, res) => {
  const { turno_id, usuario_id, monto, concepto } = req.body;
  db.prepare('INSERT INTO retiros_caja (turno_id, usuario_id, monto, concepto) VALUES (?, ?, ?, ?)').run(turno_id, usuario_id, monto, concepto);
  res.json({ okey: true });
});

// ─── CONTROL DE TURNOS ───
app.post('/api/turno/abrir', (req, res) => {
  const { usuario_id, fondo_inicial } = req.body;
  const yaAbierto = db.prepare('SELECT id FROM turnos WHERE estado = \'abierto\'').get();
  if (yaAbierto) return res.status(400).json({ error: 'Ya existe un turno abierto actualmente' });
  
  db.prepare('INSERT INTO turnos (usuario_id, fondo_inicial) VALUES (?, ?)').run(usuario_id, fondo_inicial);
  res.json({ okey: true, mensaje: 'Turno abierto correctamente' });
});

app.post('/api/turno/cerrar', (req, res) => {
  const { usuario_id, total_efectivo_real } = req.body;
  const turno = db.prepare('SELECT * FROM turnos WHERE estado = \'abierto\' ORDER BY id DESC LIMIT 1').get();
  if (!turno) return res.status(400).json({ error: 'No hay ningún turno abierto para cerrar' });
  
  const ventas = db.prepare('SELECT * FROM ventas WHERE turno_id = ? AND cancelado = 0').all(turno.id);
  const retiros = db.prepare('SELECT COALESCE(SUM(monto),0) as total FROM retiros_caja WHERE turno_id = ?').get(turno.id);
  
  let efec = turno.fondo_inicial, tarj = 0, trans = 0, propinas = 0;
  for (const v of ventas) {
    propinas += v.propina || 0;
    if (v.metodo.includes('Efectivo')) efec += v.subtotal;
    else if (v.metodo.includes('Tarjeta')) tarj += v.subtotal;
    else trans += v.subtotal;
  }
  
  efec -= retiros.total;
  const diferencia = total_efectivo_real - efec;
  
  db.prepare(`UPDATE turnos SET fecha_cierre=datetime('now','localtime'), total_efectivo_sistema=?, total_tarjeta_sistema=?, total_transferencia_sistema=?, total_efectivo_real=?, total_propinas=?, total_gastos=?, total_ventas_bruto=?, diferencia=?, estado='cerrado' WHERE id=?`)
    .run(efec, tarj, trans, total_efectivo_real, propinas, retiros.total, efec+tarj+trans, diferencia, turno.id);
  res.json({ okey: true, mensaje: 'Turno cerrado', diferencia });
});

// ─── REPORTES ───
app.get('/api/reportes/caja', requireRol('Administrador','Cajero'), (req, res) => {
  let efec = 0, tarj = 0, trans = 0, prop = 0;
  const ventas = db.prepare('SELECT * FROM ventas WHERE cancelado = 0').all();
  for (const v of ventas) { prop += v.propina||0; if (v.metodo.includes('Efectivo')) efec += v.subtotal||0; else if (v.metodo.includes('Tarjeta')) tarj += v.subtotal||0; else trans += v.subtotal||0; }
  const gastos = db.prepare('SELECT COALESCE(SUM(monto),0) as t FROM retiros_caja').get().t;
  res.json({ efectivo: efec, tarjeta: tarj, transferencia: trans, propinas: prop, gastos, balance: efec+tarj+trans-gastos });
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
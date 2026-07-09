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
//  SCHEMA
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
    fecha_cierre TEXT,
    total_efectivo REAL DEFAULT 0,
    total_tarjeta REAL DEFAULT 0,
    total_transferencia REAL DEFAULT 0,
    total_propinas REAL DEFAULT 0,
    total_gastos REAL DEFAULT 0,
    total_ventas_bruto REAL DEFAULT 0,
    diferencia REAL DEFAULT 0,
    estado TEXT DEFAULT 'abierto',
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS retiros_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turno_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    concepto TEXT NOT NULL,
    monto REAL NOT NULL,
    fecha TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (turno_id) REFERENCES turnos(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS menu (
    id TEXT PRIMARY KEY,
    categoria TEXT NOT NULL,
    nombre TEXT NOT NULL,
    precio REAL NOT NULL,
    agotado INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS insumos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    unidad TEXT DEFAULT 'pieza',
    stock REAL DEFAULT 0,
    stock_minimo REAL DEFAULT 5
  );

  CREATE TABLE IF NOT EXISTS recetas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platillo_id TEXT NOT NULL,
    insumo_id INTEGER NOT NULL,
    cantidad REAL NOT NULL,
    FOREIGN KEY (platillo_id) REFERENCES menu(id) ON DELETE CASCADE,
    FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mesas (
    numero INTEGER PRIMARY KEY,
    estado TEXT DEFAULT 'libre'
  );

  CREATE TABLE IF NOT EXISTS mesa_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_numero INTEGER NOT NULL,
    platillo_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    precio REAL NOT NULL,
    cantidad INTEGER DEFAULT 1,
    nota TEXT DEFAULT '',
    enviado INTEGER DEFAULT 0,
    FOREIGN KEY (mesa_numero) REFERENCES mesas(numero)
  );

  CREATE TABLE IF NOT EXISTS virtuales (
    id TEXT PRIMARY KEY,
    tipo TEXT DEFAULT 'Llevar',
    cliente TEXT DEFAULT 'Cliente General',
    estado TEXT DEFAULT 'ocupada',
    mesero_id INTEGER,
    FOREIGN KEY (mesero_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS virtual_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    virtual_id TEXT NOT NULL,
    platillo_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    precio REAL NOT NULL,
    cantidad INTEGER DEFAULT 1,
    nota TEXT DEFAULT '',
    enviado INTEGER DEFAULT 0,
    FOREIGN KEY (virtual_id) REFERENCES virtuales(id)
  );

  CREATE TABLE IF NOT EXISTS comandas (
    id TEXT PRIMARY KEY,
    origen TEXT NOT NULL,
    horaEntrada TEXT NOT NULL,
    estado TEXT DEFAULT 'activa'
  );

  CREATE TABLE IF NOT EXISTS comanda_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comanda_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    cantidad INTEGER DEFAULT 1,
    nota TEXT DEFAULT '',
    estado TEXT DEFAULT 'pendiente',
    FOREIGN KEY (comanda_id) REFERENCES comandas(id)
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    mesa TEXT NOT NULL,
    subtotal REAL NOT NULL,
    propina REAL NOT NULL,
    propina_metodo TEXT DEFAULT 'Efectivo',
    metodo TEXT NOT NULL,
    items_json TEXT NOT NULL,
    mesero_id INTEGER,
    turno_id INTEGER,
    cancelado INTEGER DEFAULT 0,
    cancelado_por TEXT DEFAULT '',
    cancelado_razon TEXT DEFAULT '',
    FOREIGN KEY (turno_id) REFERENCES turnos(id)
  );

  CREATE TABLE IF NOT EXISTS pagos_mixtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL,
    metodo TEXT NOT NULL,
    monto REAL NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id)
  );

  CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    insumo_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('entrada','salida','ajuste')),
    cantidad REAL NOT NULL,
    referencia TEXT DEFAULT '',
    fecha TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (insumo_id) REFERENCES insumos(id)
  );
`);
//  CREAR ADMINISTRADOR AUTOMÁTICO EN LA NUBE
// ─────────────────────────────────────────────────────
const verificarAdmin = db.prepare("SELECT COUNT(*) as cuenta FROM usuarios").get();
if (verificarAdmin.cuenta === 0) {
  // Aquí insertamos el usuario Administrador inicial con el PIN '1234'
  db.prepare(`
    INSERT INTO usuarios (nombre, rol, pin, activo) 
    VALUES ('Administrador', 'Administrador', '1234', 1)
  `).run();
  console.log("▲ [Base de Datos] Usuario Administrador por defecto creado (PIN: 1234)");
}
// ─────────────────────────────────────────────────────
//  DATOS INICIALES
// ─────────────────────────────────────────────────────
function inicializarDatos() {
  if (db.prepare('SELECT COUNT(*) as cnt FROM usuarios').get().cnt === 0) {
    const ins = db.prepare('INSERT INTO usuarios (nombre, rol, pin) VALUES (?, ?, ?)');
    ins.run('Administrador', 'Administrador', '1234');
    ins.run('Cajero Principal', 'Cajero', '5678');
    ins.run('Mesero General', 'Mesero', '9012');
  }
  if (db.prepare('SELECT COUNT(*) as cnt FROM mesas').get().cnt === 0) {
    const ins = db.prepare('INSERT INTO mesas (numero, estado) VALUES (?, ?)');
    for (let i = 1; i <= 10; i++) ins.run(i, 'libre');
  }
  if (db.prepare('SELECT COUNT(*) as cnt FROM menu').get().cnt === 0) {
    const ins = db.prepare('INSERT INTO menu (id, categoria, nombre, precio) VALUES (?, ?, ?, ?)');
    const items = [
      ['m1','Camarones','Camarones Empanizados',220], ['m2','Camarones','Aguachile Rojo',240],
      ['m3','Camarones','Aguachile Verde',240], ['m4','Filetes','Filete a la Plancha',210],
      ['m5','Filetes','Filete Empanizado',220], ['m6','Burritos','Burrito de Camarón',180],
      ['m7','Bebidas','Agua Fresca',35], ['m8','Bebidas','Refresco',30],
      ['m9','Camarones','Ceviche de Camarón',200], ['m10','Filetes','Mojarra Frita',190]
    ];
    for (const [id, cat, nom, prec] of items) ins.run(id, cat, nom, prec);
  }
  if (db.prepare('SELECT COUNT(*) as cnt FROM insumos').get().cnt === 0) {
    const ins = db.prepare('INSERT INTO insumos (nombre, unidad, stock, stock_minimo) VALUES (?, ?, ?, ?)');
    ins.run('Camarón', 'kg', 20, 2); ins.run('Filete de Pescado', 'kg', 15, 2);
    ins.run('Mojarra', 'pieza', 20, 5); ins.run('Tortilla', 'kg', 10, 2);
    ins.run('Limon', 'kg', 8, 2); ins.run('Cebolla', 'kg', 10, 2);
    ins.run('Jitomate', 'kg', 8, 2); ins.run('Aguacate', 'pieza', 15, 5);
    ins.run('Refresco', 'pieza', 50, 10); ins.run('Agua Embotellada', 'pieza', 40, 10);
  }
  if (db.prepare('SELECT COUNT(*) as cnt FROM recetas').get().cnt === 0) {
    const ins = db.prepare('INSERT INTO recetas (platillo_id, insumo_id, cantidad) VALUES (?, ?, ?)');
    ins.run('m1', 1, 0.3); ins.run('m1', 4, 0.1); ins.run('m1', 5, 0.05);
    ins.run('m2', 1, 0.25); ins.run('m2', 6, 0.1); ins.run('m2', 5, 0.1);
    ins.run('m4', 2, 0.3); ins.run('m4', 5, 0.05);
    ins.run('m6', 1, 0.15); ins.run('m6', 4, 0.2); ins.run('m6', 8, 0.05);
    ins.run('m8', 9, 1); ins.run('m7', 10, 1);
  }
}
inicializarDatos();

// ─────────────────────────────────────────────────────
//  MIDDLEWARE - AUTENTICACIÓN BACKEND
// ─────────────────────────────────────────────────────

// Verifica token de sesión. Si no hay token, permite pasar pero marca req.usuario = null
function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'] || '';
  if (!token) { req.usuario = null; return next(); }
  const sesion = db.prepare(`
    SELECT s.*, u.nombre, u.rol FROM sesiones s 
    JOIN usuarios u ON u.id = s.usuario_id 
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  req.usuario = sesion ? { id: sesion.usuario_id, nombre: sesion.nombre, rol: sesion.rol, token } : null;
  next();
}

// Requiere autenticación + rol específico
function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Se requiere autenticación. Usa /api/auth/login primero.' });
    if (roles.length && !roles.includes(req.usuario.rol)) return res.status(403).json({ error: `Se requiere rol: ${roles.join(' o ')}` });
    next();
  };
}

app.use(authMiddleware);

// ─────────────────────────────────────────────────────
//  AUTENTICACIÓN BACKEND (segura)
// ─────────────────────────────────────────────────────

// Login general (contraseña de acceso al sistema)
const ACCESS_PASSWORD = process.env.ACCESS_PW || '12345';

// Endpoint unificado de login: primero verifica ACCESS_PASSWORD, luego PIN de rol
app.post('/api/auth/login', (req, res) => {
  const { access_pw, pin } = req.body;
  // Verificar contraseña de acceso al sistema
  if (access_pw !== undefined && access_pw !== ACCESS_PASSWORD) return res.status(401).json({ error: 'Contraseña de acceso incorrecta' });
  // Si solo es verificación de acceso, devolver ok
  if (!pin) return res.json({ okey: true, mensaje: 'Acceso concedido' });

  // Verificar PIN de usuario
  const user = db.prepare('SELECT * FROM usuarios WHERE pin = ? AND activo = 1').get(pin);
  if (!user) return res.status(401).json({ error: 'PIN de usuario incorrecto' });

  // Generar token de sesión
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (usuario_id, token, ip) VALUES (?, ?, ?)').run(user.id, token, req.ip || '');

  res.json({ okey: true, usuario: { id: user.id, nombre: user.nombre, rol: user.rol }, token });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token || '';
  if (token) db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
  res.json({ okey: true });
});

// ─────────────────────────────────────────────────────
//  ENDPOINTS LIGEROS PARA POLLING (rápido, solo mesas activas)
// ─────────────────────────────────────────────────────

// Solo estado de mesas + comandas activas (liviano, ~2KB)
app.get('/api/status', (req, res) => {
  const mesas = db.prepare('SELECT * FROM mesas ORDER BY numero').all().map(m => {
    const items = db.prepare('SELECT * FROM mesa_items WHERE mesa_numero = ?').all(m.numero);
    return {
      numero: m.numero, estado: m.estado,
      items: items.map(i => ({ id: i.platillo_id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, nota: i.nota||'', enviado: i.enviado===1 }))
    };
  });
  const virtuales = db.prepare('SELECT * FROM virtuales').all().map(v => {
    const items = db.prepare('SELECT * FROM virtual_items WHERE virtual_id = ?').all(v.id);
    return { id: v.id, tipo: v.tipo, cliente: v.cliente, estado: v.estado,
      items: items.map(i => ({ id: i.platillo_id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, nota: i.nota||'', enviado: i.enviado===1 })) };
  });
  const comandas = db.prepare("SELECT * FROM comandas WHERE estado = 'activa' ORDER BY id").all().map(c => {
    const items = db.prepare('SELECT * FROM comanda_items WHERE comanda_id = ?').all(c.id);
    return { id: c.id, origen: c.origen, horaEntrada: c.horaEntrada, estado: c.estado, items };
  });
  res.json({ mesas, virtuales, comandas, turnoActivo: db.prepare("SELECT * FROM turnos WHERE estado = 'abierto' ORDER BY id DESC LIMIT 1").get()||null });
});

// Catálogos estáticos (se cargan una sola vez)
app.get('/api/catalogos', (req, res) => {
  const menu = db.prepare('SELECT * FROM menu ORDER BY categoria, nombre').all().reduce((acc, r) => {
    if (!acc[r.categoria]) acc[r.categoria] = [];
    acc[r.categoria].push({ id: r.id, nombre: r.nombre, precio: r.precio, agotado: r.agotado===1 });
    return acc;
  }, {});
  res.json({
    menu,
    usuarios: db.prepare('SELECT id, nombre, rol, activo FROM usuarios').all(),
    insumos: db.prepare('SELECT * FROM insumos ORDER BY nombre').all(),
    recetas: db.prepare('SELECT r.*, i.nombre as insumo_nombre, i.unidad FROM recetas r JOIN insumos i ON i.id = r.insumo_id').all()
  });
});

// ─────────────────────────────────────────────────────
//  ENDPOINTS ATÓMICOS PARA OPERACIONES DE MESAS
// ─────────────────────────────────────────────────────

// Agregar item a una mesa
app.post('/api/mesas/:numero/items', (req, res) => {
  const { numero } = req.params;
  const { platillo_id, nombre, precio } = req.body;
  if (!platillo_id || !nombre) return res.status(400).json({ error: 'Datos incompletos' });

  const existente = db.prepare('SELECT * FROM mesa_items WHERE mesa_numero = ? AND platillo_id = ?').get(numero, platillo_id);
  if (existente) {
    db.prepare('UPDATE mesa_items SET cantidad = cantidad + 1 WHERE id = ?').run(existente.id);
  } else {
    db.prepare('INSERT INTO mesa_items (mesa_numero, platillo_id, nombre, precio, cantidad) VALUES (?,?,?,?,1)').run(numero, platillo_id, nombre, precio);
  }
  db.prepare("UPDATE mesas SET estado = 'ocupada' WHERE numero = ? AND estado = 'libre'").run(numero);
  res.json({ okey: true });
});

// Cambiar cantidad de un item
app.put('/api/mesas/:numero/items/:platilloId', (req, res) => {
  const { numero, platilloId } = req.params;
  const { delta } = req.body;
  const item = db.prepare('SELECT * FROM mesa_items WHERE mesa_numero = ? AND platillo_id = ?').get(numero, platilloId);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  const nuevaCant = item.cantidad + (delta || 0);
  if (nuevaCant <= 0) {
    db.prepare('DELETE FROM mesa_items WHERE id = ?').run(item.id);
  } else {
    db.prepare('UPDATE mesa_items SET cantidad = ? WHERE id = ?').run(nuevaCant, item.id);
  }
  // Verificar si la mesa quedó vacía
  const count = db.prepare('SELECT COUNT(*) as cnt FROM mesa_items WHERE mesa_numero = ?').get(numero);
  if (count.cnt === 0) db.prepare("UPDATE mesas SET estado = 'libre' WHERE numero = ?").run(numero);
  res.json({ okey: true });
});

// Nota de item
app.put('/api/mesas/:numero/items/:platilloId/nota', (req, res) => {
  const { numero, platilloId } = req.params;
  const { nota } = req.body;
  db.prepare('UPDATE mesa_items SET nota = ? WHERE mesa_numero = ? AND platillo_id = ?').run(nota||'', numero, platilloId);
  res.json({ okey: true });
});

// Enviar a cocina (marcar items como enviados + crear comanda)
app.post('/api/mesas/:numero/enviar-cocina', (req, res) => {
  const { numero } = req.params;
  const items = db.prepare('SELECT * FROM mesa_items WHERE mesa_numero = ?').all(numero);
  if (!items.length) return res.status(400).json({ error: 'No hay items' });
  const origen = `Mesa ${numero}`;
  const comandaId = Date.now().toString();
  db.prepare('INSERT INTO comandas (id, origen, horaEntrada) VALUES (?, ?, ?)').run(comandaId, origen, new Date().toISOString());
  const ins = db.prepare('INSERT INTO comanda_items (comanda_id, nombre, cantidad, nota) VALUES (?,?,?,?)');
  for (const it of items) ins.run(comandaId, it.nombre, it.cantidad, it.nota||'');
  db.prepare('UPDATE mesa_items SET enviado = 1 WHERE mesa_numero = ?').run(numero);
  // Marcar mesa como "cuenta"
  db.prepare("UPDATE mesas SET estado = 'ocupada' WHERE numero = ?").run(numero);
  res.json({ okey: true, comanda_id: comandaId });
});

// Cancelar mesa (solo con autorización)
app.post('/api/mesas/:numero/cancelar', requireRol('Administrador'), (req, res) => {
  const { numero } = req.params;
  db.prepare('DELETE FROM mesa_items WHERE mesa_numero = ?').run(numero);
  db.prepare("UPDATE mesas SET estado = 'libre' WHERE numero = ?").run(numero);
  res.json({ okey: true });
});

// ─── PEDIDOS VIRTUALES ───
app.post('/api/virtuales', (req, res) => {
  const { tipo, cliente, mesero_id } = req.body;
  const id = 'v' + Date.now();
  db.prepare('INSERT INTO virtuales (id, tipo, cliente, estado, mesero_id) VALUES (?,?,?,?,?)').run(id, tipo||'Llevar', cliente||'Cliente', 'ocupada', mesero_id||null);
  res.json({ okey: true, id });
});

app.post('/api/virtuales/:id/items', (req, res) => {
  const { id } = req.params;
  const { platillo_id, nombre, precio } = req.body;
  const existente = db.prepare('SELECT * FROM virtual_items WHERE virtual_id = ? AND platillo_id = ?').get(id, platillo_id);
  if (existente) db.prepare('UPDATE virtual_items SET cantidad = cantidad + 1 WHERE id = ?').run(existente.id);
  else db.prepare('INSERT INTO virtual_items (virtual_id, platillo_id, nombre, precio, cantidad) VALUES (?,?,?,?,1)').run(id, platillo_id, nombre, precio);
  res.json({ okey: true });
});

app.put('/api/virtuales/:id/items/:platilloId', (req, res) => {
  const { id, platilloId } = req.params;
  const { delta } = req.body;
  const item = db.prepare('SELECT * FROM virtual_items WHERE virtual_id = ? AND platillo_id = ?').get(id, platilloId);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  const nc = item.cantidad + (delta||0);
  if (nc <= 0) db.prepare('DELETE FROM virtual_items WHERE id = ?').run(item.id);
  else db.prepare('UPDATE virtual_items SET cantidad = ? WHERE id = ?').run(nc, item.id);
  res.json({ okey: true });
});

app.delete('/api/virtuales/:id', requireRol('Administrador'), (req, res) => {
  db.prepare('DELETE FROM virtual_items WHERE virtual_id = ?').run(req.params.id);
  db.prepare('DELETE FROM virtuales WHERE id = ?').run(req.params.id);
  res.json({ okey: true });
});

// ─── COBRAR CUENTA (CON TRANSACCIÓN + INVENTARIO) ───
app.post('/api/cobrar', (req, res) => {
  const { origen, tipo_origen, items, subtotal, propina, metodo, mesero_id, turno_id, pagos_mixtos } = req.body;
  // origen = "Mesa 3" o "Llevar" (nombre del virtual)
  // tipo_origen = "mesa" o "virtual"

  const registrarVenta = db.transaction(() => {
    // 1. Insertar venta
    const r = db.prepare(`INSERT INTO ventas (fecha, mesa, subtotal, propina, metodo, items_json, mesero_id, turno_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      new Date().toISOString(), origen, subtotal, propina, metodo||'Efectivo',
      JSON.stringify(items||[]), mesero_id||null, turno_id||null
    );
    const ventaId = r.lastInsertRowid;

    // 2. Pagos mixtos
    if (pagos_mixtos && pagos_mixtos.length) {
      const ins = db.prepare('INSERT INTO pagos_mixtos (venta_id, metodo, monto) VALUES (?,?,?)');
      for (const p of pagos_mixtos) ins.run(ventaId, p.metodo, p.monto);
    }

    // 3. Descontar inventario por cada item (recetas)
    for (const it of (items||[])) {
      const count = it.cantidad || 1;
      const recetas = db.prepare('SELECT * FROM recetas WHERE platillo_id = ?').all(it.id);
      for (const rec of recetas) {
        const necesario = rec.cantidad * count;
        const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(rec.insumo_id);
        if (insumo && insumo.stock >= necesario) {
          db.prepare('UPDATE insumos SET stock = stock - ? WHERE id = ?').run(necesario, rec.insumo_id);
          db.prepare('INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, referencia) VALUES (?,?,?,?)')
            .run(rec.insumo_id, 'salida', -necesario, `Venta #${ventaId} - ${origen}`);
        }
      }
    }

    // 4. Verificar agotados
    const menuRows = db.prepare('SELECT * FROM menu').all();
    for (const row of menuRows) {
      const recetasCheck = db.prepare('SELECT * FROM recetas WHERE platillo_id = ?').all(row.id);
      let disponible = true;
      for (const rc of recetasCheck) {
        const ins = db.prepare('SELECT stock FROM insumos WHERE id = ?').get(rc.insumo_id);
        if (!ins || ins.stock < rc.cantidad) { disponible = false; break; }
      }
      db.prepare('UPDATE menu SET agotado = ? WHERE id = ?').run(disponible ? 0 : 1, row.id);
    }

    // 5. Limpiar origen
    if (tipo_origen === 'mesa') {
      const num = parseInt(origen.replace('Mesa ',''));
      db.prepare('DELETE FROM mesa_items WHERE mesa_numero = ?').run(num);
      db.prepare("UPDATE mesas SET estado = 'libre' WHERE numero = ?").run(num);
    } else {
      // Buscar virtual por tipo+cliente o usar el origen
      const virt = db.prepare("SELECT id FROM virtuales WHERE tipo = ? AND estado = 'ocupada' ORDER BY id DESC LIMIT 1").get(origen);
      if (virt) {
        db.prepare('DELETE FROM virtual_items WHERE virtual_id = ?').run(virt.id);
        db.prepare('DELETE FROM virtuales WHERE id = ?').run(virt.id);
      }
    }

    return ventaId;
  });

  try {
    const ventaId = registrarVenta();
    res.json({ okey: true, venta_id: ventaId });
  } catch (e) {
    console.error('Error en transacción de cobro:', e);
    res.status(500).json({ error: 'Error al procesar el cobro. Transacción revertida.', detalle: e.message });
  }
});

// ─── ENDPOINTS EXISTENTES (compatibilidad) ───
app.get('/api/estado', (req, res) => {
  // Pesado - solo para admin o carga inicial completa
  if (!req.usuario) return res.status(401).json({ error: 'Se requiere autenticación' });
  const getMenu = () => db.prepare('SELECT * FROM menu ORDER BY categoria, nombre').all().reduce((acc, r) => {
    if (!acc[r.categoria]) acc[r.categoria] = [];
    acc[r.categoria].push({ id: r.id, nombre: r.nombre, precio: r.precio, agotado: r.agotado===1 });
    return acc;
  }, {});
  const getMesas = () => db.prepare('SELECT * FROM mesas ORDER BY numero').all().map(m => {
    const items = db.prepare('SELECT * FROM mesa_items WHERE mesa_numero = ?').all(m.numero);
    return { numero: m.numero, estado: m.estado,
      items: items.map(i => ({ id: i.platillo_id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, nota: i.nota||'', enviado: i.enviado===1 })) };
  });
  const getVirtuales = () => db.prepare('SELECT * FROM virtuales').all().map(v => {
    const items = db.prepare('SELECT * FROM virtual_items WHERE virtual_id = ?').all(v.id);
    return { id: v.id, tipo: v.tipo, cliente: v.cliente, estado: v.estado, mesero_id: v.mesero_id,
      items: items.map(i => ({ id: i.platillo_id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, nota: i.nota||'', enviado: i.enviado===1 })) };
  });
  const getComandas = () => db.prepare("SELECT * FROM comandas WHERE estado = 'activa' ORDER BY id").all().map(c => {
    const items = db.prepare('SELECT * FROM comanda_items WHERE comanda_id = ?').all(c.id);
    return { id: c.id, origen: c.origen, horaEntrada: c.horaEntrada, estado: c.estado, items };
  });
  res.json({
    menu: getMenu(), mesas: getMesas(), virtuales: getVirtuales(), comandas: getComandas(),
    ventas: db.prepare('SELECT * FROM ventas ORDER BY id DESC LIMIT 100').all().map(v => ({...v, items: JSON.parse(v.items_json||'[]')})),
    gastos: db.prepare('SELECT * FROM retiros_caja ORDER BY id DESC LIMIT 50').all(),
    insumos: db.prepare('SELECT * FROM insumos ORDER BY nombre').all(),
    recetas: db.prepare('SELECT r.*, i.nombre as insumo_nombre, i.unidad FROM recetas r JOIN insumos i ON i.id = r.insumo_id').all(),
    turnoActivo: db.prepare("SELECT * FROM turnos WHERE estado = 'abierto' ORDER BY id DESC LIMIT 1").get()||null
  });
});

app.post('/api/estado', (req, res) => {
  // Sync completo legacy - requiere auth
  if (!req.usuario) return res.status(401).json({ error: 'Se requiere autenticación' });
  const { mesas, virtuales, comandas, ventas, gastos, menu } = req.body;
  if (mesas) {
    db.prepare('DELETE FROM mesa_items').run();
    for (const m of mesas) {
      db.prepare('UPDATE mesas SET estado = ? WHERE numero = ?').run(m.estado, m.numero);
      for (const item of (m.items||[])) db.prepare('INSERT INTO mesa_items (mesa_numero, platillo_id, nombre, precio, cantidad, nota, enviado) VALUES (?,?,?,?,?,?,?)').run(m.numero, item.id, item.nombre, item.precio, item.cantidad, item.nota||'', item.enviado?1:0);
    }
  }
  if (virtuales) {
    db.prepare('DELETE FROM virtual_items').run(); db.prepare('DELETE FROM virtuales').run();
    for (const v of virtuales) {
      db.prepare('INSERT INTO virtuales (id, tipo, cliente, estado) VALUES (?,?,?,?)').run(v.id, v.tipo, v.cliente, v.estado);
      for (const item of (v.items||[])) db.prepare('INSERT INTO virtual_items (virtual_id, platillo_id, nombre, precio, cantidad, nota, enviado) VALUES (?,?,?,?,?,?,?)').run(v.id, item.id, item.nombre, item.precio, item.cantidad, item.nota||'', item.enviado?1:0);
    }
  }
  if (comandas) {
    db.prepare('DELETE FROM comanda_items').run(); db.prepare('DELETE FROM comandas').run();
    for (const c of comandas) {
      db.prepare('INSERT INTO comandas (id, origen, horaEntrada, estado) VALUES (?,?,?,?)').run(c.id, c.origen, c.horaEntrada, c.estado||'activa');
      for (const item of (c.items||[])) db.prepare('INSERT INTO comanda_items (comanda_id, nombre, cantidad, nota, estado) VALUES (?,?,?,?,?)').run(c.id, item.nombre, item.cantidad, item.nota||'', item.estado||'pendiente');
    }
  }
  if (ventas) {
    db.prepare('DELETE FROM ventas').run();
    for (const v of ventas) db.prepare('INSERT INTO ventas (fecha, mesa, subtotal, propina, metodo, items_json, mesero_id, turno_id, cancelado) VALUES (?,?,?,?,?,?,?,?,?)').run(v.fecha, v.mesa, v.subtotal, v.propina, v.metodo, JSON.stringify(v.items||[]), v.mesero_id||null, v.turno_id||null, v.cancelado?1:0);
  }
  if (gastos) {
    db.prepare('DELETE FROM retiros_caja').run();
    for (const g of gastos) db.prepare('INSERT INTO retiros_caja (turno_id, usuario_id, concepto, monto, fecha) VALUES (?,?,?,?,?)').run(g.turno_id||1, g.usuario_id||1, g.concepto, g.monto, g.fecha);
  }
  if (menu) {
    db.prepare('DELETE FROM menu').run();
    for (const [cat, platillos] of Object.entries(menu)) for (const p of platillos) db.prepare('INSERT OR REPLACE INTO menu (id, categoria, nombre, precio, agotado) VALUES (?,?,?,?,?)').run(p.id, cat, p.nombre, p.precio, p.agotado?1:0);
  }
  res.json({ okey: true, mensaje: 'Sincronizado' });
});

// ─── TURNOS ───
app.post('/api/turno/abrir', requireRol('Administrador','Cajero'), (req, res) => {
  const { usuario_id, fondo_inicial } = req.body;
  if (db.prepare("SELECT * FROM turnos WHERE estado = 'abierto'").get()) return res.status(400).json({ error: 'Ya hay un turno abierto' });
  const r = db.prepare('INSERT INTO turnos (usuario_id, fondo_inicial) VALUES (?,?)').run(usuario_id, fondo_inicial||0);
  res.json({ okey: true, turno_id: r.lastInsertRowid });
});

app.post('/api/turno/cerrar', requireRol('Administrador'), (req, res) => {
  const { usuario_id, total_efectivo_real } = req.body;
  const turno = db.prepare("SELECT * FROM turnos WHERE estado = 'abierto' ORDER BY id DESC LIMIT 1").get();
  if (!turno) return res.status(400).json({ error: 'No hay turno abierto' });

  const ventasTurno = db.prepare('SELECT * FROM ventas WHERE turno_id = ? AND cancelado = 0').all(turno.id);
  const retiros = db.prepare('SELECT COALESCE(SUM(monto),0) as total FROM retiros_caja WHERE turno_id = ?').get(turno.id);

  let efec = 0, tarj = 0, trans = 0, propinas = 0;
  for (const v of ventasTurno) {
    propinas += v.propina;
    if (v.metodo === 'Efectivo') efec += v.subtotal;
    else if (v.metodo === 'Tarjeta') tarj += v.subtotal;
    else trans += v.subtotal;
  }
  const totalEsperado = efec + turno.fondo_inicial - retiros.total;
  const diferencia = (total_efectivo_real || 0) - totalEsperado;

  db.prepare(`UPDATE turnos SET fecha_cierre = datetime('now','localtime'), total_efectivo=?, total_tarjeta=?,
    total_transferencia=?, total_propinas=?, total_gastos=?, total_ventas_bruto=?, diferencia=?, estado='cerrado' WHERE id=?`)
    .run(efec, tarj, trans, propinas, retiros.total, efec+tarj+trans, diferencia, turno.id);
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

// ─── PARA REEMPLAZAR EL setInterval DE APP.JS ───
app.get('/api/comandas/despachar/:id', (req, res) => {
  db.prepare("UPDATE comandas SET estado = 'despachada' WHERE id = ?").run(req.params.id);
  db.prepare('DELETE FROM comandas WHERE id = ?').run(req.params.id);
  res.json({ okey: true });
});

// ─── SPA ───
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Mariscos Matty POS (seguro) en puerto ${PORT}`));
// ═══════════════════════════════════════════════════════════
//  MARISCOS MATTY - SOFT RESTAURANT EDITION
// ═══════════════════════════════════════════════════════════

const CURRENT_USER = { id: null, nombre: '', rol: '' };
let MENU = {}, estadoMesas = [], pedidosVirtuales = [], comandasCocina = [];
let historialVentas = [], listaGastos = [];
let usuarios = [], turnoActivo = null;

let mesaActivaIndex = null, esMesaVirtualActiva = false;
let cuentaSeparadaActiva = [], esCobroParcialDeDivision = false;
let categoriaActiva = '', adminCategoriaActiva = '';
let porcentajePropina = 10, busquedaFiltro = '', ticketFueImpreso = false;
let resolverUIModal = null;

const $ = id => document.getElementById(id);
const fmt = v => '$' + Math.round(v).toLocaleString('es-MX');
const obtenerMesa = () => esMesaVirtualActiva ? pedidosVirtuales[mesaActivaIndex] : estadoMesas[mesaActivaIndex];
const sub = (items) => (items||[]).reduce((a,i) => a + i.precio * i.cantidad, 0);

function seg(id, cb) { const el = $(id); if (el && cb) { try { cb(el); } catch(e){} } return el; }

// ─── AUTH ───
async function loginUsuario(pin) {
  try {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pin}) });
    if (!r.ok) return null;
    const d = await r.json();
    CURRENT_USER.id = d.usuario.id; CURRENT_USER.nombre = d.usuario.nombre; CURRENT_USER.rol = d.usuario.rol;
    sessionStorage.setItem('mattyUser', JSON.stringify(CURRENT_USER));
    return d.usuario;
  } catch(e) { return null; }
}

async function modalPrompt(titulo, mensaje, conInput = false, placeholderInput = "") {
  return new Promise((resolver) => {
    resolverUIModal = resolver;
    seg('ui-modal-titulo', e => e.textContent = titulo);
    seg('ui-modal-mensaje', e => e.textContent = mensaje);
    const inp = $('ui-modal-input');
    if (inp) {
      inp.value = '';
      inp.placeholder = placeholderInput;
    }
    seg('ui-modal-input-container', e => e.style.display = conInput ? 'block' : 'none');
    if (conInput && inp) setTimeout(() => inp.focus(), 100);
    const ov = $('overlay-ui');
    if (ov) { ov.style.display = 'flex'; ov.style.animation = 'none'; setTimeout(() => ov.style.animation = 'fadeIn 0.15s ease-out', 10); }
  });
}

seg('btn-ui-aceptar', el => el.onclick = () => {
  seg('overlay-ui', e => e.style.display = 'none');
  if (resolverUIModal) resolverUIModal(($('ui-modal-input-container')?.style.display === 'block') ? ($('ui-modal-input')?.value||'') : true);
});
seg('btn-ui-cancelar', el => el.onclick = () => { seg('overlay-ui', e => e.style.display = 'none'); if (resolverUIModal) resolverUIModal(false); });

async function solicitarAcceso(rolesPermitidos = ['Administrador']) {
  const pw = await modalPrompt('🔐 Autorización Requerida', 'Ingresa tu PIN:', true);
  if (pw === false) return false;
  const u = await loginUsuario(pw);
  if (!u) { await modalPrompt('Acceso Denegado', 'PIN incorrecto.'); return false; }
  if (!rolesPermitidos.includes(u.rol)) {
    await modalPrompt('Acceso Denegado', `Se requiere: ${rolesPermitidos.join(' o ')}. Tu rol: ${u.rol}`);
    return false;
  }
  return u;
}
async function soloAdmin() { return solicitarAcceso(['Administrador']); }
async function adminOCajero() { return solicitarAcceso(['Administrador','Cajero']); }

// ─── SYNC ───
async function cargarTodo() {
  try {
    const r = await fetch('/api/estado');
    const d = await r.json();
    estadoMesas = d.mesas||[]; pedidosVirtuales = d.virtuales||[];
    comandasCocina = d.comandas||[]; historialVentas = d.ventas||[];
    listaGastos = d.gastos||[]; 
    
    const categoriasLocales = Object.keys(MENU);
    MENU = d.menu||{};
    categoriasLocales.forEach(cat => {
      if (!MENU[cat]) MENU[cat] = [];
    });

    usuarios = d.usuarios||[]; turnoActivo = d.turnoActivo;
    if (!categoriaActiva && Object.keys(MENU).length > 0) { categoriaActiva = Object.keys(MENU)[0]; adminCategoriaActiva = Object.keys(MENU)[0]; }
    redibujar();
  } catch(e) { console.error('Sync:', e); }
}

async function guardar() {
  try {
    await fetch('/api/estado', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ mesas:estadoMesas, virtuales:pedidosVirtuales, comandas:comandasCocina, ventas:historialVentas, gastos:listaGastos, menu:MENU }) });
  } catch(e) { console.error('Save:', e); }
}

function redibujar() {
  const b = $('badge-cocina-count'); if (b) b.textContent = comandasCocina.length;
  renderTurnoStatusSuperior();
  try {
    if ($('vista-mesa').style.display === 'block') { renderOrden(); return; }
    if ($('vista-admin').style.display === 'block') { renderAdmin(); return; }
    if ($('seccion-mesas')?.style.display === 'block') renderMapa();
    if ($('seccion-virtuales')?.style.display === 'block') renderPedidosVirtuales();
    if ($('seccion-cocina')?.style.display === 'block') renderPantallaCocina();
  } catch(e) {}
}

function renderTurnoStatusSuperior() {
  const topBar = $('top-bar-derecha');
  if (!topBar) return;
  let statusBadge = $('turno-status-badge');
  if (!statusBadge) {
    statusBadge = document.createElement('span');
    statusBadge.id = 'turno-status-badge';
    topBar.appendChild(statusBadge);
  }
  if (turnoActivo) {
    statusBadge.className = 'rol-badge rol-administrador';
    statusBadge.style.marginLeft = '10px';
    statusBadge.textContent = `🟢 Turno Abierto (#${turnoActivo.id})`;
  } else {
    statusBadge.className = 'rol-badge rol-cajero';
    statusBadge.style.marginLeft = '10px';
    statusBadge.style.background = 'var(--danger)';
    statusBadge.textContent = `🔴 SIN TURNO ACTIVO`;
  }
}

// ─── TABS ───
['tab-mesas','tab-virtuales','tab-cocina'].forEach(id => {
  seg(id, el => el.onclick = () => {
    document.querySelectorAll('.tab-nav').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.seccion-pos').forEach(s => s.style.display = 'none');
    seg('vista-mesa', e => e.style.display = 'none');
    seg('vista-admin', e => e.style.display = 'none');
    const sec = id.replace('tab-','seccion-');
    el.classList.add('activo');
    seg(sec, e => e.style.display = 'block');
    const renders = { 'seccion-mesas': renderMapa, 'seccion-virtuales': renderPedidosVirtuales, 'seccion-cocina': renderPantallaCocina };
    if (renders[sec]) renders[sec]();
  });
});

// ─── RELOJ ───
function actualizarReloj() {
  const el = $('reloj');
  if (!el) return;
  const a = new Date();
  el.textContent = a.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'}) + ' · ' + a.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
}

// ═══════════════════════════════════════════════════════════
//  MAPA
// ═══════════════════════════════════════════════════════════
function renderMapa() {
  const grid = $('grid-mesas'); if (!grid) return; grid.innerHTML = '';
  estadoMesas.forEach((mesa, idx) => {
    const total = sub(mesa.items);
    const c = document.createElement('button');
    c.className = 'mesa-card ' + (mesa.estado === 'ocupada' ? 'ocupada' : mesa.estado === 'cuenta' ? 'cuenta' : '');
    c.innerHTML = `<span class="mesa-numero">🍽️ ${mesa.numero}</span>
      <span class="mesa-estado">${mesa.estado === 'libre' ? 'Libre' : mesa.estado === 'ocupada' ? 'Ocupada' : '💵 Cuenta'}</span>
      ${mesa.estado === 'libre' ? '<span class="mesa-vacia">Abrir mesa</span>' : `<span class="mesa-total">${fmt(total)}</span>`}
      ${mesa.estado !== 'libre' && mesa.items.length ? `<span class="mesa-item-count">${mesa.items.reduce((a,i)=>a+i.cantidad,0)} artículos</span>` : ''}`;
    c.onclick = async () => { 
      if (!turnoActivo) { await modalPrompt('⚠️ Turno Cerrado', 'No puedes abrir mesas si no hay un turno de caja iniciado.'); return; }
      esMesaVirtualActiva = false; abrirMesa(idx, `Mesa ${mesa.numero}`); 
    };
    grid.appendChild(c);
  });
}

// ═══════════════════════════════════════════════════════════
//  PEDIDOS VIRTUALES
// ═══════════════════════════════════════════════════════════
function renderPedidosVirtuales() {
  const grid = $('grid-virtuales'); if (!grid) return; grid.innerHTML = '';
  if (!pedidosVirtuales.length) { grid.innerHTML = '<p class="empty-state">📭 No hay pedidos fuera de salón activos.</p>'; return; }
  pedidosVirtuales.forEach((ped, idx) => {
    const total = sub(ped.items);
    const c = document.createElement('button'); c.className = 'mesa-card';
    c.innerHTML = `<span class="mesa-numero">${ped.tipo === 'Domicilio' ? '🏍️' : '🥡'} ${ped.tipo}</span>
      <span class="mesa-estado" style="text-transform:none;font-size:11px;">👤 ${ped.cliente}</span>
      <span class="mesa-estado">${ped.estado === 'ocupada' ? 'En Proceso' : '💵 Cuenta'}</span>
      <span class="mesa-total">${fmt(total)}</span>`;
    c.onclick = () => { esMesaVirtualActiva = true; abrirMesa(idx, ped.tipo); };
    grid.appendChild(c);
  });
}

seg('btn-nuevo-pedido-v', el => el.onclick = async () => { 
  if (!turnoActivo) return modalPrompt('⚠️ Operación Denegada', 'Por favor abre un turno en Administración para registrar comandas.');
  seg('v-cliente-nombre', e => e.value = ''); 
  seg('overlay-nuevo-virtual', e => { e.style.display = 'flex'; e.style.animation = 'none'; setTimeout(() => e.style.animation = 'fadeIn 0.15s ease-out', 10); }); 
});
seg('btn-cancelar-v', el => el.onclick = () => seg('overlay-nuevo-virtual', e => e.style.display = 'none'));
seg('btn-aceptar-v', el => el.onclick = () => {
  const tipo = $('v-tipo-servicio')?.value || 'Llevar';
  const cliente = ($('v-cliente-nombre')?.value||'').trim() || 'Cliente General';
  pedidosVirtuales.push({ id:'v'+Date.now(), tipo, cliente, estado:'ocupada', items:[], mesero_id: CURRENT_USER.id||null });
  guardar(); seg('overlay-nuevo-virtual', e => e.style.display = 'none');
  esMesaVirtualActiva = true; abrirMesa(pedidosVirtuales.length-1, tipo);
});

// ─── VISTA DETALLE ───
function abrirMesa(idx, titulo) {
  mesaActivaIndex = idx;
  ['seccion-mesas','seccion-virtuales','seccion-cocina'].forEach(s => seg(s, e => e.style.display = 'none'));
  seg('titulo-mesa', e => e.textContent = '📋 '+titulo);
  const obj = obtenerMesa();
  seg('badge-cliente-info', e => { if (esMesaVirtualActiva && obj) { e.style.display = 'inline-block'; e.textContent = '👤 '+obj.cliente; } else e.style.display = 'none'; });
  seg('vista-mesa', e => e.style.display = 'block');
  busquedaFiltro = ''; seg('buscar-platillo', e => e.value = '');
  renderMesa();
}

function regresar() {
  if (esMesaVirtualActiva) { const t = $('tab-virtuales'); if (t) t.click(); }
  else { const t = $('tab-mesas'); if (t) t.click(); }
}
seg('btn-volver', el => el.onclick = regresar);

function renderCategorias() {
  const cont = $('categorias'); if (!cont) return; cont.innerHTML = '';
  Object.keys(MENU).forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn ' + (cat === categoriaActiva ? 'activo' : '');
    btn.textContent = cat;
    btn.onclick = () => { categoriaActiva = cat; renderCategorias(); renderPlatillos(); };
    cont.appendChild(btn);
  });
}

function renderPlatillos() {
  const cont = $('lista-platillos'); if (!cont) return; cont.innerHTML = '';
  let lista = [];
  if (busquedaFiltro.trim()) Object.keys(MENU).forEach(cat => MENU[cat].forEach(p => { if (p.nombre.toLowerCase().includes(busquedaFiltro.toLowerCase())) lista.push(p); }));
  else lista = MENU[categoriaActiva] || [];
  if (!lista.length) { cont.innerHTML = '<p class="empty-state">🔍 No se encontraron productos o esta categoría está vacía.</p>'; return; }
  lista.forEach(p => {
    const card = document.createElement('div');
    card.className = 'platillo-card' + (p.agotado ? ' agotado' : '');
    card.innerHTML = `<h4>${p.nombre} ${p.agotado ? '<span class="agotado-badge">AGOTADO</span>' : ''}</h4>
      <span class="precio">${fmt(p.precio)}</span>
      <button ${p.agotado ? 'disabled style="opacity:0.5"' : ''}>${p.agotado ? '❌ Agotado' : '+ Agregar'}</button>`;
    if (!p.agotado) card.querySelector('button').onclick = () => agregarItem(p);
    cont.appendChild(card);
  });
}

function agregarItem(platillo) {
  if(!turnoActivo) { modalPrompt('Error','Turno inactivo.'); return; }
  const orden = obtenerMesa();
  if (!orden) return;
  const ex = orden.items.find(it => it.id === platillo.id);
  if (ex) ex.cantidad += 1;
  else orden.items.push({ id: platillo.id, nombre: platillo.nombre, precio: platillo.precio, Clinical_id: null, cantidad: 1, nota: '', enviado: false });
  if (orden.estado === 'libre') orden.estado = 'ocupada';
  guardar(); renderMesa();
}

async function cambiarCantidad(itemId, delta) {
  const orden = obtenerMesa();
  const item = orden.items.find(it => it.id === itemId);
  if (!item) return;
  if (item.enviado) { const u = await soloAdmin(); if (!u) return; }
  item.cantidad += delta;
  if (item.cantidad <= 0) orden.items = orden.items.filter(it => it.id !== itemId);
  if (!orden.items.length && !esMesaVirtualActiva) orden.estado = 'libre';
  guardar(); renderMesa();
}

function guardarNota(itemId, texto) {
  const orden = obtenerMesa();
  const item = orden.items.find(it => it.id === itemId);
  if (item) { item.nota = texto.trim(); guardar(); }
}

function renderOrden() {
  const orden = obtenerMesa();
  const cont = $('orden-lista'); if (!cont) return; cont.innerHTML = '';
  if (!orden || !orden.items.length) cont.innerHTML = '<p class="orden-vacia">🛒 Aún no hay productos.</p>';
  else {
    orden.items.forEach(it => {
      const row = document.createElement('div'); row.className = 'orden-item';
      row.innerHTML = `<div style="flex:1;min-width:0">
          <div class="nombre">${it.nombre} ${it.enviado ? '🔒' : ''}</div>
          <div class="subtotal">${fmt(it.precio * it.cantidad)}</div>
          <div class="nota-cocina-box"><input type="text" class="input-nota" placeholder="✍️ Nota..." value="${it.nota||''}"></div>
        </div>
        <div class="qty-control">
          <button class="btn-menos">−</button><span>${it.cantidad}</span><button class="btn-mas">+</button>
        </div>`;
      row.querySelector('.btn-menos').onclick = () => cambiarCantidad(it.id, -1);
      row.querySelector('.btn-mas').onclick = () => cambiarCantidad(it.id, 1);
      row.querySelector('.input-nota').onchange = (e) => guardarNota(it.id, e.target.value);
      cont.appendChild(row);
    });
  }
  seg('orden-total-valor', e => e.textContent = fmt(sub(orden ? orden.items : [])));
}
function renderMesa() { renderCategorias(); renderPlatillos(); renderOrden(); }

// ─── CANCELAR ───
async function cancelarMesa() {
  const orden = obtenerMesa();
  if (!orden || !orden.items.length) { if (esMesaVirtualActiva) { pedidosVirtuales.splice(mesaActivaIndex,1); guardar(); regresar(); } return; }
  const ok = await modalPrompt('⚠️ Cancelar', '¿Cancelar TODO este pedido?');
  if (!ok) return;
  const u = await soloAdmin();
  if (!u) return;
  if (esMesaVirtualActiva) pedidosVirtuales.splice(mesaActivaIndex,1);
  else { orden.items = []; orden.estado = 'libre'; }
  guardar(); regresar();
}
seg('btn-cancelar-mesa', el => el.onclick = cancelarMesa);

// ─── COMANDA A COCINA ───
seg('btn-enviar-cocina', el => el.onclick = async () => {
  const orden = obtenerMesa();
  if (!orden || !orden.items.length) return modalPrompt('Aviso','No hay platillos para enviar.');
  const origen = esMesaVirtualActiva ? `${orden.tipo} (${(orden.cliente||'').substring(0,8)})` : `Mesa ${orden.numero}`;
  comandasCocina.push({ id: Date.now().toString(), origen, horaEntrada: new Date().toISOString(), estado:'activa',
    items: orden.items.map(it => ({ nombre: it.nombre, cantidad: it.cantidad, nota: it.nota||'', estado:'pendiente' })) });
  orden.items.forEach(it => { it.enviado = true; });
  guardar(); renderOrden();
  modalPrompt('✅ Éxito','Comanda enviada a la cocina.');
});

// ─── PANTALLA COCINA ───
function renderPantallaCocina() {
  const grid = $('grid-comandas-cocina'); if (!grid) return; grid.innerHTML = '';
  if (!comandasCocina.length) { grid.innerHTML = '<p class="empty-state">🔥 Cocina limpia.</p>'; return; }
  comandasCocina.forEach((com, idx) => {
    const min = Math.floor((new Date() - new Date(com.horaEntrada)) / 60000);
    const card = document.createElement('div');
    card.className = 'comanda-card ' + (min >= 15 ? 'critica' : 'lista');
    card.innerHTML = `<div class="comanda-header"><span class="comanda-origen">${com.origen}</span><span class="comanda-tiempo">⏱️ ${min} min</span></div>
      <div class="comanda-cuerpo">${com.items.map(it => `<div class="comanda-item-row"><span class="comanda-item-nombre">${it.cantidad}x ${it.nombre}</span><span class="comanda-item-status">${it.estado==='pendiente'?'⏳':'✅'}</span>${it.nota ? `<div class="comanda-item-nota">⚠️ ${it.nota}</div>`:''}</div>`).join('')}</div>
      <div class="comanda-footer"><button class="btn btn-gold btn-completar-chef">✅ Despachar</button></div>`;
    card.querySelector('.btn-completar-chef').onclick = () => { comandasCocina.splice(idx,1); guardar(); renderPantallaCocina(); };
    grid.appendChild(card);
  });
}

// ─── DIVISION ───
seg('btn-abrir-division', el => el.onclick = () => {
  const orden = obtenerMesa();
  if (!orden || !orden.items.length) return modalPrompt('Aviso','No hay productos que separar.');
  cuentaSeparadaActiva = []; renderModalDivision();
  seg('overlay-dividir', e => { e.style.display = 'flex'; e.style.animation = 'none'; setTimeout(() => e.style.animation = 'fadeIn 0.15s ease-out', 10); });
});
seg('cerrar-dividir', el => el.onclick = () => {
  const orden = obtenerMesa();
  cuentaSeparadaActiva.forEach(itemSep => { const orig = orden.items.find(i => i.id === itemSep.id); if (orig) orig.cantidad += itemSep.cantidad; else orden.items.push(itemSep); });
  cuentaSeparadaActiva = []; guardar(); seg('overlay-dividir', e => e.style.display = 'none'); renderMesa();
});

function renderModalDivision() {
  const orden = obtenerMesa();
  const cM = $('division-lista-mesa'), cC = $('division-lista-cliente');
  if (!cM || !cC) return;
  cM.innerHTML = ''; cC.innerHTML = ''; let ts = 0;
  (orden.items||[]).forEach(it => {
    if (it.cantidad <= 0) return;
    const row = document.createElement('div'); row.className = 'item-division-row';
    row.innerHTML = `<span>${it.cantidad}x ${it.nombre} ${it.enviado ? '🔒' : ''}</span><button>Separar 1</button>`;
    row.querySelector('button').onclick = async () => {
      if (it.enviado) { const u = await soloAdmin(); if (!u) return; }
      it.cantidad -= 1; const sep = cuentaSeparadaActiva.find(i => i.id === it.id);
      if (sep) sep.cantidad += 1; else cuentaSeparadaActiva.push({ ...it, cantidad: 1 });
      renderModalDivision();
    };
    cM.appendChild(row);
  });
  cuentaSeparadaActiva.forEach((it, idx) => {
    ts += it.precio * it.cantidad;
    const row = document.createElement('div'); row.className = 'item-division-row';
    row.innerHTML = `<span>${it.cantidad}x ${it.nombre}</span><button>↩️ Devolver</button>`;
    row.querySelector('button').onclick = () => {
      it.cantidad -= 1; const orig = orden.items.find(i => i.id === it.id);
      if (orig) orig.cantidad += 1; else orden.items.push({ ...it, cantidad: 1 });
      if (it.cantidad <= 0) cuentaSeparadaActiva.splice(idx,1);
      renderModalDivision();
    };
    cC.appendChild(row);
  });
  seg('total-separado-valor', e => e.textContent = fmt(ts));
}
seg('btn-cobrar-separado', el => el.onclick = () => {
  if (!cuentaSeparadaActiva.length) return modalPrompt('Error','Selecciona al menos un producto.');
  seg('overlay-dividir', e => e.style.display = 'none');
  abrirTicketPre(true);
});

// ─── COBRO / TICKET ───
function abrirTicket() { abrirTicketPre(false); }
function abrirTicketPre(esParcial) {
  esCobroParcialDeDivision = esParcial;
  const orden = obtenerMesa();
  const prods = esParcial ? cuentaSeparadaActiva : (orden ? orden.items : []);
  if (!prods.length) return;
  if (!esParcial && orden) orden.estado = 'cuenta';
  guardar();
  const tit = esMesaVirtualActiva ? (orden ? orden.tipo : '') : `Mesa ${orden ? orden.numero : ''}`;
  seg('ticket-mesa-info', e => e.textContent = `${tit} · ${new Date().toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'})}`);
  seg('ticket-lineas', e => e.innerHTML = prods.map(it => `<div class="ticket-linea-producto"><div class="ticket-linea-main"><span>${it.cantidad}x ${it.nombre}</span><span>${fmt(it.precio*it.cantidad)}</span></div></div>`).join(''));
  porcentajePropina = 10; actualizarBotonesPropina();
  seg('pago-recibido', e => e.value = ''); seg('bloque-cambio', e => e.style.display = 'none');
  ticketFueImpreso = false;
  calcularPrecios();
  seg('overlay-ticket', e => { e.style.display = 'flex'; e.style.animation = 'none'; setTimeout(() => e.style.animation = 'fadeIn 0.15s ease-out', 10); });
}

function calcularPrecios() {
  const orden = obtenerMesa();
  const subt = esCobroParcialDeDivision ? sub(cuentaSeparadaActiva) : sub(orden ? orden.items : []);
  const prop = subt * (porcentajePropina / 100);
  const total = subt + prop;
  seg('ticket-subtotal-valor', e => e.textContent = fmt(subt));
  seg('ticket-propina-dinero', e => e.textContent = `${fmt(prop)} (${porcentajePropina}%)`);
  seg('ticket-total-valor', e => e.textContent = fmt(total));
}

function actualizarBotonesPropina() {
  document.querySelectorAll('.btn-propina').forEach(btn => {
    const pct = parseInt(btn.dataset.pct);
    btn.style.background = pct === porcentajePropina ? 'var(--primary)' : 'var(--border)';
    btn.style.color = pct === porcentajePropina ? 'white' : 'var(--text)';
  });
}
document.querySelectorAll('.btn-propina').forEach(btn => {
  btn.onclick = () => { porcentajePropina = parseInt(btn.dataset.pct); actualizarBotonesPropina(); calcularPrecios(); };
});

async function confirmarCobro() {
  const orden = obtenerMesa();
  const prods = esCobroParcialDeDivision ? cuentaSeparadaActiva : (orden ? orden.items : []);
  const subtotal = sub(prods);
  const propina = subtotal * (porcentajePropina / 100);
  const total = subtotal + propina;
  const pago = parseFloat($('pago-recibido')?.value || 0);
  if (pago < total) return modalPrompt('Error','Efectivo insuficiente.');
  if (!ticketFueImpreso) return modalPrompt('Falta Imprimir','Debes imprimir el ticket primero.');
  const user = await adminOCajero();
  if (!user) return;
  ejecutarCierreDeMesaFisico(orden, prods, subtotal, propina);
}

function ejecutarCierreDeMesaFisico(orden, prods, subtotal, propina) {
  try {
    fetch('/api/ventas', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fecha: new Date().toISOString(), mesa: orden ? (esMesaVirtualActiva ? orden.tipo : `Mesa ${orden.numero}`) : 'Varios',
        subtotal, propina, propina_metodo:'Efectivo', metodo:'Efectivo',
        items: prods.map(it => ({ id: it.id, nombre: it.nombre, precio: it.precio, cantidad: it.cantidad })),
        mesero_id: CURRENT_USER.id||null, turno_id: turnoActivo ? turnoActivo.id : null }) });
  } catch(e) { console.error(e); }
  
  if (esCobroParcialDeDivision) { cuentaSeparadaActiva = []; if (orden && !orden.items.length && !esMesaVirtualActiva) orden.estado = 'libre'; }
  else { if (esMesaVirtualActiva) pedidosVirtuales.splice(mesaActivaIndex,1); else if (orden) { orden.items = []; orden.estado = 'libre'; } }
  guardar();
  seg('overlay-ticket', e => e.style.display = 'none');
  regresar();
}
seg('btn-confirmar-cobro', el => el.onclick = confirmarCobro);

// ─── IMPRIMIR TICKET DE CONSUMO ───
seg('btn-imprimir', el => el.onclick = () => {
  seg('ticket-corte-imprimible', e => e.style.display = 'none');
  seg('overlay-ticket', e => e.style.display = 'flex');
  setTimeout(() => { 
    window.print(); 
    ticketFueImpreso = true;
    
    const orden = obtenerMesa();
    const prods = esCobroParcialDeDivision ? cuentaSeparadaActiva : (orden ? orden.items : []);
    const subtotal = sub(prods);
    const propina = subtotal * (porcentajePropina / 100);
    
    ejecutarCierreDeMesaFisico(orden, prods, subtotal, propina);
  }, 250);
});

seg('cerrar-ticket', el => el.onclick = () => { seg('overlay-ticket', e => e.style.display = 'none'); });
seg('btn-cobrar', el => el.onclick = abrirTicket);

document.querySelectorAll('.btn-tecla').forEach(t => {
  t.onclick = (e) => {
    let el = e.target; if (el.tagName === 'I') el = el.parentElement;
    const key = el.dataset.val; const inp = $('pago-recibido');
    if (!inp) return;
    if (key === 'C') inp.value = '';
    else if (key === 'del') inp.value = inp.value.slice(0,-1);
    else if (inp.value.length < 7) inp.value += key;
    calcularPrecios();
  };
});

seg('buscar-platillo', el => el.oninput = (e) => { busquedaFiltro = e.target.value; renderPlatillos(); });

// ═══════════════════════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════════════════════
async function abrirAdmin() {
  const user = await adminOCajero();
  if (!user) return;
  ['seccion-mesas','seccion-virtuales','seccion-cocina'].forEach(s => seg(s, e => e.style.display = 'none'));
  seg('vista-mesa', e => e.style.display = 'none');
  seg('vista-admin', e => e.style.display = 'block');
  renderAdmin();
}
seg('btn-admin-panel', el => el.onclick = abrirAdmin);
seg('btn-volver-admin', el => el.onclick = () => { seg('vista-admin', e => e.style.display = 'none'); const t = $('tab-mesas'); if (t) t.click(); });

function renderAdmin() {
  seg('admin-total-mesas', e => e.textContent = estadoMesas.length);
  renderTurnosAdmin();
  
  const sel = $('admin-platillo-cat');
  if (sel) {
    const catSeleccionadaAnterior = sel.value || adminCategoriaActiva;
    sel.innerHTML = Object.keys(MENU).map(c => `<option value="${c}">${c}</option>`).join('');
    if (MENU[catSeleccionadaAnterior]) sel.value = catSeleccionadaAnterior;
  }
  
  const btns = $('admin-lista-categorias-btns');
  if (btns) {
    if (!adminCategoriaActiva && Object.keys(MENU).length > 0) adminCategoriaActiva = Object.keys(MENU)[0];
    btns.innerHTML = Object.keys(MENU).map(cat => `<button class="cat-btn ${cat === adminCategoriaActiva ? 'activo' : ''}" style="padding:6px 14px;font-size:12px;" onclick="window.acat='${cat}'; adminCategoriaActiva='${cat}'; renderAdmin()">${cat}</button>`).join('');
  }
  
  const tbody = $('cuerpo-tabla-admin');
  if (tbody) {
    const cat = window.acat || adminCategoriaActiva;
    adminCategoriaActiva = cat;
    if (MENU[cat] && MENU[cat].length > 0) {
      tbody.innerHTML = MENU[cat].map(p => `<tr><td><strong>${p.nombre}</strong></td><td>${fmt(p.precio)}</td><td><button class="btn btn-sm" onclick="editarP('${p.id}','${cat}')"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm btn-coral" onclick="elimP('${cat}','${p.id}')"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding: 20px;">📂 Categoría recién creada y vacía. Añade un platillo usando el formulario de la derecha.</td></tr>';
    }
  }
  calcularReportesAdmin();
  renderGastosAdmin();
}

window.editarP = (id, cat) => {
  const p = MENU[cat]?.find(x => x.id === id);
  if (!p) return;
  seg('form-admin-titulo', e => e.textContent = '✏️ Modificar');
  seg('admin-platillo-id', e => e.value = id);
  seg('admin-platillo-cat', e => e.value = cat);
  seg('admin-platillo-nombre', e => e.value = p.nombre);
  seg('admin-platillo-precio', e => e.value = p.precio);
  seg('btn-cancelar-edicion', e => e.style.display = 'inline-flex');
};
window.elimP = async (cat, id) => {
  const p = MENU[cat]?.find(x => x.id === id);
  if (!p) return;
  if (await modalPrompt('¿Eliminar?', `¿Eliminar "${p.nombre}"?`)) { MENU[cat] = MENU[cat].filter(x => x.id !== id); guardar(); renderAdmin(); }
};

function limpiarForm() {
  seg('form-nuevo-platillo', e => e.reset());
  seg('admin-platillo-id', e => e.value = '');
  seg('form-admin-titulo', e => e.textContent = 'Añadir Platillo');
  seg('btn-cancelar-edicion', e => e.style.display = 'none');
  const sel = $('admin-platillo-cat');
  if (sel) sel.value = adminCategoriaActiva;
}
seg('btn-cancelar-edicion', el => el.onclick = limpiarForm);
seg('form-nuevo-platillo', el => el.onsubmit = (e) => {
  e.preventDefault();
  const id = $('admin-platillo-id')?.value;
  const cat = $('admin-platillo-cat')?.value;
  const nombre = ($('admin-platillo-nombre')?.value||'').trim();
  const precio = parseFloat($('admin-platillo-precio')?.value||0);
  if (!cat || !nombre || !precio) return;
  
  if (!MENU[cat]) MENU[cat] = [];
  
  if (!id) MENU[cat].push({ id: Date.now().toString(), nombre, precio, agotado: false });
  else {
    Object.keys(MENU).forEach(c => { MENU[c] = MENU[c].filter(x => x.id !== id); });
    MENU[cat].push({ id, nombre, precio, agotado: false });
  }
  guardar(); limpiarForm(); adminCategoriaActiva = cat; window.acat = cat; renderAdmin();
});

seg('btn-nueva-categoria', el => el.onclick = async () => {
  const nombre = await modalPrompt('📂 Nueva Categoría', 'Escribe el nombre de la nueva categoría:', true);
  if (!nombre || !nombre.trim()) return;
  const cat = nombre.trim();
  if (MENU[cat]) return modalPrompt('Error', 'La categoría ya existe.');
  
  MENU[cat] = [];
  adminCategoriaActiva = cat;
  window.acat = cat;
  categoriaActiva = cat;
  
  await guardar();
  renderAdmin(); 
});

// ─── TURNOS MEJORADOS (NATIVOS DE LA UI CON MODALPROMPT) ───
function renderTurnosAdmin() {
  const info = $('turno-info');
  if (!info) return;
  if (turnoActivo) {
    info.innerHTML = `<div class="turno-activo" style="border-left: 5px solid var(--success); padding: 12px; background: rgba(46, 204, 113, 0.1); border-radius:6px; margin-bottom:15px;">
      <h4 style="color: var(--success); margin: 0 0 5px 0;">🟢 Turno en Operación</h4>
      <p style="margin:2px 0; font-size:13px;"><b>ID del Turno:</b> #${turnoActivo.id}</p>
      <p style="margin:2px 0; font-size:13px;"><b>Apertura por:</b> ${usuarios.find(u=>u.id===turnoActivo.usuario_id)?.nombre || 'Usuario Activo'}</p>
      <p style="margin:2px 0; font-size:13px;"><b>Fondo Caja Inicial:</b> ${fmt(turnoActivo.fondo_inicial)}</p>
      <p style="margin:2px 0; font-size:13px;"><b>Hora Inicial:</b> ${new Date(turnoActivo.fecha_apertura).toLocaleTimeString('es-MX')}</p>
      <button class="btn btn-coral btn-sm" style="margin-top:10px;" onclick="cerrarTurno()">🔒 Realizar Arqueo y Cerrar Turno</button>
    </div>`;
    seg('btn-abrir-turno', e => e.style.display = 'none');
  } else {
    info.innerHTML = `<div style="border-left: 5px solid var(--danger); padding: 12px; background: rgba(231, 76, 60, 0.1); border-radius:6px; margin-bottom:15px;">
      <p style="color:var(--danger); font-weight:bold; margin:0;">⚠️ No hay ningún turno abierto actualmente.</p>
      <p style="color:var(--text-muted); font-size:12px; margin:4px 0 0 0;">Debes abrir caja antes de registrar órdenes en el mapa de mesas.</p>
    </div>`;
    seg('btn-abrir-turno', e => e.style.display = 'inline-flex');
  }
}

window.cerrarTurno = async () => {
  const user = await soloAdmin();
  if (!user) return;
  
  const totalStr = await modalPrompt('💰 Arqueo de Caja', 'Escribe el TOTAL de dinero EFECTIVO real que se encuentra físicamente en caja:', true, "Ej: 1500");
  if (totalStr === false) return;
  
  const total = parseFloat(totalStr) || 0;
  try {
    const r = await (await fetch('/api/turno/cerrar', { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body: JSON.stringify({ usuario_id: user.id, total_efectivo_real: total }) 
    })).json();
    
    await cargarTodo();
    if(r.diferencia !== 0) {
      await modalPrompt('⚠️ Turno Cerrado (Con Diferencia)', `El turno se cerró. Existe una diferencia detectada en caja de: ${fmt(r.diferencia)}`);
    } else {
      await modalPrompt('✅ Turno Cerrado Exitosamente', 'El balance de caja cuadró perfectamente sin discrepancias.');
    }
  } catch(e) { await modalPrompt('Error', 'Hubo un error de red al intentar procesar el cierre.'); }
};

seg('btn-abrir-turno', el => el.onclick = async () => {
  const user = await adminOCajero();
  if (!user) return;
  
  const fondoStr = await modalPrompt('💰 Apertura de Caja', 'Ingresa el monto del FONDO INICIAL en efectivo para cambio:', true, "Ej: 500");
  if (fondoStr === false) return;
  
  const fondo = parseFloat(fondoStr) || 0;
  try {
    await fetch('/api/turno/abrir', { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body: JSON.stringify({ usuario_id: user.id, fondo_inicial: fondo }) 
    });
    await cargarTodo();
    await modalPrompt('✅ Éxito', `Caja abierta correctamente con fondo inicial de ${fmt(fondo)}. El sistema está listo para facturar.`);
  } catch(e) { await modalPrompt('Error', 'No se pudo comunicar con el servidor para abrir el turno.'); }
});

// ─── GASTOS ───
function renderGastosAdmin() {
  const cont = $('admin-lista-gastos');
  if (!cont) return;
  if (!listaGastos.length) { cont.innerHTML = '<span style="color:var(--text-muted);font-style:italic;">Sin gastos.</span>'; return; }
  cont.innerHTML = listaGastos.map((g, idx) => `<div style="display:flex;justify-content:space-between;background:var(--bg);padding:4px 8px;border-radius:4px;align-items:center;"><span>📌 ${g.concepto}</span><span><b>-${fmt(g.monto)}</b> <i class="fa-solid fa-circle-xmark" style="color:var(--danger);cursor:pointer;margin-left:6px;" onclick="elimG(${idx})"></i></span></div>`).join('');
}
window.elimG = (idx) => { listaGastos.splice(idx,1); guardar(); renderAdmin(); };

seg('form-nuevo-gasto', el => el.onsubmit = (e) => {
  e.preventDefault();
  if (!turnoActivo) return modalPrompt('Error','No hay turno abierto.');
  const concepto = $('gasto-concepto')?.value.trim();
  const monto = parseFloat($('gasto-monto')?.value||0);
  if (!concepto || !monto) return;
  fetch('/api/retiros', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ turno_id: turnoActivo.id, usuario_id: CURRENT_USER.id||1, concepto, monto }) });
  seg('form-nuevo-gasto', e => e.reset());
});

function calcularReportesAdmin() {
  let efec = 0, tarj = 0, trans = 0, prop = 0;
  historialVentas.forEach(v => {
    if (v.cancelado) return;
    prop += v.propina || 0;
    if ((v.metodo||'').includes('Efectivo')) efec += v.subtotal||0;
    if ((v.metodo||'').includes('Tarjeta')) tarj += v.subtotal||0;
    if ((v.metodo||'').includes('Transferencia')) trans += v.subtotal||0;
  });
  const gastos = listaGastos.reduce((a,g) => a + g.monto, 0);
  seg('rep-efectivo', e => e.textContent = fmt(efec));
  seg('rep-tarjeta', e => e.textContent = fmt(tarj));
  seg('rep-transferencia', e => e.textContent = fmt(trans));
  seg('rep-total-gastos', e => e.textContent = '-'+fmt(gastos));
  seg('rep-total-ventas', e => e.textContent = fmt(efec+tarj+trans-gastos));
  seg('rep-total-propinas', e => e.textContent = fmt(prop));
}

// ─── IMPRIMIR CORTE DE CAJA ───
seg('btn-imprimir-corte', el => el.onclick = () => {
  seg('overlay-ticket', e => e.style.display = 'none');
  let efec = 0, tarj = 0, trans = 0, prop = 0;
  historialVentas.forEach(v => {
    if (v.cancelado) return;
    prop += v.propina||0;
    if ((v.metodo||'').includes('Efectivo')) efec += v.subtotal||0;
    if ((v.metodo||'').includes('Tarjeta')) tarj += v.subtotal||0;
    if ((v.metodo||'').includes('Transferencia')) trans += v.subtotal||0;
  });
  const totalB = efec + tarj + trans;
  const gastos = listaGastos.reduce((a,g) => a + g.monto, 0);
  const bal = totalB - gastos;
  seg('ticket-corte-imprimible', e => {
    e.style.display = 'block';
    e.innerHTML = `<div class="ticket-header"><h3>🐟 MARISCOS MATTY</h3><p><b>*** CORTE DE CAJA ***</b></p><p>${new Date().toLocaleString('es-MX')}</p></div>
      <div class="ticket-calculos" style="background:transparent;padding:0;">
      <div class="ticket-subtotal-linea"><span>💵 Efectivo:</span><span>${fmt(efec)}</span></div>
      <div class="ticket-subtotal-linea"><span>💳 Tarjeta:</span><span>${fmt(tarj)}</span></div>
      <div class="ticket-subtotal-linea"><span>📱 Transf:</span><span>${fmt(trans)}</span></div>
      <hr style="border:1px dashed #000;margin:6px 0;"><div class="ticket-subtotal-linea"><span>💰 Total:</span><span>${fmt(totalB)}</span></div>
      <div class="ticket-subtotal-linea" style="color:var(--success);"><span>❤️ Propinas:</span><span>${fmt(prop)}</span></div>
      <hr style="border:1px dashed #000;margin:6px 0;"><div class="ticket-subtotal-linea" style="color:var(--danger);"><span>📉 Gastos:</span><span>-${fmt(gastos)}</span></div>
      <div class="ticket-total" style="border-top:2px solid #000;padding-top:6px;margin-top:6px;"><span>🧾 BALANCE</span><span>${fmt(bal)}</span></div></div>`;
  });
  setTimeout(() => { window.print(); }, 200);
});

seg('btn-borrar-ventas', el => el.onclick = async () => {
  const u = await soloAdmin();
  if (!u) return;
  if (await modalPrompt('⚠️ Reset', '¿Borrar TODAS las ventas y gastos?')) { historialVentas = []; listaGastos = []; guardar(); renderAdmin(); }
});

seg('btn-agregar-mesa', el => el.onclick = () => { estadoMesas.push({ numero: estadoMesas.length+1, estado:'libre', items:[] }); guardar(); renderAdmin(); });
seg('btn-eliminar-mesa', el => el.onclick = async () => {
  if (!estadoMesas.length) return;
  const ult = estadoMesas[estadoMesas.length-1];
  if (ult.estado !== 'libre') return modalPrompt('Error','Mesa ocupada.');
  if (await modalPrompt('Remover?', `¿Remover Mesa ${ult.numero}?`)) { estadoMesas.pop(); guardar(); renderAdmin(); }
});

// ─── LOGIN ───
const ACCESS_PASSWORD = '12345';

function mostrarLogin() {
  seg('overlay-login', e => e.style.display = 'flex');
  seg('login-password-input', e => { e.value = ''; setTimeout(() => e.focus(), 50); });
  seg('login-error-msg', e => e.style.display = 'none');
}

seg('btn-login-entrar', el => el.onclick = () => {
  const pw = $('login-password-input')?.value || '';
  if (pw === ACCESS_PASSWORD) {
    sessionStorage.setItem('mattyAccesoAutorizado', 'true');
    seg('overlay-login', e => e.style.display = 'none');
    iniciarSistema();
  } else {
    seg('login-error-msg', e => e.style.display = 'block');
    seg('login-password-input', e => { e.value = ''; e.focus(); });
  }
});
seg('login-password-input', el => el.onkeydown = (e) => { if (e.key === 'Enter') { const bt = $('btn-login-entrar'); if (bt) bt.click(); } });

function iniciarSistema() {
  try {
    const saved = sessionStorage.getItem('mattyUser');
    if (saved) { const u = JSON.parse(saved); CURRENT_USER.id = u.id; CURRENT_USER.nombre = u.nombre; CURRENT_USER.rol = u.rol; }
  } catch(e) {}
  cargarTodo();
  actualizarReloj();
  setInterval(actualizarReloj, 30000);
  setInterval(cargarTodo, 4000);
  const badge = document.createElement('span');
  badge.className = 'user-badge';
  badge.innerHTML = `👤 ${CURRENT_USER.nombre||'Sin sesión'}${CURRENT_USER.rol ? ` <span class="rol-badge rol-${CURRENT_USER.rol.toLowerCase()}">${CURRENT_USER.rol}</span>` : ''}`;
  const top = $('top-bar-derecha');
  if (top) top.insertBefore(badge, top.firstChild);
}

(function() {
  if (sessionStorage.getItem('mattyAccesoAutorizado') === 'true') {
    seg('overlay-login', e => e.style.display = 'none');
    iniciarSistema();
  } else mostrarLogin();
})();
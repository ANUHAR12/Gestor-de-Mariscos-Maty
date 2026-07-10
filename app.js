// ═══════════════════════════════════════════════════════════
//  MARISCOS MATTY - SOFT RESTAURANT EDITION
// ═══════════════════════════════════════════════════════════

const CURRENT_USER = { id: null, nombre: '', rol: '' };
let AUTH_TOKEN = '';
let MENU = {}, estadoMesas = [], pedidosVirtuales = [], comandasCocina = [];
let historialVentas = [], listaGastos = [];
let usuarios = [];

let mesaActivaIndex = null, esMesaVirtualActiva = false;
let cuentaSeparadaActiva = [], esCobroParcialDeDivision = false;
let categoriaActiva = '', adminCategoriaActiva = '';
let porcentajePropina = 10, metodoPagoActivo = 'Efectivo', busquedaFiltro = '', ticketFueImpreso = false;
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
    AUTH_TOKEN = d.token || '';
    sessionStorage.setItem('mattyUser', JSON.stringify(CURRENT_USER));
    sessionStorage.setItem('mattyToken', AUTH_TOKEN);
    return d.usuario;
  } catch(e) { return null; }
}

// Cabecera de autorización para endpoints protegidos (requireRol en el servidor)
function authHeaders() {
  return AUTH_TOKEN ? { 'Authorization': 'Bearer ' + AUTH_TOKEN } : {};
}

async function modalPrompt(titulo, mensaje, conInput = false, placeholderInput = "", inputType = "text") {
  return new Promise((resolver) => {
    resolverUIModal = resolver;
    seg('ui-modal-titulo', e => e.textContent = titulo);
    seg('ui-modal-mensaje', e => e.textContent = mensaje);
    const inp = $('ui-modal-input');
    if (inp) {
      inp.value = '';
      inp.placeholder = placeholderInput;
      inp.type = inputType;
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
  const pw = await modalPrompt('🔐 Autorización Requerida', 'Ingresa tu PIN:', true, '', 'password');
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

    // 🔥 EL AJUSTE: Si el mesero tiene el teclado abierto escribiendo una nota o buscando un platillo,
    // detenemos el rediseño para que la pantalla no le parpadee ni le borre lo que escribe.
    if (document.activeElement && (
        document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA'
    )) {
        // La computadora de la cocina como no usa teclado, ignorará esto y seguirá actualizándose sola.
        return; 
    }

    // Aquí continúa tu código original intacto...
    estadoMesas = d.mesas||[]; pedidosVirtuales = d.virtuales||[];
    comandasCocina = d.comandas||[]; historialVentas = d.ventas||[];
    listaGastos = d.gastos||[]; 
    
    const categoriasLocales = Object.keys(MENU);
    MENU = d.menu||{};
    categoriasLocales.forEach(cat => {
      if (!MENU[cat]) MENU[cat] = [];
    });

    usuarios = d.usuarios||[];
    if (!categoriaActiva && Object.keys(MENU).length > 0) { 
      categoriaActiva = Object.keys(MENU)[0]; 
      adminCategoriaActiva = Object.keys(MENU)[0]; 
    }
    
    redibujar();
  } catch(e) { console.error('Sync:', e); }
}

async function guardar() {
  try {
    // Nota: ventas y gastos NO se mandan aquí; tienen sus propios endpoints
    // (/api/ventas y /api/retiros) que son la fuente de verdad en la BD.
    await fetch('/api/estado', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ mesas:estadoMesas, virtuales:pedidosVirtuales, comandas:comandasCocina, menu:MENU }) });
  } catch(e) { console.error('Save:', e); }
}

function redibujar() {
  const b = $('badge-cocina-count'); if (b) b.textContent = comandasCocina.length;
  try {
    if ($('vista-mesa').style.display === 'block') { renderOrden(); return; }
    if ($('vista-admin').style.display === 'block') { renderAdmin(); return; }
    if ($('seccion-mesas')?.style.display === 'block') renderMapa();
    if ($('seccion-virtuales')?.style.display === 'block') renderPedidosVirtuales();
    if ($('seccion-cocina')?.style.display === 'block') renderPantallaCocina();
  } catch(e) {}
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
    c.onclick = () => { esMesaVirtualActiva = false; abrirMesa(idx, `Mesa ${mesa.numero}`); };
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

seg('btn-nuevo-pedido-v', el => el.onclick = () => {
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
  const orden = obtenerMesa();
  if (!orden) return;
  
  // 🔥 EL AJUSTE: Buscar si ya existe el platillo, PERO QUE NO HAYA SIDO ENVIADO TODAVÍA
  const ex = orden.items.find(it => it.id === platillo.id && !it.enviado);
  
  if (ex) {
    // Si hay uno igual sin enviar, le suma uno libremente
    ex.cantidad += 1;
  } else {
    // Si ya fue enviado, o no existe, crea un renglón NUEVO e independiente
    // ⚠️ IMPORTANTE: Le agregamos la hora actual al ID (platillo.id + '-' + Date.now()) 
    // para que este nuevo renglón tenga su propio ID único y no se mezcle al cambiar la cantidad.
    orden.items.push({ 
      id: platillo.id + '-' + Date.now(), 
      nombre: platillo.nombre, 
      precio: platillo.precio, 
      Clinical_id: null, 
      cantidad: 1, 
      nota: '', 
      enviado: false 
    });
  }
  
  if (orden.estado === 'libre') orden.estado = 'ocupada';
  guardar(); renderMesa();
}

async function cambiarCantidad(itemId, delta) {
  const orden = obtenerMesa();
  const item = orden.items.find(it => it.id === itemId);
  if (!item) return;
  
  // Si el renglón específico ya fue enviado a cocina, pide clave de administrador
  if (item.enviado) { 
    const u = await soloAdmin(); 
    if (!u) return; 
  }
  
  item.cantidad += delta;
  if (item.cantidad <= 0) orden.items = orden.items.filter(it => it.id !== itemId);
  if (!orden.items.length && !esMesaVirtualActiva) orden.estado = 'libre';
  guardar(); renderMesa();
}

// ─── CUADRO DE COMANDAS ENVIADAS (historial visible dentro de la mesa) ───
function renderComandasEnviadas() {
  const orden = obtenerMesa();
  const caja = $('caja-comandas-enviadas');
  const cont = $('lista-comandas-enviadas');
  if (!caja || !cont) return;
  const historial = (orden && orden.comandasEnviadas) || [];
  if (!historial.length) { caja.style.display = 'none'; cont.innerHTML = ''; return; }
  caja.style.display = 'block';
  cont.innerHTML = historial.map(com => {
    const hora = new Date(com.hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const itemsHtml = com.items.map(it => `<span>${it.cantidad}x ${it.nombre}${it.nota ? ' — ⚠️ ' + it.nota : ''}</span>`).join('');
    return `<div class="comanda-enviada-linea">
      <div class="comanda-enviada-hora">🕐 ${hora}</div>
      <div class="comanda-enviada-items">${itemsHtml}</div>
    </div>`;
  }).join('');
}

function renderOrden() {
  const orden = obtenerMesa();
  renderComandasEnviadas();
  const cont = $('orden-lista'); if (!cont) return; cont.innerHTML = '';

  // 🔥 Los platillos ya enviados a cocina se dejan de mostrar aquí (ahora viven en el
  // cuadro "Comandas enviadas" de arriba); en este panel solo se ven los nuevos, para
  // no confundir con el candado 🔒 pensando que hay que volver a enviarlos.
  const itemsPendientes = (orden ? orden.items : []).filter(it => !it.enviado);

  if (!orden || !orden.items.length) cont.innerHTML = '<p class="orden-vacia">🛒 Aún no hay productos.</p>';
  else if (!itemsPendientes.length) cont.innerHTML = '<p class="orden-vacia">✅ Ya enviado a cocina. Agrega más productos si hace falta.</p>';
  else {
    itemsPendientes.forEach(it => {
      const row = document.createElement('div'); row.className = 'orden-item';
      row.innerHTML = `<div style="flex:1;min-width:0">
          <div class="nombre">${it.nombre}</div>
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
  // El total sigue sumando TODOS los productos de la mesa (enviados y nuevos), no solo los visibles.
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
  else { orden.items = []; orden.estado = 'libre'; orden.comandasEnviadas = []; }
  guardar(); regresar();
}
seg('btn-cancelar-mesa', el => el.onclick = cancelarMesa);

// ─── COMANDA A COCINA ───
seg('btn-enviar-cocina', el => el.onclick = async () => {
  const orden = obtenerMesa();
  if (!orden || !orden.items.length) return modalPrompt('Aviso','No hay platillos para enviar.');
  // Antes se reenviaban TODOS los items (incluso los ya enviados) cada vez que se
  // presionaba el botón, duplicando el pedido completo en cocina. Ahora sólo se manda
  // lo nuevo, y si la mesa ya tenía una comanda previa, se marca como "AGREGADO".
  const itemsNuevos = orden.items.filter(it => !it.enviado);
  if (!itemsNuevos.length) return modalPrompt('Aviso','No hay platillos nuevos para enviar a cocina.');
  const esAgregado = orden.items.some(it => it.enviado);
  const origen = esMesaVirtualActiva ? `${orden.tipo} (${(orden.cliente||'').substring(0,8)})` : `Mesa ${orden.numero}`;
  const horaEnvio = new Date().toISOString();
  comandasCocina.push({ id: Date.now().toString(), origen, esAgregado, horaEntrada: horaEnvio, estado:'activa',
    items: itemsNuevos.map(it => ({ nombre: it.nombre, cantidad: it.cantidad, nota: it.nota||'', estado:'pendiente' })) });

  // 📋 Registro visible en el cuadro "Comandas enviadas" de la mesa: qué se pidió y a qué hora,
  // para que al reabrir la mesa se pueda ver el historial de lo que ya se mandó a cocina.
  if (!orden.comandasEnviadas) orden.comandasEnviadas = [];
  orden.comandasEnviadas.push({
    hora: horaEnvio,
    items: itemsNuevos.map(it => ({ nombre: it.nombre, cantidad: it.cantidad, nota: it.nota||'' }))
  });

  itemsNuevos.forEach(it => { it.enviado = true; });
  guardar(); renderOrden();
  modalPrompt('✅ Éxito', esAgregado ? '🔺 Agregado enviado a la cocina.' : 'Comanda enviada a la cocina.');
});

// ─── PANTALLA COCINA ───
function renderPantallaCocina() {
  const grid = $('grid-comandas-cocina'); if (!grid) return; grid.innerHTML = '';
  if (!comandasCocina.length) { grid.innerHTML = '<p class="empty-state">🔥 Cocina limpia.</p>'; return; }
  comandasCocina.forEach((com, idx) => {
    const min = Math.floor((new Date() - new Date(com.horaEntrada)) / 60000);
    const card = document.createElement('div');
    card.className = 'comanda-card ' + (min >= 15 ? 'critica' : 'lista');
    if (com.esAgregado) card.style.borderLeftColor = 'var(--warning)';
    card.innerHTML = `<div class="comanda-header"><span class="comanda-origen">${com.origen} ${com.esAgregado ? '<span class="agotado-badge" style="background:var(--warning);">🔺 AGREGADO</span>' : ''}</span><span class="comanda-tiempo">⏱️ ${min} min</span></div>
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
  metodoPagoActivo = 'Efectivo'; actualizarBotonesMetodo();
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

  // Cálculo del cambio a entregar (antes nunca se mostraba, aunque el bloque existía en el HTML)
  const pago = parseFloat($('pago-recibido')?.value || 0);
  if (metodoPagoActivo === 'Efectivo' && pago > 0) {
    const cambio = pago - total;
    seg('bloque-cambio', e => e.style.display = 'flex');
    seg('ticket-cambio-valor', e => e.textContent = fmt(Math.max(cambio, 0)));
  } else {
    seg('bloque-cambio', e => e.style.display = 'none');
  }
}

function actualizarBotonesPropina() {
  document.querySelectorAll('.btn-propina:not(.btn-metodo)').forEach(btn => {
    const pct = parseInt(btn.dataset.pct);
    btn.style.background = pct === porcentajePropina ? 'var(--primary)' : 'var(--border)';
    btn.style.color = pct === porcentajePropina ? 'white' : 'var(--text)';
  });
}
document.querySelectorAll('.btn-propina:not(.btn-metodo)').forEach(btn => {
  btn.onclick = () => { porcentajePropina = parseInt(btn.dataset.pct); actualizarBotonesPropina(); calcularPrecios(); };
});

// ─── SELECTOR DE MÉTODO DE PAGO (antes no existía: todo se registraba como "Efectivo") ───
function actualizarBotonesMetodo() {
  document.querySelectorAll('.btn-metodo').forEach(btn => {
    const activo = btn.dataset.metodo === metodoPagoActivo;
    btn.style.background = activo ? 'var(--primary)' : 'var(--border)';
    btn.style.color = activo ? 'white' : 'var(--text)';
  });
  const esEfectivo = metodoPagoActivo === 'Efectivo';
  seg('bloque-pago-efectivo', e => e.style.display = esEfectivo ? 'block' : 'none');
  if (!esEfectivo) { seg('pago-recibido', e => e.value = ''); seg('bloque-cambio', e => e.style.display = 'none'); }
}
document.querySelectorAll('.btn-metodo').forEach(btn => {
  btn.onclick = () => { metodoPagoActivo = btn.dataset.metodo; actualizarBotonesMetodo(); calcularPrecios(); };
});

// El cierre de la mesa ahora ocurre automáticamente al imprimir el ticket (btn-imprimir),
// por eso ya no existe un botón/flujo separado de "Finalizar y Cerrar".

function ejecutarCierreDeMesaFisico(orden, prods, subtotal, propina) {
  try {
    fetch('/api/ventas', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fecha: new Date().toISOString(), mesa: orden ? (esMesaVirtualActiva ? orden.tipo : `Mesa ${orden.numero}`) : 'Varios',
        subtotal, propina, propina_metodo: metodoPagoActivo, metodo: metodoPagoActivo,
        items: prods.map(it => ({ id: it.id, nombre: it.nombre, precio: it.precio, cantidad: it.cantidad })),
        mesero_id: CURRENT_USER.id||null }) });
  } catch(e) { console.error(e); }
  
  if (esCobroParcialDeDivision) { cuentaSeparadaActiva = []; if (orden && !orden.items.length && !esMesaVirtualActiva) orden.estado = 'libre'; }
  else {
    // Al imprimir la cuenta y cerrar la mesa por completo, se limpia también el cuadro
    // de "Comandas enviadas" para que la siguiente mesa/pedido empiece en blanco.
    if (esMesaVirtualActiva) pedidosVirtuales.splice(mesaActivaIndex,1);
    else if (orden) { orden.items = []; orden.estado = 'libre'; orden.comandasEnviadas = []; }
  }
  guardar();
  seg('overlay-ticket', e => e.style.display = 'none');
  regresar();
}

// ─── IMPRIMIR TICKET DE CONSUMO (diseño térmico dedicado 58mm) ───
function construirTicketVenta({ titulo, prods, subtotal, propina, total, metodo, pagoRecibido, cambio }) {
  const fecha = new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  const itemsHtml = prods.map(it => `<div>
      <div class="t58-item-fila"><span class="t58-item-nombre">${it.cantidad}x ${it.nombre}</span><span class="t58-item-precio">${fmt(it.precio * it.cantidad)}</span></div>
      ${it.nota ? `<div class="t58-item-nota">· ${it.nota}</div>` : ''}
    </div>`).join('');

  const metodoIcono = metodo === 'Efectivo' ? '💵' : metodo === 'Tarjeta' ? '💳' : '📱';
  const pagoHtml = (metodo === 'Efectivo' && pagoRecibido)
    ? `<div class="t58-linea"><span>Recibido</span><span>${fmt(pagoRecibido)}</span></div>
       <div class="t58-linea"><span>Cambio</span><span>${fmt(cambio||0)}</span></div>`
    : '';

  return `
    <div class="t58-header">
      <div class="t58-logo">🐟 MARISCOS MATTY</div>
      <div class="t58-tagline">¡Sabor fresco de la costa!</div>
      <div class="t58-meta">${titulo}</div>
      <div class="t58-meta">${fecha}</div>
      ${CURRENT_USER.nombre ? `<div class="t58-meta">Atendió: ${CURRENT_USER.nombre}</div>` : ''}
    </div>
    <div class="t58-divisor"></div>
    <div class="t58-items">${itemsHtml}</div>
    <div class="t58-divisor"></div>
    <div class="t58-totales">
      <div class="t58-linea"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
      <div class="t58-linea"><span>Propina</span><span>${fmt(propina)}</span></div>
      <div class="t58-linea t58-total"><span>TOTAL</span><span>${fmt(total)}</span></div>
    </div>
    <div class="t58-divisor"></div>
    <div class="t58-totales">
      <div class="t58-linea"><span>${metodoIcono} Método</span><span>${metodo}</span></div>
      ${pagoHtml}
    </div>
    <div class="t58-footer">
      <div class="t58-divisor"></div>
      <p>¡Gracias por su visita!</p>
      <p>Vuelva pronto 🦐</p>
    </div>`;
}

function imprimirTicketVenta(datos) {
  seg('ticket-corte-imprimible', e => e.style.display = 'none');
  seg('ticket-venta-imprimible', e => {
    e.innerHTML = construirTicketVenta(datos);
    e.style.display = 'block';
  });
  setTimeout(() => {
    window.print();
    // Ocultarlo de nuevo justo después de mandar a imprimir, para que no se quede
    // visible en la pantalla normal del POS (solo debe aparecer en el papel impreso).
    seg('ticket-venta-imprimible', e => { e.style.display = 'none'; e.innerHTML = ''; });
  }, 200);
}

seg('btn-imprimir', el => el.onclick = () => {
  const orden = obtenerMesa();
  const prods = esCobroParcialDeDivision ? cuentaSeparadaActiva : (orden ? orden.items : []);
  const subtotal = sub(prods);
  const propina = subtotal * (porcentajePropina / 100);
  const total = subtotal + propina;
  const titulo = esMesaVirtualActiva ? (orden ? orden.tipo : '') : `Mesa ${orden ? orden.numero : ''}`;
  const pagoRecibido = metodoPagoActivo === 'Efectivo' ? parseFloat($('pago-recibido')?.value || 0) : null;
  const cambio = pagoRecibido ? Math.max(pagoRecibido - total, 0) : null;

  // Antes de imprimir se valida que haya suficiente efectivo (si aplica), igual que
  // antes se validaba en "Finalizar y Cerrar", ya que ese botón desapareció y ahora
  // Imprimir Ticket es quien cierra la mesa.
  if (metodoPagoActivo === 'Efectivo' && pagoRecibido < total) {
    return modalPrompt('Error', 'Efectivo insuficiente.');
  }

  imprimirTicketVenta({ titulo, prods, subtotal, propina, total, metodo: metodoPagoActivo, pagoRecibido, cambio });

  setTimeout(() => {
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

let filtroPlatillo = '';

function renderAdmin() {
  seg('admin-total-mesas', e => e.textContent = estadoMesas.length);

  const sel = $('admin-platillo-cat');
  if (sel) {
    const catSeleccionadaAnterior = sel.value || adminCategoriaActiva;
    sel.innerHTML = Object.keys(MENU).map(c => `<option value="${c}">${c}</option>`).join('');
    if (MENU[catSeleccionadaAnterior]) sel.value = catSeleccionadaAnterior;
  }
  
  const btns = $('admin-lista-categorias-btns');
  if (btns) {
    if (!adminCategoriaActiva && Object.keys(MENU).length > 0) adminCategoriaActiva = Object.keys(MENU)[0];
    btns.innerHTML = Object.keys(MENU).map(cat => `<button class="cat-btn ${cat === adminCategoriaActiva ? 'activo' : ''}" style="padding:6px 14px;font-size:12px;" onclick="window.acat='${cat}'; adminCategoriaActiva='${cat}'; renderAdmin()">${cat} <span class="cat-btn-contador">${(MENU[cat]||[]).length}</span></button>`).join('');
  }
  
  const tbody = $('cuerpo-tabla-admin');
  if (tbody) {
    const cat = window.acat || adminCategoriaActiva;
    adminCategoriaActiva = cat;
    const platillosCat = MENU[cat] || [];
    seg('admin-contador-platillos', e => e.textContent = platillosCat.length);
    const filtro = filtroPlatillo.trim().toLowerCase();
    const visibles = filtro ? platillosCat.filter(p => p.nombre.toLowerCase().includes(filtro)) : platillosCat;
    if (visibles.length > 0) {
      tbody.innerHTML = visibles.map(p => `<tr class="${p.agotado ? 'fila-agotado' : ''}">
          <td><strong>${p.nombre}</strong></td>
          <td>${fmt(p.precio)}</td>
          <td><span class="estado-badge ${p.agotado ? 'estado-agotado' : 'estado-disponible'}" onclick="toggleAgotado('${cat}','${p.id}')" title="Clic para cambiar">${p.agotado ? '⛔ Agotado' : '✅ Disponible'}</span></td>
          <td><button class="btn btn-sm" onclick="editarP('${p.id}','${cat}')" title="Editar"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm btn-coral" onclick="elimP('${cat}','${p.id}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`).join('');
    } else if (filtro) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding: 20px;">🔎 Sin resultados para "' + filtro + '".</td></tr>';
    } else {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding: 20px;">📂 Categoría recién creada y vacía. Añade un platillo usando el formulario de arriba.</td></tr>';
    }
  }
  calcularReportesAdmin();
  renderGastosAdmin();
}

seg('admin-buscar-platillo', el => el.oninput = () => { filtroPlatillo = el.value; renderAdmin(); });

// Alterna la disponibilidad de un platillo (se refleja de inmediato en el punto de venta:
// las tarjetas "agotadas" se deshabilitan automáticamente para los meseros).
window.toggleAgotado = async (cat, id) => {
  const p = MENU[cat]?.find(x => x.id === id);
  if (!p) return;
  p.agotado = !p.agotado;
  await guardar();
  renderAdmin();
};

window.editarP = (id, cat) => {
  const p = MENU[cat]?.find(x => x.id === id);
  if (!p) return;
  seg('form-admin-titulo', e => e.textContent = '✏️ Modificar');
  seg('admin-platillo-id', e => e.value = id);
  seg('admin-platillo-cat', e => e.value = cat);
  seg('admin-platillo-nombre', e => e.value = p.nombre);
  seg('admin-platillo-precio', e => e.value = p.precio);
  seg('admin-platillo-agotado', e => e.checked = !!p.agotado);
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
  const agotado = !!$('admin-platillo-agotado')?.checked;
  if (!cat || !nombre || !precio) return;
  
  if (!MENU[cat]) MENU[cat] = [];
  
  if (!id) MENU[cat].push({ id: Date.now().toString(), nombre, precio, agotado });
  else {
    Object.keys(MENU).forEach(c => { MENU[c] = MENU[c].filter(x => x.id !== id); });
    MENU[cat].push({ id, nombre, precio, agotado });
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

// Elimina la categoría completa (y todos sus platillos) tras confirmar dos veces datos concretos.
seg('btn-eliminar-categoria', el => el.onclick = async () => {
  const u = await soloAdmin();
  if (!u) return;
  const cat = window.acat || adminCategoriaActiva;
  if (!cat || !MENU[cat]) return modalPrompt('Error', 'Selecciona una categoría primero.');
  const cantidad = MENU[cat].length;
  const confirmacion = await modalPrompt('⚠️ Eliminar Categoría', `Esto eliminará "${cat}" y sus ${cantidad} platillo(s). Esta acción no se puede deshacer. ¿Continuar?`);
  if (!confirmacion) return;
  delete MENU[cat];
  const restantes = Object.keys(MENU);
  adminCategoriaActiva = restantes[0] || '';
  window.acat = adminCategoriaActiva;
  await guardar();
  renderAdmin();
});

// ─── CORTE DE CAJA POR RANGO DE FECHAS ───
// El sistema ya no requiere abrir/cerrar turno: opera de forma continua y el
// corte de caja se genera bajo demanda para el rango de fechas que se necesite.
function rangoFechaHoy() {
  const hoy = new Date().toISOString().slice(0, 10);
  return { desde: hoy, hasta: hoy };
}

seg('corte-fecha-desde', el => { const r = rangoFechaHoy(); el.value = r.desde; });
seg('corte-fecha-hasta', el => { const r = rangoFechaHoy(); el.value = r.hasta; });

seg('btn-generar-corte', el => el.onclick = () => generarCorteCaja());

async function generarCorteCaja() {
  const user = await adminOCajero();
  if (!user) return;
  const desde = $('corte-fecha-desde')?.value || rangoFechaHoy().desde;
  const hasta = $('corte-fecha-hasta')?.value || rangoFechaHoy().hasta;
  try {
    const r = await (await fetch(`/api/reportes/corte?desde=${desde}&hasta=${hasta}`, { headers: authHeaders() })).json();
    if (!r.okey) return modalPrompt('Error', r.error || 'No se pudo generar el corte de caja.');
    const d = r.desglose;
    seg('admin-corte-resultado', e => {
      e.style.display = 'block';
      e.innerHTML = `<div class="corte-resultado-box">
        <p class="corte-resultado-periodo"><b>Periodo:</b> ${desde}${hasta !== desde ? ' a ' + hasta : ''}</p>
        <div class="corte-resultado-linea"><span>💵 Efectivo</span><b>${fmt(d.efectivo)}</b></div>
        <div class="corte-resultado-linea"><span>💳 Tarjeta</span><b>${fmt(d.tarjeta)}</b></div>
        <div class="corte-resultado-linea"><span>📱 Transferencia</span><b>${fmt(d.transferencia)}</b></div>
        <div class="corte-resultado-linea" style="color:var(--success);"><span>❤️ Propinas</span><b>${fmt(d.propinas)}</b></div>
        <div class="corte-resultado-linea" style="color:var(--danger);"><span>📉 Gastos</span><b>-${fmt(d.gastos)}</b></div>
        <div class="corte-resultado-total"><span>🧾 Total Neto</span><span>${fmt(d.totalNeto)}</span></div>
      </div>`;
    });
    imprimirCorte({ efec: d.efectivo, tarj: d.tarjeta, trans: d.transferencia, prop: d.propinas, gastos: d.gastos, gastosDetalle: r.gastosDetalle, periodo: desde === hasta ? desde : `${desde} a ${hasta}` });

    // El cierre de caja (borrar ventas del día + cerrar la página) sólo aplica cuando
    // el corte impreso es justo el de HOY; si se consulta un rango de fechas pasado
    // (para revisar historial) no se debe borrar nada ni cerrar la pestaña.
    const hoy = rangoFechaHoy().desde;
    if (desde === hoy && hasta === hoy) {
      cerrarCajaDelDia();
    }
  } catch (e) { await modalPrompt('Error', 'Hubo un error de red al generar el corte de caja.'); }
}

// Borra las ventas y los gastos del día en el servidor, deja la pantalla en blanco
// de inmediato (sin esperar el refresco automático de 4s ni a que la pestaña cierre)
// y luego intenta cerrar la pestaña/ventana, dando tiempo a que se complete la
// impresión del corte antes de hacerlo.
let intervaloAuto = null;

async function cerrarCajaDelDia() {
  try {
    await Promise.all([
      fetch('/api/ventas/dia', { method: 'DELETE', headers: authHeaders() }),
      fetch('/api/retiros/dia', { method: 'DELETE', headers: authHeaders() })
    ]);
  } catch (e) { console.error('No se pudieron borrar las ventas/gastos del día:', e); }

  // Detenemos el auto-refresh para que no sobreescriba los datos locales
  // con datos viejos del servidor que aún no se han borrado.
  if (intervaloAuto) {
    clearInterval(intervaloAuto);
    intervaloAuto = null;
  }

  // Dejamos en blanco de inmediato: ventas, gastos y el balance (que se calcula
  // a partir de ambos), sin depender de que la pestaña se cierre.
  historialVentas = [];
  listaGastos = [];
  renderAdmin();

  setTimeout(() => {
    window.close();
    // Muchos navegadores bloquean el cierre de pestañas que el usuario abrió manualmente
    // (no vía script). Si el cierre no se pudo hacer, avisamos para que la cierre a mano.
    setTimeout(() => {
      modalPrompt('✅ Caja Cerrada', 'Las ventas y gastos del día fueron eliminados. Puedes cerrar esta ventana.');
    }, 300);
  }, 1500);
}

// ─── GASTOS ───
function renderGastosAdmin() {
  const cont = $('admin-lista-gastos');
  if (!cont) return;
  if (!listaGastos.length) { cont.innerHTML = '<span class="admin-item-vacio">Sin gastos.</span>'; return; }
  cont.innerHTML = listaGastos.map(g => `<div class="admin-item-fila"><span>📌 ${g.concepto}</span><span><b>-${fmt(g.monto)}</b> <i class="fa-solid fa-circle-xmark admin-item-icono-accion" onclick="elimG(${g.id})"></i></span></div>`).join('');
}
// Antes esto sólo borraba el gasto en el navegador: como el servidor ignoraba el campo
// "gastos" al guardar, el gasto "revivía" en el siguiente refresco automático (cada 4s).
// Ahora se elimina realmente en la base de datos.
window.elimG = async (id) => {
  const u = await soloAdmin();
  if (!u) return;
  try {
    await fetch('/api/retiros/' + id, { method: 'DELETE' });
    await cargarTodo();
    renderAdmin();
  } catch(e) { modalPrompt('Error', 'No se pudo eliminar el gasto.'); }
};

seg('form-nuevo-gasto', el => el.onsubmit = async (e) => {
  e.preventDefault();
  const concepto = $('gasto-concepto')?.value.trim();
  const monto = parseFloat($('gasto-monto')?.value||0);
  if (!concepto || !monto) return;
  try {
    const r = await fetch('/api/retiros', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ usuario_id: CURRENT_USER.id||1, concepto, monto }) });
    const d = await r.json();
    if (!r.ok) return modalPrompt('Error', d.error || 'No se pudo registrar el gasto.');
    seg('form-nuevo-gasto', e2 => e2.reset());
    // Antes el gasto no aparecía hasta el siguiente refresco automático (hasta 4s después),
    // dando la impresión de que "no se registraba". Ahora se refleja de inmediato.
    await cargarTodo();
    renderAdmin();
  } catch(e) { modalPrompt('Error', 'Error de red al registrar el gasto.'); }
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

// ─── IMPRIMIR CORTE DE CAJA (mismo diseño térmico t58, refactorizado en función reutilizable) ───
function imprimirCorte({ efec, tarj, trans, prop, gastos, gastosDetalle, periodo }) {
  seg('ticket-venta-imprimible', e => e.style.display = 'none');
  const totalB = efec + tarj + trans;
  const bal = totalB - gastos;
  const listaGastosHtml = (gastosDetalle && gastosDetalle.length)
    ? gastosDetalle.map(g => `<div class="t58-linea" style="font-size:9px;"><span>· ${g.concepto}</span><span>-${fmt(g.monto)}</span></div>`).join('')
    : '';
  seg('ticket-corte-imprimible', e => {
    e.style.display = 'block';
    e.innerHTML = `
      <div class="t58-header">
        <div class="t58-logo">🐟 MARISCOS MATTY</div>
        <div class="t58-corte-titulo">*** Corte de Caja ***</div>
        ${periodo ? `<div class="t58-meta">Periodo: ${periodo}</div>` : ''}
        <div class="t58-meta">${new Date().toLocaleString('es-MX')}</div>
      </div>
      <div class="t58-divisor"></div>
      <div class="t58-totales">
        <div class="t58-linea"><span>💵 Efectivo</span><span>${fmt(efec)}</span></div>
        <div class="t58-linea"><span>💳 Tarjeta</span><span>${fmt(tarj)}</span></div>
        <div class="t58-linea"><span>📱 Transf.</span><span>${fmt(trans)}</span></div>
        <div class="t58-linea t58-total" style="font-size:12px;"><span>Total</span><span>${fmt(totalB)}</span></div>
      </div>
      <div class="t58-divisor"></div>
      <div class="t58-totales">
        <div class="t58-linea"><span>❤️ Propinas</span><span>${fmt(prop)}</span></div>
      </div>
      <div class="t58-divisor"></div>
      <div class="t58-totales">
        <div class="t58-linea"><span>📉 Gastos</span><span>-${fmt(gastos)}</span></div>
        ${listaGastosHtml}
      </div>
      <div class="t58-divisor"></div>
      <div class="t58-totales">
        <div class="t58-linea t58-total"><span>🧾 Balance</span><span>${fmt(bal)}</span></div>
      </div>
      <div class="t58-footer">
        <div class="t58-divisor"></div>
        <p>Corte generado por sistema</p>
      </div>`;
  });
  setTimeout(() => {
    window.print();
    seg('ticket-corte-imprimible', e => { e.style.display = 'none'; e.innerHTML = ''; });
  }, 200);
}

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
    AUTH_TOKEN = sessionStorage.getItem('mattyToken') || '';
  } catch(e) {}
  cargarTodo();
  actualizarReloj();
  setInterval(actualizarReloj, 30000);
  intervaloAuto = setInterval(cargarTodo, 4000);
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
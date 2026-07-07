// Contraseña del administrador
const ADMIN_PASSWORD = "1234";

// Estructura limpia inicial
const MENU_INICIAL = {
    "Camarones": [
        { id: "1719870000001", nombre: "Camarones Empanizados", precio: 220 },
        { id: "1719870000002", nombre: "Aguachile Rojo", precio: 240 },
        { id: "1719870000003", nombre: "Aguachile Verde", precio: 240 }
    ],
    "Filetes": [
        { id: "1719870000004", nombre: "Filete a la Plancha", precio: 210 },
        { id: "1719870000005", nombre: "Filete Empanizado", precio: 220 }
    ],
    "Burritos": [
        { id: "1719870000006", nombre: "Burrito de Camarón", precio: 180 }
    ],
    "Bebidas": [
        { id: "1719870000007", nombre: "Agua Fresca", precio: 35 },
        { id: "1719870000008", nombre: "Refresco", precio: 30 }
    ]
};

const CLAVE_MESAS = "pos-mariscos-matty-mesas";
const CLAVE_VIRTUALES = "pos-mariscos-matty-virtuales";
const CLAVE_MENU = "pos-mariscos-matty-menu";
const CLAVE_VENTAS = "pos-mariscos-matty-ventas";
const CLAVE_COMANDAS = "pos-mariscos-matty-comandas";
const CLAVE_GASTOS = "pos-mariscos-matty-gastos"; // NUEVO

let MENU = {};
let estadoMesas = [];
let pedidosVirtuales = []; 
let comandasCocina = [];   
let historialVentas = [];
let listaGastos = []; // NUEVO

let mesaActivaIndex = null;
let esMesaVirtualActiva = false; 
let cuentaSeparadaActiva = [];  
let esCobroParcialDeDivision = false;

let categoriaActiva = "";
let adminCategoriaActiva = "";
let porcentajePropina = 10;
let busquedaFiltro = "";

// Cargar todo desde LocalStorage
function cargarTodo() {
    const menuGuardado = localStorage.getItem(CLAVE_MENU);
    if (menuGuardado) MENU = JSON.parse(menuGuardado);
    else { MENU = MENU_INICIAL; guardarMenu(); }
    categoriaActiva = Object.keys(MENU)[0] || "";
    adminCategoriaActiva = Object.keys(MENU)[0] || "";

    const mesasGuardadas = localStorage.getItem(CLAVE_MESAS);
    if (mesasGuardadas) estadoMesas = JSON.parse(mesasGuardadas);
    else {
        estadoMesas = [];
        for (let i = 1; i <= 10; i++) estadoMesas.push({ numero: i, estado: "libre", items: [] });
        guardarMesas();
    }

    const virtualesGuardados = localStorage.getItem(CLAVE_VIRTUALES);
    pedidosVirtuales = virtualesGuardados ? JSON.parse(virtualesGuardados) : [];

    const comandasGuardadas = localStorage.getItem(CLAVE_COMANDAS);
    comandasCocina = comandasGuardadas ? JSON.parse(comandasGuardadas) : [];

    const ventasGuardadas = localStorage.getItem(CLAVE_VENTAS);
    historialVentas = ventasGuardadas ? JSON.parse(ventasGuardadas) : [];

    // NUEVO: Inicializar carga de gastos
    const gastosGuardados = localStorage.getItem(CLAVE_GASTOS);
    listaGastos = gastosGuardados ? JSON.parse(gastosGuardados) : [];
}

function guardarMesas() { localStorage.setItem(CLAVE_MESAS, JSON.stringify(estadoMesas)); }
function guardarVirtuales() { localStorage.setItem(CLAVE_VIRTUALES, JSON.stringify(pedidosVirtuales)); }
function guardarMenu() { localStorage.setItem(CLAVE_MENU, JSON.stringify(MENU)); }
function guardarVentas() { localStorage.setItem(CLAVE_VENTAS, JSON.stringify(historialVentas)); }
function guardarComandas() { localStorage.setItem(CLAVE_COMANDAS, JSON.stringify(comandasCocina)); }
function guardarGastos() { localStorage.setItem(CLAVE_GASTOS, JSON.stringify(listaGastos)); } // NUEVO

// Formateadores y Ayudantes
function formatoMoneda(valor) { return "$" + Math.round(valor).toLocaleString("es-MX"); }
function obtenerMesaUOrdenActual() { return esMesaVirtualActiva ? pedidosVirtuales[mesaActivaIndex] : estadoMesas[mesaActivaIndex]; }
function guardarMesaUOrdenActual() { if (esMesaVirtualActiva) guardarVirtuales(); else guardarMesas(); }
function calcularSubtotalMesa(mesa) { 
    if(!mesa || !mesa.items) return 0;
    return mesa.items.reduce((acc, it) => acc + it.precio * it.cantidad, 0); 
}

// Reloj Costero
function actualizarReloj() {
    const el = document.getElementById("reloj");
    if (!el) return;
    const ahora = new Date();
    el.textContent = ahora.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) +
        " · " + ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    
    if(document.getElementById("seccion-cocina").style.display === "block") renderPantallaCocina();
    actualizarBadgeCocina();
}

function actualizarBadgeCocina() {
    const badge = document.getElementById("badge-cocina-count");
    if(badge) badge.textContent = comandasCocina.length;
}

// MODAL DE ALERTAS UI PERSONALIZADA
let resolverUIModal = null;
function mostrarUIModal(titulo, mensaje, conInput = false) {
    return new Promise((resolver) => {
        resolverUIModal = resolver;
        document.getElementById("ui-modal-titulo").textContent = titulo;
        document.getElementById("ui-modal-mensaje").textContent = mensaje;
        const inputCont = document.getElementById("ui-modal-input-container");
        const inputVal = document.getElementById("ui-modal-input");
        inputVal.value = "";
        if(conInput) { inputCont.style.display = "block"; inputVal.focus(); }
        else { inputCont.style.display = "none"; }
        document.getElementById("overlay-ui").style.display = "flex";
    });
}
document.getElementById("btn-ui-aceptar").addEventListener("click", () => {
    const inputCont = document.getElementById("ui-modal-input-container");
    document.getElementById("overlay-ui").style.display = "none";
    if (resolverUIModal) {
        if (inputCont.style.display === "block") resolverUIModal(document.getElementById("ui-modal-input").value);
        else resolverUIModal(true);
    }
});
document.getElementById("btn-ui-cancelar").addEventListener("click", () => {
    document.getElementById("overlay-ui").style.display = "none";
    if (resolverUIModal) resolverUIModal(false);
});

// ENRUTADOR DE PESTAÑAS (TABS)
function cambiarSeccionPrincipal(tabId, seccionId) {
    document.querySelectorAll(".tab-nav").forEach(t => t.classList.remove("activo"));
    document.querySelectorAll(".seccion-pos").forEach(s => s.style.display = "none");
    document.getElementById("vista-mesa").style.display = "none";
    document.getElementById("vista-admin").style.display = "none";
    
    document.getElementById(tabId).classList.add("activo");
    document.getElementById(seccionId).style.display = "block";

    if(seccionId === "seccion-mesas") renderMapa();
    if(seccionId === "seccion-virtuales") renderPedidosVirtuales();
    if(seccionId === "seccion-cocina") renderPantallaCocina();
}
document.getElementById("tab-mesas").addEventListener("click", () => cambiarSeccionPrincipal("tab-mesas", "seccion-mesas"));
document.getElementById("tab-virtuales").addEventListener("click", () => cambiarSeccionPrincipal("tab-virtuales", "seccion-virtuales"));
document.getElementById("tab-cocina").addEventListener("click", () => cambiarSeccionPrincipal("tab-cocina", "seccion-cocina"));

// VISTA 1: COMEDOR
function renderMapa() {
    const grid = document.getElementById("grid-mesas");
    if(!grid) return; grid.innerHTML = "";
    estadoMesas.forEach((mesa, idx) => {
        const total = calcularSubtotalMesa(mesa);
        const card = document.createElement("button");
        card.className = "mesa-card " + (mesa.estado === "ocupada" ? "ocupada" : mesa.estado === "cuenta" ? "cuenta" : "");
        card.innerHTML = `
            <span class="mesa-numero">Mesa ${mesa.numero}</span>
            <span class="mesa-estado">${mesa.estado === "libre" ? "Libre" : mesa.estado === "ocupada" ? "Ocupada" : "Cuenta pedida"}</span>
            ${mesa.estado === "libre" ? '<span class="mesa-vacia">Toca para abrir</span>' : `<span class="mesa-total">${formatoMoneda(total)}</span>`}
        `;
        card.addEventListener("click", () => {
            esMesaVirtualActiva = false;
            abrirMesaOOrden(idx, `Mesa ${mesa.numero}`);
        });
        grid.appendChild(card);
    });
}

// VISTA 2: PARA LLEVAR / DOMICILIO
function renderPedidosVirtuales() {
    const grid = document.getElementById("grid-virtuales");
    if(!grid) return; grid.innerHTML = "";
    if(pedidosVirtuales.length === 0) {
        grid.innerHTML = "<p style='color:var(--ink-soft); grid-column:1/-1; text-align:center; padding:40px 0;'>No hay pedidos fuera de salón activos.</p>";
        return;
    }
    pedidosVirtuales.forEach((ped, idx) => {
        const total = calcularSubtotalMesa(ped);
        const card = document.createElement("button");
        card.className = "mesa-card " + (ped.estado === "ocupada" ? "ocupada" : ped.estado === "cuenta" ? "cuenta" : "");
        let icono = ped.tipo === "Domicilio" ? "🏍️" : ped.tipo === "Uber/Didi" ? "📱" : "🥡";
        card.innerHTML = `
            <span class="mesa-numero" style="font-size:20px;">${icono} ${ped.tipo}</span>
            <span class="mesa-estado" style="margin-bottom:4px; font-size:12px; text-transform:none;"><b>Ref:</b> ${ped.cliente}</span>
            <span class="mesa-estado">${ped.estado === "ocupada" ? "En Proceso" : "Cuenta Solicitada"}</span>
            <span class="mesa-total">${formatoMoneda(total)}</span>
        `;
        card.addEventListener("click", () => {
            esMesaVirtualActiva = true;
            abrirMesaOOrden(idx, `${icono} ${ped.tipo}`);
        });
        grid.appendChild(card);
    });
}

document.getElementById("btn-nuevo-pedido-v").addEventListener("click", () => {
    document.getElementById("v-cliente-nombre").value = "";
    document.getElementById("overlay-nuevo-virtual").style.display = "flex";
});
document.getElementById("btn-cancelar-v").addEventListener("click", () => document.getElementById("overlay-nuevo-virtual").style.display = "none");
document.getElementById("btn-aceptar-v").addEventListener("click", () => {
    const tipo = document.getElementById("v-tipo-servicio").value;
    const cliente = document.getElementById("v-cliente-nombre").value.trim() || "Cliente General";
    pedidosVirtuales.push({ id: "v" + Date.now(), tipo: tipo, cliente: cliente, estado: "ocupada", items: [] });
    guardarVirtuales();
    document.getElementById("overlay-nuevo-virtual").style.display = "none";
    esMesaVirtualActiva = true;
    abrirMesaOOrden(pedidosVirtuales.length - 1, tipo);
});

// DETALLE DE PEDIDOS Y PANEL DE ORDEN
function abrirMesaOOrden(idx, tituloVisual) {
    mesaActivaIndex = idx;
    document.getElementById("seccion-mesas").style.display = "none";
    document.getElementById("seccion-virtuales").style.display = "none";
    document.getElementById("seccion-cocina").style.display = "none";
    document.getElementById("titulo-mesa").textContent = tituloVisual;
    
    const badgeCli = document.getElementById("badge-cliente-info");
    const ordenObj = obtenerMesaUOrdenActual();
    if(esMesaVirtualActiva && ordenObj) {
        badgeCli.style.display = "inline-block"; badgeCli.textContent = ordenObj.cliente;
    } else { badgeCli.style.display = "none"; }
    document.getElementById("vista-mesa").style.display = "block";
    busquedaFiltro = ""; document.getElementById("buscar-platillo").value = "";
    renderMesa();
}

function regresarAOrigen() { if (esMesaVirtualActiva) cambiarSeccionPrincipal("tab-virtuales", "seccion-virtuales"); else cambiarSeccionPrincipal("tab-mesas", "seccion-mesas"); }
document.getElementById("btn-volver").addEventListener("click", regresarAOrigen);

function renderCategorias() {
    const cont = document.getElementById("categorias");
    if(!cont) return; cont.innerHTML = "";
    Object.keys(MENU).forEach((cat) => {
        const btn = document.createElement("button");
        btn.className = "cat-btn " + (cat === categoriaActiva ? "activo" : "");
        btn.textContent = cat;
        btn.addEventListener("click", () => { categoriaActiva = cat; renderCategorias(); renderPlatillos(); });
        cont.appendChild(btn);
    });
}

function renderPlatillos() {
    const cont = document.getElementById("lista-platillos");
    if(!cont) return; cont.innerHTML = "";
    let lista = [];
    if (busquedaFiltro.trim() !== "") {
        Object.keys(MENU).forEach(cat => {
            MENU[cat].forEach(p => { if(p.nombre.toLowerCase().includes(busquedaFiltro.toLowerCase())) lista.push(p); });
        });
    } else { lista = MENU[categoriaActiva] || []; }
    if(lista.length === 0) { cont.innerHTML = "<p style='color:var(--ink-soft); grid-column:1/-1;'>No se encontraron productos.</p>"; return; }
    lista.forEach((p) => {
        const card = document.createElement("div"); card.className = "platillo-card";
        card.innerHTML = `<h4>${p.nombre}</h4><span class="precio">${formatoMoneda(p.precio)}</span><button>Agregar</button>`;
        card.querySelector("button").addEventListener("click", () => agregarItem(p));
        cont.appendChild(card);
    });
}

function agregarItem(platillo) {
    const orden = obtenerMesaUOrdenActual();
    const existente = orden.items.find((it) => it.id === platillo.id);
    if (existente) existente.cantidad += 1;
    else orden.items.push({ id: platillo.id, nombre: platillo.nombre, precio: platillo.precio, cantidad: 1, nota: "" });
    if (orden.estado === "libre") orden.estado = "ocupada";
    guardarMesaUOrdenActual(); renderMesa();
}

function cambiarCantidad(itemId, delta) {
    const orden = obtenerMesaUOrdenActual();
    const item = orden.items.find((it) => it.id === itemId);
    if (!item) return;
    item.cantidad += delta;
    if (item.cantidad <= 0) orden.items = orden.items.filter((it) => it.id !== itemId);
    if (orden.items.length === 0 && !esMesaVirtualActiva) orden.estado = "libre";
    guardarMesaUOrdenActual(); renderMesa();
}

function guardarNotaItem(itemId, textoNota) {
    const orden = obtenerMesaUOrdenActual();
    const item = orden.items.find((it) => it.id === itemId);
    if (item) { item.nota = textoNota.trim(); guardarMesaUOrdenActual(); }
}

function renderOrden() {
    const orden = obtenerMesaUOrdenActual();
    const cont = document.getElementById("orden-lista");
    if(!cont) return; cont.innerHTML = "";
    if (!orden || orden.items.length === 0) { cont.innerHTML = '<p class="orden-vacia">Aún no hay productos.</p>'; }
    else {
        orden.items.forEach((it) => {
            const fila = document.createElement("div"); fila.className = "orden-item";
            fila.innerHTML = `
                <div style="flex:1;">
                    <div class="nombre">${it.nombre}</div>
                    <div class="subtotal">${formatoMoneda(it.precio * it.cantidad)}</div>
                    <div class="nota-cocina-box"><input type="text" class="input-nota" placeholder="✍️ Nota de cocina..." value="${it.nota || ''}"></div>
                </div>
                <div class="qty-control">
                    <button class="btn-menos">−</button><span>${it.cantidad}</span><button class="btn-mas">+</button>
                </div>
            `;
            fila.querySelector(".btn-menos").addEventListener("click", () => cambiarCantidad(it.id, -1));
            fila.querySelector(".btn-mas").addEventListener("click", () => cambiarCantidad(it.id, 1));
            fila.querySelector(".input-nota").addEventListener("change", (e) => guardarNotaItem(it.id, e.target.value));
            cont.appendChild(fila);
        });
    }
    document.getElementById("orden-total-valor").textContent = formatoMoneda(calcularSubtotalMesa(orden));
}
function renderMesa() { renderCategorias(); renderPlatillos(); renderOrden(); }

async function cancelarMesa() {
    const orden = obtenerMesaUOrdenActual();
    if (orden.items.length > 0) {
        if (!await mostrarUIModal("¿Cancelar Todo?", "¿Deseas limpiar por completo este pedido?")) return;
    }
    if (esMesaVirtualActiva) { pedidosVirtuales = pedidosVirtuales.filter((_, idx) => idx !== mesaActivaIndex); guardarVirtuales(); }
    else { orden.items = []; orden.estado = "libre"; guardarMesas(); }
    regresarAOrigen();
}

// PANTALLA DE COCINA
document.getElementById("btn-enviar-cocina").addEventListener("click", async () => {
    const orden = obtenerMesaUOrdenActual();
    if(!orden || orden.items.length === 0) return mostrarUIModal("Aviso", "No hay platillos que mandar a cocina.");
    let origenNombre = esMesaVirtualActiva ? `${orden.tipo} (${orden.cliente.substring(0,8)})` : `Mesa ${orden.numero}`;
    comandasCocina.push({
        id: Date.now().toString(), origen: origenNombre, horaEntrada: new Date().toISOString(),
        items: orden.items.map(it => ({ nombre: it.nombre, cantidad: it.cantidad, nota: it.nota }))
    });
    guardarComandas(); actualizarBadgeCocina(); mostrarUIModal("Éxito", "Comanda enviada a la cocina.");
});

function renderPantallaCocina() {
    const grid = document.getElementById("grid-comandas-cocina");
    if(!grid) return; grid.innerHTML = "";
    if(comandasCocina.length === 0) { grid.innerHTML = "<p style='color:var(--ink-soft); grid-column:1/-1; text-align:center; padding:40px 0;'>🔥 Cocina limpia.</p>"; return; }
    comandasCocina.forEach((com, idx) => {
        const minutos = Math.floor((new Date() - new Date(com.horaEntrada)) / 60000);
        const card = document.createElement("div"); card.className = "comanda-card " + (minutos >= 15 ? "critica" : "lista");
        let listaItemsHtml = com.items.map(it => `<div class="comanda-item-row"><span class="comanda-item-nombre">${it.cantidad}x ${it.nombre}</span>${it.nota ? `<div class="comanda-item-nota">⚠️ ${it.nota}</div>` : ""}</div>`).join("");
        card.innerHTML = `<div class="comanda-header"><span class="comanda-origen">${com.origen}</span><span class="comanda-tiempo">${minutos} min</span></div><div class="comanda-cuerpo">${listaItemsHtml}</div><div class="comanda-footer"><button class="btn btn-gold btn-completar-chef"><i class="fa-solid fa-check"></i> Despachar</button></div>`;
        card.querySelector(".btn-completar-chef").addEventListener("click", () => { comandasCocina = comandasCocina.filter((_, i) => i !== idx); guardarComandas(); renderPantallaCocina(); actualizarBadgeCocina(); });
        grid.appendChild(card);
    });
}

// DIVISIÓN DE CUENTAS (CUENTAS SEPARADAS)
document.getElementById("btn-abrir-division").addEventListener("click", () => {
    const orden = obtenerMesaUOrdenActual();
    if(!orden || orden.items.length === 0) return mostrarUIModal("Aviso", "No hay consumos que separar.");
    cuentaSeparadaActiva = []; renderModalDivision(); document.getElementById("overlay-dividir").style.display = "flex";
});
document.getElementById("cerrar-dividir").addEventListener("click", () => {
    const orden = obtenerMesaUOrdenActual();
    cuentaSeparadaActiva.forEach(itemSep => {
        const original = orden.items.find(i => i.id === itemSep.id);
        if(original) original.cantidad += itemSep.cantidad; else orden.items.push(itemSep);
    });
    cuentaSeparadaActiva = []; guardarMesaUOrdenActual(); document.getElementById("overlay-dividir").style.display = "none"; renderMesa();
});
function renderModalDivision() {
    const orden = obtenerMesaUOrdenActual();
    const contMesa = document.getElementById("division-lista-mesa");
    const contCliente = document.getElementById("division-lista-cliente");
    contMesa.innerHTML = ""; contCliente.innerHTML = ""; let totalSeparado = 0;
    orden.items.forEach(it => {
        if(it.strong > 0 || it.cantidad > 0) {
            const row = document.createElement("div"); row.className = "item-division-row";
            row.innerHTML = `<span>${it.cantidad}x ${it.nombre}</span> <button>Separar 1</button>`;
            row.querySelector("button").addEventListener("click", () => {
                it.cantidad -= 1; const enSep = cuentaSeparadaActiva.find(i => i.id === it.id);
                if(enSep) enSep.cantidad += 1; else cuentaSeparadaActiva.push({ ...it, cantidad: 1 });
                orden.items = orden.items.filter(i => i.cantidad > 0); renderModalDivision();
            });
            contMesa.appendChild(row);
        }
    });
    cuentaSeparadaActiva.forEach((it, idx) => {
        totalSeparado += (it.precio * it.cantidad);
        const row = document.createElement("div"); row.className = "item-division-row";
        row.innerHTML = `<span>${it.cantidad}x ${it.nombre}</span> <button>Devolver</button>`;
        row.querySelector("button").addEventListener("click", () => {
            it.cantidad -= 1; const original = orden.items.find(i => i.id === it.id);
            if(original) original.cantidad += 1; else orden.items.push({ ...it, cantidad: 1 });
            if(it.cantidad <= 0) cuentaSeparadaActiva = cuentaSeparadaActiva.filter((_, i) => i !== idx);
            renderModalDivision();
        });
        contCliente.appendChild(row);
    });
    document.getElementById("total-separado-valor").textContent = formatoMoneda(totalSeparado);
}

// SISTEMA CENTRAL DE COBRO (MODAL TICKET VENTA)
function abrirTicket() { abrirTicketPreconfigurado(false); }
function abrirTicketPreconfigurado(esParcial) {
    esCobroParcialDeDivision = esParcial; const orden = obtenerMesaUOrdenActual();
    const productosACobrar = esParcial ? cuentaSeparadaActiva : orden.items;
    if (productosACobrar.length === 0) return;
    if(!esParcial) { orden.estado = "cuenta"; guardarMesaUOrdenActual(); renderMapa(); renderPedidosVirtuales(); }
    let tituloCabecera = esMesaVirtualActiva ? `${orden.tipo}` : `Mesa ${orden.numero}`;
    if(esParcial) tituloCabecera += " (Pago Parcial)";
    document.getElementById("ticket-mesa-info").textContent = `${tituloCabecera} · ${new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}`;
    const lineas = document.getElementById("ticket-lineas"); lineas.innerHTML = "";
    productosACobrar.forEach((it) => {
        const l = document.createElement("div"); l.className = "ticket-linea-producto";
        l.innerHTML = `<div class="ticket-linea-main"><span>${it.cantidad}x ${it.nombre}</span> <span>${formatoMoneda(it.precio * it.cantidad)}</span></div>`;
        lineas.appendChild(l);
    });
    porcentajePropina = 10; actualizarBotonesPropina();
    document.getElementById("pago-recibido").value = ""; document.getElementById("bloque-cambio").style.display = "none";
    document.getElementById("metodo-pago").value = "Efectivo"; document.getElementById("bloque-efectivo").style.display = "block";
    calcularPreciosFinalesTicket(); document.getElementById("overlay-ticket").style.display = "flex";
}
function calcularPreciosFinalesTicket() {
    const orden = obtenerMesaUOrdenActual();
    const subtotal = esCobroParcialDeDivision ? cuentaSeparadaActiva.reduce((acc, it) => acc + it.precio * it.cantidad, 0) : calcularSubtotalMesa(orden);
    const propina = subtotal * (porcentajePropina / 100); const totalConPropina = subtotal + propina;
    document.getElementById("ticket-subtotal-valor").textContent = formatoMoneda(subtotal);
    const txtPropina = document.getElementById("ticket-propina-dinero");
    if(txtPropina) txtPropina.textContent = `${formatoMoneda(propina)} (${porcentajePropina}%)`;
    document.getElementById("ticket-total-valor").textContent = formatoMoneda(totalConPropina);
    const pagoRecibidoInput = document.getElementById("pago-recibido").value;
    const bloqueCambio = document.getElementById("bloque-cambio");
    if (pagoRecibidoInput && document.getElementById("metodo-pago").value === "Efectivo") {
        const pago = parseFloat(pagoRecibidoInput);
        if (pago >= totalConPropina) { bloqueCambio.style.display = "flex"; document.getElementById("ticket-cambio-valor").textContent = formatoMoneda(pago - totalConPropina); return; }
    }
    bloqueCambio.style.display = "none";
}
function confirmarCobro() {
    const orden = obtenerMesaUOrdenActual(); const productosACobrar = esCobroParcialDeDivision ? cuentaSeparadaActiva : orden.items;
    const subtotal = productosACobrar.reduce((acc, it) => acc + it.precio * it.cantidad, 0);
    const propina = subtotal * (porcentajePropina / 100); const metodo = document.getElementById("metodo-pago").value;
    if (metodo === "Efectivo") {
        const pago = parseFloat(document.getElementById("pago-recibido").value || 0);
        if (pago < (subtotal + propina)) { mostrarUIModal("Error", "Efectivo recibido insuficiente."); return; }
    }
    historialVentas.push({ fecha: new Date().toISOString(), mesa: orden ? (esMesaVirtualActiva ? orden.tipo : orden.numero) : "Varios", subtotal: subtotal, propina: propina, metodo: metodo, items: [...productosACobrar] });
    guardarVentas();
    if(esCobroParcialDeDivision) {
        cuentaSeparadaActiva = []; if(orden.items.length === 0 && !esMesaVirtualActiva) orden.estado = "libre"; else if (orden.items.length > 0) orden.estado = "ocupada"; 
    } else { if(esMesaVirtualActiva) pedidosVirtuales = pedidosVirtuales.filter((_, idx) => idx !== mesaActivaIndex); else { orden.items = []; orden.estado = "libre"; } }
    guardarMesas(); guardarVirtuales(); document.getElementById("overlay-ticket").style.display = "none"; regresarAOrigen();
}
function actualizarBotonesPropina() {
    document.querySelectorAll(".btn-propina").forEach(btn => {
        const pct = parseInt(btn.getAttribute("data-pct"));
        if(pct === porcentajePropina) { btn.style.background = "var(--navy)"; btn.style.color = "var(--white)"; }
        else { btn.style.background = "var(--sand-dark)"; btn.style.color = "var(--navy)"; }
    });
}
document.getElementById("btn-cobrar-separado").addEventListener("click", () => {
    if(cuentaSeparadaActiva.length === 0) return mostrarUIModal("Error", "Debes transferir mínimo un producto.");
    document.getElementById("overlay-dividir").style.display = "none"; abrirTicketPreconfigurado(true);
});

// ADMINISTRACIÓN, REPORTES Y NUEVO PANEL DE GASTOS EXTRAS
async function abrirAdminConPassword() {
    const pw = await mostrarUIModal("Seguridad", "Ingresa la contraseña de Administrador:", true);
    if (pw === ADMIN_PASSWORD) {
        document.getElementById("seccion-mesas").style.display = "none"; document.getElementById("seccion-virtuales").style.display = "none";
        document.getElementById("seccion-cocina").style.display = "none"; document.getElementById("vista-mesa").style.display = "none";
        document.getElementById("vista-admin").style.display = "block"; renderAdmin();
    } else if (pw !== false) { mostrarUIModal("Error", "Contraseña incorrecta."); }
}
function cerrarAdmin() { document.getElementById("vista-admin").style.display = "none"; cambiarSeccionPrincipal("tab-mesas", "seccion-mesas"); }

function renderAdmin() {
    document.getElementById("admin-total-mesas").textContent = estadoMesas.length;
    const selectCat = document.getElementById("admin-platillo-cat"); selectCat.innerHTML = "";
    Object.keys(MENU).forEach(cat => { const opt = document.createElement("option"); opt.value = cat; opt.textContent = cat; selectCat.appendChild(opt); });

    const contBtns = document.getElementById("admin-lista-categorias-btns"); contBtns.innerHTML = "";
    Object.keys(MENU).forEach(cat => {
        const btn = document.createElement("button"); btn.className = "cat-btn " + (cat === adminCategoriaActiva ? "activo" : "");
        btn.style.padding = "6px 14px"; btn.style.fontSize = "12px"; btn.textContent = cat;
        btn.addEventListener("click", () => { adminCategoriaActiva = cat; renderAdmin(); }); contBtns.appendChild(btn);
    });

    const cuerpoTabla = document.getElementById("cuerpo-tabla-admin"); cuerpoTabla.innerHTML = "";
    if(MENU[adminCategoriaActiva]) {
        MENU[adminCategoriaActiva].forEach((p) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td><strong>${p.nombre}</strong></td><td>${formatoMoneda(p.precio)}</td><td><button class="btn btn-sm btn-editar"><i class="fa-solid fa-pen"></i> Editar</button><button class="btn btn-coral btn-sm btn-eliminar"><i class="fa-solid fa-trash"></i></button></td>`;
            tr.querySelector(".btn-editar").addEventListener("click", () => cargarPlatilloEnFormulario(p, adminCategoriaActiva));
            tr.querySelector(".btn-eliminar").addEventListener("click", () => ejecutarEliminarPlatillo(adminCategoriaActiva, p.id));
            cuerpoTabla.appendChild(tr);
        });
    }
    renderGastosEnAdmin();
    calcularReporteVentas();
}

// NUEVO: Renderizar Lista de Gastos en el Admin
function renderGastosEnAdmin() {
    const listaCont = document.getElementById("admin-lista-gastos");
    if(!listaCont) return; listaCont.innerHTML = "";
    if(listaGastos.length === 0) { listaCont.innerHTML = "<span style='color:var(--ink-soft); font-style:italic;'>No hay gastos registrados hoy.</span>"; return; }
    listaGastos.forEach((g, idx) => {
        const div = document.createElement("div");
        div.style = "display:flex; justify-content:space-between; background:var(--sand); padding:4px 8px; border-radius:4px; align-items:center;";
        div.innerHTML = `<span>📌 ${g.concepto}</span> <span><b>-${formatoMoneda(g.monto)}</b> <i class="fa-solid fa-circle-xmark" style="color:var(--coral); cursor:pointer; margin-left:6px;" data-idx="${idx}"></i></span>`;
        div.querySelector("i").addEventListener("click", () => {
            listaGastos.splice(idx, 1); guardarGastos(); renderAdmin();
        });
        listaCont.appendChild(div);
    });
}

// NUEVO: Captura de Formulario de Gastos
document.getElementById("form-nuevo-gasto").addEventListener("submit", (e) => {
    e.preventDefault();
    const concepto = document.getElementById("gasto-concepto").value.trim();
    const monto = parseFloat(document.getElementById("gasto-monto").value);
    listaGastos.push({ concepto: concepto, monto: monto, fecha: new Date().toISOString() });
    guardarGastos(); document.getElementById("form-nuevo-gasto").reset(); renderAdmin();
});

function calcularReporteVentas() {
    let efec = 0, tarj = 0, trans = 0, propinas = 0;
    historialVentas.forEach(v => {
        propinas += v.propina;
        if(v.metodo === "Efectivo") efec += v.subtotal;
        if(v.metodo === "Tarjeta") tarj += v.subtotal;
        if(v.metodo === "Transferencia") trans += v.subtotal;
    });
    const totalGastos = listaGastos.reduce((acc, g) => acc + g.monto, 0);
    const balanceNetoFinal = (efec + tarj + trans) - totalGastos; // CORRECCIÓN: Descuento directo aplicado

    document.getElementById("rep-efectivo").textContent = formatoMoneda(efec);
    document.getElementById("rep-tarjeta").textContent = formatoMoneda(tarj);
    document.getElementById("rep-transferencia").textContent = formatoMoneda(trans);
    document.getElementById("rep-total-gastos").textContent = `-${formatoMoneda(totalGastos)}`;
    document.getElementById("rep-total-ventas").textContent = formatoMoneda(balanceNetoFinal);
    document.getElementById("rep-total-propinas").textContent = formatoMoneda(propinas);
}

// NUEVO: Generador e Impresor de Ticket de Corte de Caja
function imprimirCorteCaja() {
    let efec = 0, tarj = 0, trans = 0, propinas = 0;
    historialVentas.forEach(v => {
        propinas += v.propina;
        if(v.metodo === "Efectivo") efec += v.subtotal;
        if(v.metodo === "Tarjeta") tarj += v.subtotal;
        if(v.metodo === "Transferencia") trans += v.subtotal;
    });
    const totalBruto = efec + tarj + trans;
    const totalGastos = listaGastos.reduce((acc, g) => acc + g.monto, 0);
    const balanceNetoFinal = totalBruto - totalGastos;

    const contCorte = document.getElementById("ticket-corte-imprimible");
    contCorte.innerHTML = `
        <div class="ticket-header">
            <h3>MARISCOS MATTY</h3>
            <p><b>*** CORTE DE CAJA / CIERRE DIARIO ***</b></p>
            <p>Generado: ${new Date().toLocaleString("es-MX")}</p>
        </div>
        <div class="ticket-calculos" style="background:transparent; padding:0;">
            <div class="ticket-subtotal-linea"><span>💵 Ventas Efectivo:</span> <span>${formatoMoneda(efec)}</span></div>
            <div class="ticket-subtotal-linea"><span>💳 Ventas Tarjeta:</span> <span>${formatoMoneda(tarj)}</span></div>
            <hr style="border:1px dashed #000; margin:6px 0;">
            <div class="ticket-subtotal-linea" style="font-size:14px; color:#000;"><span>💰 Total Ventas Brutas:</span> <span>${formatoMoneda(totalBruto)}</span></div>
            <div class="ticket-subtotal-linea" style="color:var(--teal);"><span>❤️ Total Propinas Recibidas:</span> <span>${formatoMoneda(propinas)}</span></div>
        </div>
        <hr style="border:1px dashed #000; margin:10px 0;">
        <div class="ticket-header" style="text-align:left; border:none; margin:0; padding:0;">
            <p><b>DESGLOSE DE GASTOS EXTRAS DEUDORES:</b></p>
        </div>
        <div style="font-size:12px; margin-top:6px; display:flex; flex-direction:column; gap:4px;">
            ${listaGastos.map(g => `<div style="display:flex; justify-content:between;"><span>• ${g.concepto}</span><span>-${formatoMoneda(g.monto)}</span></div>`).join("")}
            ${listaGastos.length === 0 ? "<div><i>No se registraron gastos de caja hoy.</i></div>" : ""}
        </div>
        <hr style="border:1px dashed #000; margin:10px 0;">
        <div class="ticket-calculos" style="background:#f1f1f1; padding:10px; border-radius:4px;">
            <div class="ticket-subtotal-linea"><span>Subtotal Ingresos:</span> <span>${formatoMoneda(totalBruto)}</span></div>
            <div class="ticket-subtotal-linea" style="color:var(--coral);"><span>(-) Egresos Gastos:</span> <span>-${formatoMoneda(totalGastos)}</span></div>
            <div class="ticket-total" style="border-top-color:#000; padding-top:6px; margin-top:6px;">
                <span>GANANCIA NETO CAJA</span>
                <span>${formatoMoneda(balanceNetoFinal)}</span>
            </div>
        </div>
        <div class="ticket-header" style="border:none; margin-top:30px;">
            <p style="border-top:1px solid #000; display:inline-block; padding-top:4px; width:150px;">Firma Supervisor</p>
        </div>
    `;
    window.print();
}

function cargarPlatilloEnFormulario(platillo, categoria) {
    document.getElementById("form-admin-titulo").textContent = "Modificar Platillo";
    document.getElementById("admin-platillo-id").value = platillo.id;
    document.getElementById("admin-platillo-cat").value = categoria;
    document.getElementById("admin-platillo-nombre").value = platillo.nombre;
    document.getElementById("admin-platillo-precio").value = platillo.precio;
    document.getElementById("btn-cancelar-edicion").style.display = "inline-flex";
}
function limpiarFormularioAdmin() {
    document.getElementById("form-nuevo-platillo").reset(); document.getElementById("admin-platillo-id").value = "";
    document.getElementById("form-admin-titulo").textContent = "Añadir Platillo"; document.getElementById("btn-cancelar-edicion").style.display = "none";
}
async function ejecutarEliminarPlatillo(categoria, id) {
    const platillo = MENU[categoria].find(p => p.id === id); if (!platillo) return;
    if(await mostrarUIModal("Eliminar?", `¿Eliminar "${platillo.nombre}"?`)) { MENU[categoria] = MENU[categoria].filter(p => p.id !== id); guardarMenu(); renderAdmin(); }
}

document.getElementById("btn-agregar-mesa").addEventListener("click", () => { estadoMesas.push({ numero: estadoMesas.length + 1, estado: "libre", items: [] }); guardarMesas(); renderAdmin(); });
document.getElementById("btn-eliminar-mesa").addEventListener("click", async () => {
    if(estadoMesas.length === 0) return; const ultima = estadoMesas[estadoMesas.length - 1];
    if(ultima.estado !== "libre") return mostrarUIModal("Error", "La mesa está ocupada.");
    if(await mostrarUIModal("Remover?", `¿Remover Mesa ${ultima.numero}?`)) { estadoMesas.pop(); guardarMesas(); renderAdmin(); }
});

document.getElementById("form-nuevo-platillo").addEventListener("submit", (e) => {
    e.preventDefault(); const idExistente = document.getElementById("admin-platillo-id").value;
    const cat = document.getElementById("admin-platillo-cat").value; const nombre = document.getElementById("admin-platillo-nombre").value.trim();
    const precio = parseFloat(document.getElementById("admin-platillo-precio").value);
    if (idExistente) { Object.keys(MENU).forEach(c => { MENU[c] = MENU[c].filter(p => p.id !== idExistente); }); MENU[cat].push({ id: idExistente, nombre: nombre, precio: precio }); }
    else { MENU[cat].push({ id: Date.now().toString(), nombre: nombre, precio: precio }); }
    guardarMenu(); limpiarFormularioAdmin(); adminCategoriaActiva = cat; renderAdmin();
});
document.getElementById("btn-cancelar-edicion").addEventListener("click", limpiarFormularioAdmin);
document.getElementById("btn-borrar-ventas").addEventListener("click", async () => {
    if(await mostrarUIModal("Reset?", "¡Cuidado! ¿Borrar de forma permanente todas las ventas e historial de gastos registrados hoy?")) {
        historialVentas = []; listaGastos = []; guardarVentas(); guardarGastos(); renderAdmin();
    }
});

// LISTENERS
document.getElementById("btn-cancelar-mesa").addEventListener("click", cancelarMesa);
document.getElementById("btn-cobrar").addEventListener("click", abrirTicket);
document.getElementById("cerrar-ticket").addEventListener("click", () => document.getElementById("overlay-ticket").style.display = "none");
document.getElementById("btn-confirmar-cobro").addEventListener("click", confirmarCobro);
document.getElementById("btn-imprimir").addEventListener("click", () => window.print());
document.getElementById("btn-admin-panel").addEventListener("click", abrirAdminConPassword);
document.getElementById("btn-volver-admin").addEventListener("click", cerrarAdmin);
document.getElementById("btn-imprimir-corte").addEventListener("click", imprimirCorteCaja); // NUEVO

document.getElementById("buscar-platillo").addEventListener("input", (e) => { busquedaFiltro = e.target.value; renderPlatillos(); });
document.querySelectorAll(".btn-propina").forEach(btn => {
    btn.addEventListener("click", (e) => { porcentajePropina = parseInt(e.target.getAttribute("data-pct")); actualizarBotonesPropina(); calcularPreciosFinalesTicket(); });
});
document.getElementById("metodo-pago").addEventListener("change", (e) => {
    document.getElementById("bloque-efectivo").style.display = (e.target.value === "Efectivo") ? "block" : "none";
    document.getElementById("pago-recibido").value = ""; calcularPreciosFinalesTicket();
});
document.querySelectorAll(".btn-tecla").forEach(t => {
    t.addEventListener("click", (e) => {
        let targ = e.target; if(targ.tagName === "I") targ = targ.parentElement;
        const key = targ.getAttribute("data-val"); const inp = document.getElementById("pago-recibido");
        if(key === "C") inp.value = ""; else if (key === "del") inp.value = inp.value.slice(0,-1); else if (inp.value.length < 6) inp.value += key;
        calcularPreciosFinalesTicket();
    });
});

// Inicialización de arranque
(function iniciar() { cargarTodo(); renderMapa(); actualizarReloj(); setInterval(actualizarReloj, 30000); })();
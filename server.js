const express = require('express');
const path = require('path');
const app = express();

// Permitir que el servidor entienda datos en formato JSON
app.use(express.json());
// Servir los archivos estáticos (HTML, CSS, JS) desde la carpeta actual
app.use(express.static(__dirname));

// --- BASE DE DATOS EN MEMORIA DEL SERVIDOR ---
// Estructura inicial para cuando el servidor encienda por primera vez
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

let estadoGlobal = {
    mesas: Array.from({ length: 10 }, (_, i) => ({ numero: i + 1, estado: "libre", items: [] })),
    virtuales: [],
    comandas: [],
    ventas: [],
    gastos: [],
    menu: MENU_INICIAL
};

// --- RUTAS DE LA API (ENDPOINTS) PARA SINCRONIZACIÓN ---

// Obtener todo el estado actual del restaurante (Caja, mesas, cocina)
app.get('/api/estado', (req, res) => {
    res.json(estadoGlobal);
});

// Actualizar el estado desde cualquier dispositivo
app.post('/api/estado', (req, res) => {
    const { mesas, virtuales, comandas, ventas, gastos, menu } = req.body;
    
    if (mesas) estadoGlobal.mesas = mesas;
    if (virtuales) estadoGlobal.virtuales = virtuales;
    if (comandas) estadoGlobal.comandas = comandas;
    if (ventas) estadoGlobal.ventas = ventas;
    if (gastos) estadoGlobal.gastos = gastos;
    if (menu) estadoGlobal.menu = menu;

    res.json({ okey: true, mensaje: "Servidor sincronizado" });
});

// Enrutar cualquier otra petición al index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Usar el puerto que Railway asigna automáticamente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`POS Mariscos Matty en la nube corriendo en puerto ${PORT}`);
});
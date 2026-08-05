const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Configuración de conexión a Aiven
const db = mysql.createConnection({
    host: 'mysql-3b6d18b2-atoblanked2026.g.aivencloud.com',
    port: 28686,
    user: 'avnadmin',
    password: 'AVNS_AXY807GPv_BP8_8m1V3',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        return;
    }
    console.log('¡Conectado exitosamente a la base de datos MySQL!');
});

// Ruta raíz
app.get('/', (req, res) => res.send('API Backend La Escondida corriendo correctamente'));

// 1. CATEGORÍAS
app.get('/api/categorias', (req, res) => {
    db.query('SELECT * FROM categorias', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 2. PRODUCTOS
app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos WHERE disponible = 1', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. INSUMOS (Inventario)
app.get('/api/insumos', (req, res) => {
    db.query('SELECT * FROM insumos', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 4. RECETAS
app.get('/api/recetas', (req, res) => {
    db.query('SELECT * FROM recetas', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 5. ÓRDENES (Consultar órdenes activas)
app.get('/api/ordenes', (req, res) => {
    db.query('SELECT * FROM ordenes ORDER BY fecha_creacion DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// CREAR ÓRDEN CON DETALLES
app.post('/api/ordenes', (req, res) => {
    const { numero_mesa, total, detalles } = req.body;
    const sqlOrden = 'INSERT INTO ordenes (numero_mesa, total, estado) VALUES (?, ?, "Pendiente")';
    
    db.query(sqlOrden, [numero_mesa, total], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const id_orden = result.insertId;
        const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario) VALUES ?';
        const valoresDetalles = detalles.map(item => [id_orden, item.id_producto, item.cantidad, item.precio]);

        db.query(sqlDetalles, [valoresDetalles], (errDet) => {
            if (errDet) return res.status(500).json({ error: errDet.message });
            res.json({ mensaje: 'Orden creada con éxito', id_orden });
        });
    });
});

// ACTUALIZAR ESTADO DE ÓRDEN (Ej: Cambiar a 'Pagada' y activar trigger)
app.put('/api/ordenes/:id', (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    db.query('UPDATE ordenes SET estado = ? WHERE id_orden = ?', [estado, id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: `Orden ${id} actualizada a ${estado}` });
    });
});

// 6. DETALLES DE UNA ÓRDEN ESPECÍFICA
app.get('/api/ordenes/:id/detalles', (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM detalles_orden WHERE id_orden = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));

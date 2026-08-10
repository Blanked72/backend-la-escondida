const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Conexión a Aiven.io mediante variables de entorno o credenciales directas
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'mysql-3b6d18b2-atoblanked2026.g.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD, // Configura DB_PASSWORD en el panel de Render
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 28686,
    ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
    if (err) {
        console.error('Error de conexión a la Base de Datos en Aiven:', err);
    } else {
        console.log('Conectado exitosamente a la Base de Datos MySQL');
    }
});

// ==========================================
// 1. PRODUCTOS
// ==========================================
app.get('/productos', (req, res) => {
    db.query("SELECT * FROM productos", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/productos', (req, res) => {
    const { nombre, precio } = req.body;
    db.query("INSERT INTO productos (nombre, precio) VALUES (?, ?)", [nombre, precio], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto agregado', id_producto: result.insertId });
    });
});

app.delete('/productos/:id', (req, res) => {
    db.query("DELETE FROM productos WHERE id_producto = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto eliminado' });
    });
});

// ==========================================
// 2. INSUMOS E INVENTARIO
// ==========================================
app.get('/insumos', (req, res) => {
    db.query("SELECT * FROM insumos", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/alertas/inventario', (req, res) => {
    db.query("SELECT * FROM insumos WHERE cantidad_actual <= stock_minimo", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==========================================
// 3. ÓRDENEN
// ==========================================
app.get('/ordenes', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, o.total, o.estado, o.fecha,
               d.id_detalle, d.id_producto, d.cantidad, d.precio_unitario, d.notas,
               p.nombre as producto
        FROM ordenes o
        LEFT JOIN detalles_orden d ON o.id_orden = d.id_orden
        LEFT JOIN productos p ON d.id_producto = p.id_producto
        ORDER BY o.fecha DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const ordenesMap = {};
        results.forEach(row => {
            if (!ordenesMap[row.id_orden]) {
                ordenesMap[row.id_orden] = {
                    id_orden: row.id_orden,
                    numero_mesa: row.numero_mesa,
                    total: row.total,
                    estado: row.estado,
                    fecha: row.fecha,
                    detalles: []
                };
            }
            if (row.id_detalle) {
                ordenesMap[row.id_orden].detalles.push({
                    id_detalle: row.id_detalle,
                    id_producto: row.id_producto,
                    producto: row.producto,
                    cantidad: row.cantidad,
                    precio_unitario: row.precio_unitario,
                    notas: row.notas
                });
            }
        });
        res.json(Object.values(ordenesMap));
    });
});

app.post('/ordenes', (req, res) => {
    const { numero_mesa, total, detalles } = req.body;
    
    if (!detalles || detalles.length === 0) {
        return res.status(400).json({ error: 'La orden está vacía' });
    }

    const sqlOrden = "INSERT INTO ordenes (numero_mesa, total, estado, fecha) VALUES (?, ?, 'Pendiente', NOW())";
    db.query(sqlOrden, [numero_mesa || 'Mesa 1', total || 0], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const id_orden = result.insertId;
        const valores = detalles.map(item => [id_orden, item.id_producto, item.cantidad, item.precio, item.nombre]);

        const sqlDetalles = "INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario, notas) VALUES ?";
        db.query(sqlDetalles, [valores], (errDet) => {
            if (errDet) return res.status(500).json({ error: errDet.message });
            res.json({ mensaje: 'Orden enviada correctamente', id_orden });
        });
    });
});

// ==========================================
// 4. CAJA Y REPORTES
// ==========================================
app.get('/caja', (req, res) => {
    db.query("SELECT * FROM ordenes WHERE estado IN ('Pendiente', 'Entregado') ORDER BY fecha ASC", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/reportes/ventas/hoy', (req, res) => {
    const sql = "SELECT COALESCE(SUM(total), 0) as total_vendido, COUNT(*) as total_ordenes FROM ordenes WHERE estado = 'Pagado' AND DATE(fecha) = CURDATE()";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

app.get('/reportes/ventas/historial', (req, res) => {
    const sql = "SELECT DATE_FORMAT(fecha, '%Y-%m-%d') as fecha, COUNT(*) as total_ordenes, SUM(total) as total_vendido FROM ordenes WHERE estado = 'Pagado' AND DATE(fecha) < CURDATE() GROUP BY DATE(fecha) ORDER BY fecha DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
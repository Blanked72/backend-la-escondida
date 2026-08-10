const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de la Base de Datos
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'restaurante_db'
});

db.connect((err) => {
    if (err) {
        console.error('Error de conexión a MySQL:', err);
    } else {
        console.log('Conectado exitosamente a la Base de Datos MySQL');
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 1. PRODUCTOS (Coincide con tu fetch('/productos'))
// ==========================================
app.get('/productos', (req, res) => {
    const sql = "SELECT * FROM productos";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error en SELECT /productos:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.post('/productos', (req, res) => {
    const { nombre, precio } = req.body;
    const sql = "INSERT INTO productos (nombre, precio) VALUES (?, ?)";
    db.query(sql, [nombre, precio], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto agregado', id_producto: result.insertId });
    });
});

app.delete('/productos/:id', (req, res) => {
    const { id } = req.params;
    const sql = "DELETE FROM productos WHERE id_producto = ?";
    db.query(sql, [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto eliminado' });
    });
});

// ==========================================
// 2. INSUMOS E INVENTARIO
// ==========================================
app.get('/insumos', (req, res) => {
    const sql = "SELECT * FROM insumos";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/insumos', (req, res) => {
    const { nombre, cantidad_actual } = req.body;
    const sql = "INSERT INTO insumos (nombre, cantidad_actual) VALUES (?, ?)";
    db.query(sql, [nombre, cantidad_actual || 0], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Insumo agregado', id_insumo: result.insertId });
    });
});

app.put('/insumos/:id/stock', (req, res) => {
    const { id } = req.params;
    const { cantidad_agregar } = req.body;
    const sql = "UPDATE insumos SET cantidad_actual = cantidad_actual + ? WHERE id_insumo = ?";
    db.query(sql, [cantidad_agregar, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Stock actualizado' });
    });
});

app.get('/alertas/inventario', (req, res) => {
    const sql = "SELECT * FROM insumos WHERE cantidad_actual <= stock_minimo";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==========================================
// 3. RECETAS
// ==========================================
app.get('/recetas', (req, res) => {
    const sql = `
        SELECT r.id_producto, r.id_insumo, r.cantidad_requerida,
               p.nombre as nombre_producto, i.nombre as nombre_insumo
        FROM recetas r
        JOIN productos p ON r.id_producto = p.id_producto
        JOIN insumos i ON r.id_insumo = i.id_insumo
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/recetas', (req, res) => {
    const { id_producto, id_insumo, cantidad_requerida } = req.body;
    const sql = "INSERT INTO recetas (id_producto, id_insumo, cantidad_requerida) VALUES (?, ?, ?)";
    db.query(sql, [id_producto, id_insumo, cantidad_requerida], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Receta vinculada correctamente' });
    });
});

// ==========================================
// 4. ÓRDENEN Y MONITOR
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
    const mesaFinal = req.body.numero_mesa || req.body.mesa || 'Mesa 1';
    const detallesEnviados = req.body.detalles || req.body.carrito || [];
    const totalFinal = req.body.total || 0;

    if (!Array.isArray(detallesEnviados) || detallesEnviados.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío' });
    }

    const esNumeroMesa = !isNaN(mesaFinal) && !isNaN(parseFloat(mesaFinal));
    const estadoInicial = esNumeroMesa ? 'Pendiente' : 'A Domicilio';

    const sqlOrden = "INSERT INTO ordenes (numero_mesa, total, estado, fecha) VALUES (?, ?, ?, NOW())";
    db.query(sqlOrden, [mesaFinal, totalFinal, estadoInicial], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const id_orden = result.insertId;
        const valoresDetalles = detallesEnviados.map(item => {
            const prodId = parseInt(item.id_producto || item.id);
            const cant = parseInt(item.cantidad || 1);
            const precio = parseFloat(item.precio || 0);
            const notas = item.nombre || null; 
            return [id_orden, isNaN(prodId) ? null : prodId, cant, precio, notas];
        });

        const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario, notas) VALUES ?';
        db.query(sqlDetalles, [valoresDetalles], (errDetalles) => {
            if (errDetalles) return res.status(500).json({ error: errDetalles.message });
            res.json({ mensaje: '¡Orden creada con éxito!', id_orden });
        });
    });
});

// ==========================================
// 5. CAJA Y REPORTES
// ==========================================
app.get('/caja', (req, res) => {
    const sql = "SELECT * FROM ordenes WHERE estado IN ('Pendiente', 'A Domicilio', 'Entregado') ORDER BY fecha ASC";
    db.query(sql, (err, results) => {
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
    console.log(`Servidor activo en el puerto ${PORT}`);
});
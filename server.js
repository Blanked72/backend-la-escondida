const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Conexión a Base de Datos Aiven MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'mysql-3b6d18b2-atoblanked2026.g.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 28686,
    ssl: { rejectUnauthorized: false }
});

db.connect(err => {
    if (err) {
        console.error('Error al conectar a MySQL Aiven:', err.message);
    } else {
        console.log('Conexión exitosa a MySQL Aiven Cloud');
    }
});

// Ruta de diagnóstico básica
app.get('/', (req, res) => {
    res.send('API de La Escondida funcionando correctamente.');
});

// ==========================================
// 1. PRODUCTOS
// ==========================================
app.get('/api/productos', (req, res) => {
    db.query("SELECT * FROM productos", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/productos', (req, res) => {
    const { nombre, precio } = req.body;
    db.query("INSERT INTO productos (nombre, precio) VALUES (?, ?)", [nombre, precio], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id_producto: result.insertId, nombre, precio });
    });
});

app.delete('/api/productos/:id', (req, res) => {
    db.query("DELETE FROM productos WHERE id_producto = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto eliminado' });
    });
});

// ==========================================
// 2. INSUMOS (INVENTARIO)
// ==========================================
app.get('/api/insumos', (req, res) => {
    db.query("SELECT * FROM insumos", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/insumos', (req, res) => {
    const { nombre, cantidad_actual } = req.body;
    db.query("INSERT INTO insumos (nombre, cantidad_actual, stock_minimo) VALUES (?, ?, 5)", [nombre, cantidad_actual || 0], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id_insumo: result.insertId, nombre, cantidad_actual });
    });
});

app.put('/api/insumos/:id/stock', (req, res) => {
    const { cantidad_agregar } = req.body;
    db.query("UPDATE insumos SET cantidad_actual = cantidad_actual + ? WHERE id_insumo = ?", [cantidad_agregar, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Stock actualizado' });
    });
});

app.put('/api/insumos/:id/minimo', (req, res) => {
    const { stock_minimo } = req.body;
    db.query("UPDATE insumos SET stock_minimo = ? WHERE id_insumo = ?", [stock_minimo, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Límite mínimo actualizado' });
    });
});

app.get('/api/alertas/inventario', (req, res) => {
    db.query("SELECT * FROM insumos WHERE cantidad_actual <= stock_minimo", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==========================================
// 3. RECETAS
// ==========================================
app.get('/api/recetas', (req, res) => {
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

app.post('/api/recetas', (req, res) => {
    const { id_producto, id_insumo, cantidad_requerida } = req.body;
    db.query("INSERT INTO recetas (id_producto, id_insumo, cantidad_requerida) VALUES (?, ?, ?)", [id_producto, id_insumo, cantidad_requerida], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Receta vinculada' });
    });
});

app.delete('/api/recetas/:id_prod/:id_insumo', (req, res) => {
    db.query("DELETE FROM recetas WHERE id_producto = ? AND id_insumo = ?", [req.params.id_prod, req.params.id_insumo], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Receta desvinculada' });
    });
});

// ==========================================
// 4. ÓRDENES Y CAJA
// ==========================================
app.get('/api/ordenes', (req, res) => {
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

app.get('/api/caja', (req, res) => {
    db.query("SELECT * FROM ordenes WHERE estado IN ('Pendiente', 'Entregado', 'A Domicilio')", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/ordenes', (req, res) => {
    const mesaFinal = req.body.numero_mesa || req.body.mesa || 'Mesa 1';
    const detallesEnviados = req.body.detalles || req.body.carrito || [];
    const totalFinal = req.body.total || 0;

    if (!Array.isArray(detallesEnviados) || detallesEnviados.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío' });
    }

    const esNumeroMesa = !isNaN(mesaFinal) && !isNaN(parseFloat(mesaFinal));
    const estadoInicial = esNumeroMesa ? 'Pendiente' : 'A Domicilio';

    db.query("INSERT INTO ordenes (numero_mesa, total, estado) VALUES (?, ?, ?)", [mesaFinal, totalFinal, estadoInicial], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const id_orden = result.insertId;
        const valoresDetalles = detallesEnviados.map(item => [
            id_orden,
            parseInt(item.id_producto) || null,
            parseInt(item.cantidad) || 1,
            parseFloat(item.precio) || 0,
            item.nombre || null
        ]);

        db.query('INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario, notas) VALUES ?', [valoresDetalles], (errDetalles) => {
            if (errDetalles) return res.status(500).json({ error: errDetalles.message });
            res.json({ mensaje: 'Orden creada', id_orden });
        });
    });
});

app.put('/api/ordenes/:id/entregar', (req, res) => {
    db.query("UPDATE ordenes SET estado = 'Entregado' WHERE id_orden = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Orden entregada' });
    });
});

app.put('/api/ordenes/:id/pagar', (req, res) => {
    const { id } = req.params;
    db.query("UPDATE ordenes SET estado = 'Pagado' WHERE id_orden = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        const sqlInsumos = `
            SELECT r.id_insumo, SUM(r.cantidad_requerida * d.cantidad) as total_a_descontar
            FROM detalles_orden d
            JOIN recetas r ON d.id_producto = r.id_producto
            WHERE d.id_orden = ?
            GROUP BY r.id_insumo
        `;

        db.query(sqlInsumos, [id], (errInsumos, insumos) => {
            if (errInsumos) return res.status(500).json({ error: errInsumos.message });

            if (insumos.length === 0) {
                return res.json({ mensaje: 'Orden cobrada (sin recetas asociadas)' });
            }

            let procesados = 0;
            insumos.forEach(item => {
                db.query("UPDATE insumos SET cantidad_actual = cantidad_actual - ? WHERE id_insumo = ?", [item.total_a_descontar, item.id_insumo], () => {
                    procesados++;
                    if (procesados === insumos.length) {
                        res.json({ mensaje: 'Cobro completado e inventario descontado' });
                    }
                });
            });
        });
    });
});

// ==========================================
// 5. REPORTES DE VENTAS
// ==========================================
app.get('/api/reportes/ventas/hoy', (req, res) => {
    const sql = "SELECT COALESCE(SUM(total), 0) as total_vendido, COUNT(*) as total_ordenes FROM ordenes WHERE estado = 'Pagado' AND DATE(fecha) = CURDATE()";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

app.get('/api/reportes/ventas/historial', (req, res) => {
    const sql = "SELECT DATE(fecha) as fecha, COUNT(*) as total_ordenes, COALESCE(SUM(total), 0) as total_vendido FROM ordenes WHERE estado = 'Pagado' GROUP BY DATE(fecha) ORDER BY fecha DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});
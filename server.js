const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de la conexión a MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'restaurante_db'
});

db.connect((err) => {
    if (err) {
        console.error('Error al conectar a la Base de Datos:', err);
    } else {
        console.log('Conectado a la Base de Datos MySQL');
    }
});

// Ruta raíz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 1. SECCIÓN PRODUCTOS Y MENÚ
// ==========================================
app.get('/api/productos', (req, res) => {
    const sql = "SELECT * FROM productos";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/productos', (req, res) => {
    const { nombre, precio } = req.body;
    const sql = "INSERT INTO productos (nombre, precio) VALUES (?, ?)";
    db.query(sql, [nombre, precio], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto agregado', id_producto: result.insertId });
    });
});

app.delete('/api/productos/:id', (req, res) => {
    const { id } = req.params;
    const sql = "DELETE FROM productos WHERE id_producto = ?";
    db.query(sql, [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto eliminado' });
    });
});

// ==========================================
// 2. SECCIÓN INSUMOS / INVENTARIO
// ==========================================
app.get('/api/insumos', (req, res) => {
    const sql = "SELECT * FROM insumos";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/insumos', (req, res) => {
    const { nombre, cantidad_actual } = req.body;
    const sql = "INSERT INTO insumos (nombre, cantidad_actual) VALUES (?, ?)";
    db.query(sql, [nombre, cantidad_actual || 0], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Insumo agregado', id_insumo: result.insertId });
    });
});

app.put('/api/insumos/:id/stock', (req, res) => {
    const { id } = req.params;
    const { cantidad_agregar } = req.body;
    const sql = "UPDATE insumos SET cantidad_actual = cantidad_actual + ? WHERE id_insumo = ?";
    db.query(sql, [cantidad_agregar, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Stock actualizado' });
    });
});

app.put('/api/insumos/:id/minimo', (req, res) => {
    const { id } = req.params;
    const { stock_minimo } = req.body;
    const sql = "UPDATE insumos SET stock_minimo = ? WHERE id_insumo = ?";
    db.query(sql, [stock_minimo, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Mínimo actualizado' });
    });
});

app.get('/api/alertas/inventario', (req, res) => {
    const sql = "SELECT * FROM insumos WHERE cantidad_actual <= stock_minimo";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==========================================
// 3. SECCIÓN RECETAS
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
    const sql = "INSERT INTO recetas (id_producto, id_insumo, cantidad_requerida) VALUES (?, ?, ?)";
    db.query(sql, [id_producto, id_insumo, cantidad_requerida], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Receta vinculada correctamente' });
    });
});

app.delete('/api/recetas/:id_prod/:id_insumo', (req, res) => {
    const { id_prod, id_insumo } = req.params;
    const sql = "DELETE FROM recetas WHERE id_producto = ? AND id_insumo = ?";
    db.query(sql, [id_prod, id_insumo], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Receta desvinculada' });
    });
});

// ==========================================
// 4. SECCIÓN ÓRDENEN Y MONITOR DE COCINA
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

app.post('/api/ordenes', (req, res) => {
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

app.put('/api/ordenes/:id/entregar', (req, res) => {
    const { id } = req.params;
    const sql = "UPDATE ordenes SET estado = 'Entregado' WHERE id_orden = ?";
    db.query(sql, [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Orden marcada como entregada' });
    });
});

// ==========================================
// 5. CAJA Y PAGOS
// ==========================================
app.get('/api/caja', (req, res) => {
    const sql = "SELECT * FROM ordenes WHERE estado IN ('Pendiente', 'A Domicilio', 'Entregado') ORDER BY fecha ASC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.put('/api/ordenes/:id/pagar', (req, res) => {
    const { id } = req.params;

    const sqlPagar = "UPDATE ordenes SET estado = 'Pagado' WHERE id_orden = ?";
    db.query(sqlPagar, [id], (err) => {
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

            if (!insumos || insumos.length === 0) {
                return res.json({ mensaje: 'Orden pagada (sin insumos configurados en recetas)' });
            }

            let procesados = 0;
            insumos.forEach(item => {
                const sqlDescontar = "UPDATE insumos SET cantidad_actual = cantidad_actual - ? WHERE id_insumo = ?";
                db.query(sqlDescontar, [item.total_a_descontar, item.id_insumo], (errDesc) => {
                    procesados++;
                    if (procesados === insumos.length) {
                        res.json({ mensaje: 'Orden pagada y stock de inventario descontado' });
                    }
                });
            });
        });
    });
});

// ==========================================
// 6. REPORTES DE VENTAS
// ==========================================
app.get('/api/reportes/ventas/hoy', (req, res) => {
    const sql = `
        SELECT COALESCE(SUM(total), 0) as total_vendido, COUNT(*) as total_ordenes 
        FROM ordenes 
        WHERE estado = 'Pagado' AND DATE(fecha) = CURDATE()
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

app.get('/api/reportes/ventas/historial', (req, res) => {
    const sql = `
        SELECT DATE_FORMAT(fecha, '%Y-%m-%d') as fecha, COUNT(*) as total_ordenes, SUM(total) as total_vendido 
        FROM ordenes 
        WHERE estado = 'Pagado' AND DATE(fecha) < CURDATE()
        GROUP BY DATE(fecha) 
        ORDER BY fecha DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});
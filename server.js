const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a la base de datos en Aiven
const db = mysql.createPool({
    host: process.env.DB_HOST || 'mysql-3b6d18b2-atoblanked2026.g.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD || 'AVNS_AXY807GPv_BP8_8m1V3',
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 28686,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, conn) => {
    if (err) console.error('❌ Error Aiven:', err.message);
    else {
        console.log('✅ Conectado a Aiven');
        conn.release();
    }
});

// Función interna para descontar insumos del inventario automáticamente
function descontarInventarioPorOrden(detalles) {
    detalles.forEach(item => {
        const sql = `
            UPDATE insumos i
            JOIN recetas r ON i.id_insumo = r.id_insumo
            SET i.cantidad_actual = i.cantidad_actual - (r.cantidad_requerida * ?)
            WHERE r.id_producto = ?`;
        db.query(sql, [item.cantidad, item.id_producto], (err) => {
            if (err) console.error(`Error al descontar stock para producto ${item.id_producto}:`, err.message);
        });
    });
}

// ------------------------------------------
// 1. ÓRDENEN Y PEDIDOS
// ------------------------------------------

// Obtener catálogo de productos disponibles
app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos WHERE disponible = 1', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Crear nuevo pedido (Descuenta stock automáticamente)
app.post('/api/ordenes', (req, res) => {
    const { numero_mesa, detalles, total } = req.body;
    if (!numero_mesa || !detalles || detalles.length === 0) {
        return res.status(400).json({ error: 'Faltan datos requeridos en la orden.' });
    }

    const sqlOrden = 'INSERT INTO ordenes (numero_mesa, total, estado, fecha_creacion) VALUES (?, ?, "Pendiente", NOW())';
    db.query(sqlOrden, [numero_mesa, total], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const id_orden = result.insertId;
        const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario, notas) VALUES ?';
        const values = detalles.map(item => [
            id_orden, 
            item.id_producto, 
            item.cantidad, 
            item.precio_unitario, 
            item.notas || ''
        ]);

        db.query(sqlDetalles, [values], (errDet) => {
            if (errDet) return res.status(500).json({ error: errDet.message });
            
            // Ejecutar el descuento automático de insumos en la BD
            descontarInventarioPorOrden(detalles);

            res.json({ message: 'Orden creada exitosamente', id_orden });
        });
    });
});

// Obtener todas las órdenes activas del día
app.get('/api/ordenes', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, o.total, o.estado, o.fecha_creacion,
               JSON_ARRAYAGG(
                   JSON_OBJECT(
                       'producto', p.nombre, 
                       'cantidad', d.cantidad, 
                       'precio_unitario', d.precio_unitario,
                       'notas', d.notas
                   )
               ) AS detalles
        FROM ordenes o
        LEFT JOIN detalles_orden d ON o.id_orden = d.id_orden
        LEFT JOIN productos p ON d.id_producto = p.id_producto
        WHERE DATE(o.fecha_creacion) = CURDATE()
        GROUP BY o.id_orden
        ORDER BY o.id_orden DESC`;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Cambiar estado de la orden (Pendiente -> Listo -> Entregado -> Pagado)
app.put('/api/ordenes/:id/estado', (req, res) => {
    const { estado } = req.body;
    db.query('UPDATE ordenes SET estado = ? WHERE id_orden = ?', [estado, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Estado actualizado a ${estado}` });
    });
});

// ------------------------------------------
// 2. ADMINISTRACIÓN DE PRODUCTOS
// ------------------------------------------

app.post('/api/productos', (req, res) => {
    const { id_categoria, nombre, descripcion, precio, imagen_url, disponible } = req.body;
    const sql = 'INSERT INTO productos (id_categoria, nombre, descripcion, precio, imagen_url, disponible) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [id_categoria, nombre, descripcion, precio, imagen_url, disponible ?? 1], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Producto agregado', id_producto: result.insertId });
    });
});

app.delete('/api/productos/:id', (req, res) => {
    db.query('DELETE FROM productos WHERE id_producto = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Producto eliminado' });
    });
});

// ------------------------------------------
// 3. INVENTARIO E INSUMOS
// ------------------------------------------

app.get('/api/insumos', (req, res) => {
    db.query('SELECT * FROM insumos', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/insumos', (req, res) => {
    const { nombre, cantidad_actual, stock_minimo } = req.body;
    const sql = 'INSERT INTO insumos (nombre, cantidad_actual, stock_minimo) VALUES (?, ?, ?)';
    db.query(sql, [nombre, cantidad_actual, stock_minimo || 5], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Insumo agregado', id_insumo: result.insertId });
    });
});

app.delete('/api/insumos/:id', (req, res) => {
    db.query('DELETE FROM insumos WHERE id_insumo = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Insumo eliminado' });
    });
});

// ------------------------------------------
// 4. RECETAS
// ------------------------------------------

app.post('/api/recetas', (req, res) => {
    const { id_producto, id_insumo, cantidad_requerida } = req.body;
    const sql = 'INSERT INTO recetas (id_producto, id_insumo, cantidad_requerida) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE cantidad_requerida = ?';
    db.query(sql, [id_producto, id_insumo, cantidad_requerida, cantidad_requerida], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Receta guardada' });
    });
});

// ------------------------------------------
// 5. REPORTES DE VENTAS
// ------------------------------------------

app.get('/api/reportes/ventas', (req, res) => {
    const sqlTotales = "SELECT COUNT(*) AS ordenes_totales, COALESCE(SUM(total), 0) AS total_ventas FROM ordenes WHERE estado = 'Pagado' AND DATE(fecha_creacion) = CURDATE()";
    const sqlDetallado = "SELECT id_orden, numero_mesa, total, fecha_creacion FROM ordenes WHERE estado = 'Pagado' AND DATE(fecha_creacion) = CURDATE() ORDER BY fecha_creacion DESC";

    db.query(sqlTotales, (err, resumen) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query(sqlDetallado, (errDet, historial) => {
            if (errDet) return res.status(500).json({ error: errDet.message });
            res.json({ resumen: resumen[0], historial });
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`));
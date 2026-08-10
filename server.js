const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de conexión con credenciales reales de Aiven
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

// Verificación inicial de conexión
db.getConnection((err, conn) => {
    if (err) {
        console.error('❌ Error al conectar a Aiven MySQL:', err.message);
    } else {
        console.log('✅ Conexión exitosa a la Base de Datos en Aiven');
        conn.release();
    }
});

// ==========================================
// 1. PRODUCTOS Y CATEGORÍAS
// ==========================================

// Obtener todos los productos con su categoría
app.get('/api/productos', (req, res) => {
    const sql = `
        SELECT p.id_producto, p.id_categoria, p.nombre, p.descripcion, 
               p.precio, p.imagen_url, p.disponible, c.nombre AS categoria
        FROM productos p
        LEFT JOIN categorias c ON p.id_categoria = c.id_categoria`;
        
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Obtener categorías
app.get('/api/categorias', (req, res) => {
    db.query('SELECT * FROM categorias', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==========================================
// 2. GESTIÓN DE ÓRDENES Y DETALLES
// ==========================================

// Crear nueva orden (Coincidiendo exactamente con fecha_creacion y notas)
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
        
        // Mapeo incluyendo la columna 'notas' de tu tabla detalles_orden
        const values = detalles.map(item => [
            id_orden, 
            item.id_producto, 
            item.cantidad, 
            item.precio_unitario || item.precio, 
            item.notas || ''
        ]);

        db.query(sqlDetalles, [values], (errDet) => {
            if (errDet) return res.status(500).json({ error: errDet.message });
            res.json({ message: 'Orden enviada con éxito', id_orden });
        });
    });
});

// Obtener órdenes activas del día
app.get('/api/ordenes', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, o.total, o.estado, o.fecha_creacion,
               JSON_ARRAYAGG(
                   JSON_OBJECT(
                       'id_detalle', d.id_detalle,
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

// ==========================================
// 3. CAJA Y ESTADOS DE ORDEN
// ==========================================

// Obtener órdenes listas para cobro en Caja
app.get('/api/caja', (req, res) => {
    const sql = "SELECT * FROM ordenes WHERE estado = 'Entregado' AND DATE(fecha_creacion) = CURDATE() ORDER BY id_orden DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Cambiar estado a Entregado (Cocina)
app.put('/api/ordenes/:id/entregar', (req, res) => {
    db.query("UPDATE ordenes SET estado = 'Entregado' WHERE id_orden = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Orden lista para entregar' });
    });
});

// Cambiar estado a Pagado (Caja)
app.put('/api/ordenes/:id/pagar', (req, res) => {
    db.query("UPDATE ordenes SET estado = 'Pagado' WHERE id_orden = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Orden cobrada con éxito' });
    });
});

// ==========================================
// 4. INVENTARIO (INSUMOS Y RECETAS)
// ==========================================

// Obtener insumos y su stock
app.get('/api/insumos', (req, res) => {
    db.query('SELECT * FROM insumos', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Obtener receta de un producto
app.get('/api/recetas/:id_producto', (req, res) => {
    const sql = `
        SELECT r.id_producto, r.id_insumo, r.cantidad_requerida, i.nombre AS insumo, i.stock_minimo, i.cantidad_actual
        FROM recetas r
        JOIN insumos i ON r.id_insumo = i.id_insumo
        WHERE r.id_producto = ?`;

    db.query(sql, [req.params.id_producto], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==========================================
// 5. REPORTES DE VENTAS
// ==========================================

// Reporte de Ventas de hoy
app.get('/api/reportes/ventas/hoy', (req, res) => {
    const sql = "SELECT COUNT(*) AS total_ordenes, COALESCE(SUM(total), 0) AS total_vendido FROM ordenes WHERE estado = 'Pagado' AND DATE(fecha_creacion) = CURDATE()";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// Reporte Histórico de Ventas
app.get('/api/reportes/ventas/historial', (req, res) => {
    const sql = "SELECT DATE(fecha_creacion) AS fecha, COUNT(*) AS total_ordenes, SUM(total) AS total_vendido FROM ordenes WHERE estado = 'Pagado' GROUP BY DATE(fecha_creacion) ORDER BY fecha DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Inicio del servidor en puerto dinámico
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
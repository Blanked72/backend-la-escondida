const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de base de datos con Pool de reconexión
const db = mysql.createPool({
    host: process.env.DB_HOST || 'db-mysql-fra1-04987-do-user-18482436-0.c.db.ondigitalocean.com',
    user: process.env.DB_USER || 'doadmin',
    password: process.env.DB_PASSWORD || 'AVNS_AXY807GPv_BP8_8m1V3',
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 25060,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Prueba de conexión
db.getConnection((err, conn) => {
    if (err) {
        console.error('❌ Error crítico al conectar a MySQL:', err.message);
    } else {
        console.log('✅ Conexión exitosa a la Base de Datos');
        conn.release();
    }
});

// 1. Obtener catálogo de productos
app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos', (err, results) => {
        if (err) {
            console.error('Error en /api/productos:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// 2. Crear nueva orden (Estado inicial: Pendiente)
app.post('/api/ordenes', (req, res) => {
    const { numero_mesa, detalles, total } = req.body;
    const sqlOrden = 'INSERT INTO ordenes (numero_mesa, total, estado, fecha) VALUES (?, ?, "Pendiente", NOW())';

    db.query(sqlOrden, [numero_mesa, total], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const id_orden = result.insertId;
        const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario) VALUES ?';
        const values = detalles.map(item => [id_orden, item.id_producto, item.cantidad, item.precio]);

        db.query(sqlDetalles, [values], (errDet) => {
            if (errDet) return res.status(500).json({ error: errDet.message });
            res.json({ message: 'Orden enviada con éxito', id_orden });
        });
    });
});

// 3. Obtener órdenes activas
app.get('/api/ordenes', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, o.total, o.estado, o.fecha,
               JSON_ARRAYAGG(
                   JSON_OBJECT('producto', p.nombre, 'cantidad', d.cantidad, 'precio', d.precio_unitario)
               ) AS detalles
        FROM ordenes o
        LEFT JOIN detalles_orden d ON o.id_orden = d.id_orden
        LEFT JOIN productos p ON d.id_producto = p.id_producto
        WHERE DATE(o.fecha) = CURDATE()
        GROUP BY o.id_orden
        ORDER BY o.id_orden DESC`;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 4. Módulo de Caja
app.get('/api/caja', (req, res) => {
    const sql = "SELECT * FROM ordenes WHERE estado = 'Entregado' AND DATE(fecha) = CURDATE() ORDER BY id_orden DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 5. Cambiar estado a Entregado (Cocina -> Caja)
app.put('/api/ordenes/:id/entregar', (req, res) => {
    db.query("UPDATE ordenes SET estado = 'Entregado' WHERE id_orden = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Orden lista' });
    });
});

// 6. Cambiar estado a Pagado (Caja)
app.put('/api/ordenes/:id/pagar', (req, res) => {
    db.query("UPDATE ordenes SET estado = 'Pagado' WHERE id_orden = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Orden pagada' });
    });
});

// 7. Reporte de Ventas de Hoy
app.get('/api/reportes/ventas/hoy', (req, res) => {
    const sql = "SELECT COUNT(*) AS total_ordenes, COALESCE(SUM(total), 0) AS total_vendido FROM ordenes WHERE estado = 'Pagado' AND DATE(fecha) = CURDATE()";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// 8. Reporte de Ventas Histórico
app.get('/api/reportes/ventas/historial', (req, res) => {
    const sql = "SELECT DATE(fecha) AS fecha, COUNT(*) AS total_ordenes, SUM(total) AS total_vendido FROM ordenes WHERE estado = 'Pagado' GROUP BY DATE(fecha) ORDER BY fecha DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
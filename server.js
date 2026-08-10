const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createPool({
    host: process.env.DB_HOST || 'db-mysql-fra1-04987-do-user-18482436-0.c.db.ondigitalocean.com',
    user: process.env.DB_USER || 'doadmin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 25060,
    ssl: { rejectUnauthorized: false }
});

// Obtener catálogo de productos
app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Crear nueva orden (Estado inicial: Pendiente)
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
            res.json({ message: 'Orden enviada a cocina con éxito', id_orden });
        });
    });
});

// Obtener todas las órdenes activas del día
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

// CAJA: Muestra unicamente las órdenes entregadas por cocina
app.get('/api/caja', (req, res) => {
    const sql = "SELECT * FROM ordenes WHERE estado = 'Entregado' AND DATE(fecha) = CURDATE() ORDER BY id_orden DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Cambiar estado a Entregado (Cocina -> Caja)
app.put('/api/ordenes/:id/entregar', (req, res) => {
    db.query("UPDATE ordenes SET estado = 'Entregado' WHERE id_orden = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Orden marcada como lista' });
    });
});

// Cambiar estado a Pagado (Caja)
app.put('/api/ordenes/:id/pagar', (req, res) => {
    db.query("UPDATE ordenes SET estado = 'Pagado' WHERE id_orden = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Orden cobrada con éxito' });
    });
});

// Reporte de Ventas de Hoy
app.get('/api/reportes/ventas/hoy', (req, res) => {
    const sql = "SELECT COUNT(*) AS total_ordenes, COALESCE(SUM(total), 0) AS total_vendido FROM ordenes WHERE estado = 'Pagado' AND DATE(fecha) = CURDATE()";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// Reporte de Ventas Histórico Agrupado por Día
app.get('/api/reportes/ventas/historial', (req, res) => {
    const sql = "SELECT DATE(fecha) AS fecha, COUNT(*) AS total_ordenes, SUM(total) AS total_vendido FROM ordenes WHERE estado = 'Pagado' GROUP BY DATE(fecha) ORDER BY fecha DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
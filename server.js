const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Conexión a Aiven
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'mysql-3b6d18b2-atoblanked2026.g.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 28686,
    ssl: { rejectUnauthorized: false }
});

db.connect(err => {
    if (err) console.error('Error MySQL:', err.message);
    else console.log('Conectado a MySQL Aiven exitosamente');
});

// Ruta raíz para probar que Render esté vivo
app.get('/', (req, res) => {
    res.send('Backend de La Escondida activo');
});

// Rutas de API
app.get('/productos', (req, res) => {
    db.query("SELECT * FROM productos", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/insumos', (req, res) => {
    db.query("SELECT * FROM insumos", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/ordenes', (req, res) => {
    db.query("SELECT * FROM ordenes ORDER BY fecha DESC", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/caja', (req, res) => {
    db.query("SELECT * FROM ordenes WHERE estado IN ('Pendiente', 'Entregado')", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/reportes/ventas/hoy', (req, res) => {
    db.query("SELECT COALESCE(SUM(total), 0) as total_vendido, COUNT(*) as total_ordenes FROM ordenes WHERE estado = 'Pagado'", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0] || { total_vendido: 0, total_ordenes: 0 });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Configuración de conexión a la base de datos en Aiven
const db = mysql.createConnection({
    host: 'mysql-3b6d18b2-atoblanked2026.g.aivencloud.com',
    port: 28686,
    user: 'avnadmin',
    password: 'AVNS_AXY807GPv_BP8_8m1V3',
    database: 'defaultdb',
    ssl: {
        rejectUnauthorized: false
    }
});

// Conectar a MySQL
db.connect((err) => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        return;
    }
    console.log('¡Conectado exitosamente a la base de datos MySQL!');
});

// Ruta raíz de prueba
app.get('/', (req, res) => {
    res.send('API Backend La Escondida corriendo correctamente');
});

// 1. OBTENER PRODUCTOS DISPONIBLES
app.get('/api/productos', (req, res) => {
    const sql = 'SELECT * FROM productos WHERE disponible = 1';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error SQL:', err);
            return res.status(500).json({ error: 'Error al obtener los productos' });
        }
        res.json(results);
    });
});

// 2. CREAR UNA NUEVA ORDEN (COMANDA)
app.post('/api/ordenes', (req, res) => {
    const { numero_mesa, total, detalles } = req.body;

    // Insertar encabezado de la orden
    const sqlOrden = 'INSERT INTO ordenes (numero_mesa, total, estado) VALUES (?, ?, "Pendiente")';
    db.query(sqlOrden, [numero_mesa, total], (err, result) => {
        if (err) {
            console.error('Error al crear la orden:', err);
            return res.status(500).json({ error: 'Error al registrar la orden' });
        }

        const id_orden = result.insertId;

        // Formatear detalles para inserción masiva
        const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario) VALUES ?';
        const valoresDetalles = detalles.map(item => [id_orden, item.id_producto, item.cantidad, item.precio]);

        db.query(sqlDetalles, [valoresDetalles], (errDetalles) => {
            if (errDetalles) {
                console.error('Error al insertar detalles:', errDetalles);
                return res.status(500).json({ error: 'Error al registrar el detalle de la orden' });
            }

            res.json({ mensaje: 'Orden creada con éxito', id_orden });
        });
    });
});

// 3. CONSULTAR ÓRDENES ACTIVAS (Para cocina/caja)
app.get('/api/ordenes', (req, res) => {
    const sql = 'SELECT * FROM ordenes WHERE estado != "Pagada" ORDER BY fecha_creacion DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error SQL:', err);
            return res.status(500).json({ error: 'Error al obtener las órdenes' });
        }
        res.json(results);
    });
});

// 4. ACTUALIZAR ESTADO DE LA ORDEN (Ej: Cambiar a 'Pagada' y descontar inventario)
app.put('/api/ordenes/:id', (req, res) => {
    const { id } = req.params;
    const { estado } = req.body; // 'Lista', 'Pagada', etc.

    const sql = 'UPDATE ordenes SET estado = ? WHERE id_orden = ?';
    db.query(sql, [estado, id], (err, result) => {
        if (err) {
            console.error('Error al actualizar estado:', err);
            return res.status(500).json({ error: 'Error al actualizar la orden' });
        }
        res.json({ mensaje: `Orden ${id} actualizada a ${estado}` });
    });
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

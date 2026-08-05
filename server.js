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

// 1. OBTENER CATEGORÍAS
app.get('/api/categorias', (req, res) => {
    db.query('SELECT * FROM categorias', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 2. OBTENER PRODUCTOS DISPONIBLES
app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos WHERE disponible = 1', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. OBTENER INSUMOS (INVENTARIO)
app.get('/api/insumos', (req, res) => {
    db.query('SELECT * FROM insumos', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 4. OBTENER RECETAS
app.get('/api/recetas', (req, res) => {
    db.query('SELECT * FROM recetas', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 5. OBTENER ÓRDENES
app.get('/api/ordenes', (req, res) => {
    db.query('SELECT * FROM ordenes ORDER BY fecha_creacion DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 6. CREAR NUEVA ÓRDEN (COMANDA ULTRA FLEXIBLE)
app.post('/api/ordenes', (req, res) => {
    console.log("Datos recibidos en el backend:", req.body);

    // Captura cualquier variante de nombre para el número de mesa
    const mesaFinal = req.body.numero_mesa || req.body.mesa || req.body.numMesa || 1;
    
    // Captura cualquier variante de nombre para el arreglo de productos
    const detallesEnviados = req.body.detalles || req.body.productos || req.body.carrito || [];
    const totalFinal = req.body.total || 0;

    if (!Array.isArray(detallesEnviados) || detallesEnviados.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío o no se enviaron productos.' });
    }

    const sqlOrden = 'INSERT INTO ordenes (numero_mesa, total, estado) VALUES (?, ?, "Pendiente")';
    
    db.query(sqlOrden, [mesaFinal, totalFinal], (err, result) => {
        if (err) {
            console.error('Error al crear orden en MySQL:', err);
            return res.status(500).json({ error: err.message });
        }

        const id_orden = result.insertId;

        // Mapea cada producto adaptándose a cualquier propiedad enviada desde el HTML
        const valoresDetalles = detallesEnviados.map(item => [
            id_orden,
            item.id_producto || item.id || item.producto_id || 1,
            item.cantidad || item.cant || 1,
            item.precio || item.precio_unitario || item.precioUnitario || 0
        ]);

        const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario) VALUES ?';

        db.query(sqlDetalles, [valoresDetalles], (errDetalles) => {
            if (errDetalles) {
                console.error('Error al insertar detalles en MySQL:', errDetalles);
                return res.status(500).json({ error: errDetalles.message });
            }

            res.json({ mensaje: '¡Orden creada con éxito!', id_orden });
        });
    });
});

// 7. ACTUALIZAR ESTADO DE UNA ÓRDEN (Ej: Cambiar a 'Pagada' para activar el trigger)
app.put('/api/ordenes/:id', (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    
    db.query('UPDATE ordenes SET estado = ? WHERE id_orden = ?', [estado, id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: `Orden ${id} actualizada a ${estado}` });
    });
});

// 8. OBTENER DETALLES DE UNA ÓRDEN ESPECÍFICA
app.get('/api/ordenes/:id/detalles', (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM detalles_orden WHERE id_orden = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

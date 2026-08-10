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
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'restaurante_db'
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

// 1. Obtener Platillos
app.get('/api/platillos', (req, res) => {
    const sql = "SELECT p.*, c.nombre as categoria FROM platillos p LEFT JOIN categorias c ON p.id_categoria = c.id_categoria";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 2. Obtener Órdenes con detalles completos
app.get('/api/ordenes', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, o.total, o.estado, o.fecha,
               d.id_detalle, d.id_producto, d.cantidad, d.precio_unitario, d.notas,
               p.nombre as producto
        FROM ordenes o
        LEFT JOIN detalles_orden d ON o.id_orden = d.id_orden
        LEFT JOIN platillos p ON d.id_producto = p.id_producto
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

// 3. Crear Nueva Orden (Registra id_producto correcto para ligarlo con inventario)
app.post('/api/ordenes', (req, res) => {
    const mesaFinal = req.body.numero_mesa || req.body.mesa || req.body.numMesa || 'Mesa 1';
    const detallesEnviados = req.body.detalles || req.body.productos || req.body.carrito || [];
    const totalFinal = req.body.total || 0;

    if (!Array.isArray(detallesEnviados) || detallesEnviados.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío' });
    }

    const esNumeroMesa = !isNaN(mesaFinal) && !isNaN(parseFloat(mesaFinal));
    const estadoInicial = esNumeroMesa ? 'Pendiente' : 'A Domicilio';

    const sqlOrden = "INSERT INTO ordenes (numero_mesa, total, estado) VALUES (?, ?, ?)";
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

// 4. Cambiar estado a Entregado (Llamado desde Monitor de Cocina)
app.put('/api/ordenes/:id/entregar', (req, res) => {
    const { id } = req.params;
    const sql = "UPDATE ordenes SET estado = 'Entregado' WHERE id_orden = ?";
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Orden marcada como entregada' });
    });
});

// 5. Cobrar y Descontar Stock de Inventario
app.put('/api/ordenes/:id/pagar', (req, res) => {
    const { id } = req.params;

    const sqlPagar = "UPDATE ordenes SET estado = 'Pagado' WHERE id_orden = ?";
    db.query(sqlPagar, [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        const sqlInsumos = `
            SELECT r.id_insumo, SUM(r.cantidad * d.cantidad) as total_a_descontar
            FROM detalles_orden d
            JOIN recetas r ON d.id_producto = r.id_producto
            WHERE d.id_orden = ?
            GROUP BY r.id_insumo
        `;

        db.query(sqlInsumos, [id], (errInsumos, insumos) => {
            if (errInsumos) return res.status(500).json({ error: errInsumos.message });

            if (insumos.length === 0) {
                return res.json({ mensaje: 'Orden pagada (sin insumos configurados en recetas)' });
            }

            let procesados = 0;
            insumos.forEach(item => {
                const sqlDescontar = "UPDATE inventario SET stock = stock - ? WHERE id_insumo = ?";
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

app.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
});
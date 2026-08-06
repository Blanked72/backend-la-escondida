const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Pool de conexiones para que la base de datos no se desconecte
const db = mysql.createPool({
    host: 'mysql-3b6d18b2-atoblanked2026.g.aivencloud.com',
    port: 28686,
    user: 'avnadmin',
    password: 'AVNS_AXY807GPv_BP8_8m1V3',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Comprobar la conexión inicial
db.getConnection((err, connection) => {
    if (err) {
        console.error('Error conectando a la base de datos (Pool):', err);
        return;
    }
    console.log('¡Conectado exitosamente al Pool de MySQL!');
    connection.query("ALTER TABLE detalles_orden ADD COLUMN notas VARCHAR(255)", () => {});
    connection.release();
});

app.get('/', (req, res) => {
    res.send('API Backend La Escondida - Funcionando correctamente');
});

// --- RUTAS DE ORDENES Y CAJA ---

app.post('/api/ordenes', (req, res) => {
    const mesaFinal = req.body.numero_mesa || req.body.mesa || req.body.numMesa || 1;
    const detallesEnviados = req.body.detalles || req.body.productos || req.body.carrito || [];
    const totalFinal = req.body.total || 0;

    if (!Array.isArray(detallesEnviados) || detallesEnviados.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío' });
    }

    const sqlOrden = "INSERT INTO ordenes (numero_mesa, total, estado) VALUES (?, ?, 'Pendiente')";
    db.query(sqlOrden, [mesaFinal, totalFinal], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const id_orden = result.insertId;
        const valoresDetalles = detallesEnviados.map(item => {
            const prodId = parseInt(item.id_producto || item.id || item.producto_id);
            const cant = parseInt(item.cantidad || item.cant || 1);
            const precio = parseFloat(item.precio || item.precio_unitario || item.precioUnitario || 0);
            const notas = item.nombre || null; 
            return [id_orden, isNaN(prodId) ? 1 : prodId, cant, precio, notas];
        });

        const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario, notas) VALUES ?';
        db.query(sqlDetalles, [valoresDetalles], (errDetalles) => {
            if (errDetalles) return res.status(500).json({ error: errDetalles.message });
            res.json({ mensaje: '¡Orden creada con éxito!', id_orden });
        });
    });
});

app.get('/api/ordenes', (req, res) => {
    db.query('SELECT * FROM ordenes ORDER BY id_orden DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/cocina', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, IFNULL(d.notas, p.nombre) AS nombre, d.cantidad 
        FROM ordenes o
        JOIN detalles_orden d ON o.id_orden = d.id_orden
        JOIN productos p ON d.id_producto = p.id_producto
        WHERE o.estado = 'Pendiente'
        ORDER BY o.id_orden ASC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.put('/api/ordenes/:id/lista', (req, res) => {
    const { id } = req.params;
    db.query("UPDATE ordenes SET estado = 'Lista' WHERE id_orden = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: `Orden ${id} marcada como Lista` });
    });
});

app.get('/api/caja', (req, res) => {
    db.query("SELECT * FROM ordenes WHERE estado = 'Lista' ORDER BY id_orden ASC", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// --- RUTA DE PRUEBA DEL FANTASMA (Solo simula el cobro, NO descuenta stock) ---
app.put('/api/ordenes/:id/pagar', (req, res) => {
    const { id } = req.params;

    const sqlUpdate = "UPDATE ordenes SET estado = 'Pagada' WHERE id_orden = ? AND estado != 'Pagada'";
    db.query(sqlUpdate, [id], (errUpd, resultUpd) => {
        if (errUpd) return res.status(500).json({ error: errUpd.message });
        
        if (resultUpd.affectedRows === 0) {
            return res.json({ mensaje: "Esta orden ya había sido cobrada." });
        }

        const sqlConsulta = `
            SELECT r.id_insumo, SUM(r.cantidad_requerida * d.cantidad) as total_gastado
            FROM detalles_orden d
            JOIN recetas r ON d.id_producto = r.id_producto
            WHERE d.id_orden = ?
            GROUP BY r.id_insumo
        `;
        db.query(sqlConsulta, [id], (errConsulta, ingredientes) => {
            if (errConsulta) return res.status(500).json({ error: errConsulta.message });
            
            // AQUI ESTÁ LA MAGIA: En lugar de hacer el UPDATE al stock, solo respondemos éxito.
            console.log("Ingredientes que se IBAN a descontar:", ingredientes);
            
            res.json({ 
                mensaje: `PRUEBA FANTASMA: Orden ${id} cobrada. Revisa tu inventario, ¡no debió bajar nada!` 
            });
        });
    });
});

app.get('/api/reportes/ventas', (req, res) => {
    const sql = `SELECT COUNT(id_orden) AS total_ordenes, COALESCE(SUM(total), 0) AS total_vendido FROM ordenes WHERE estado = 'Pagada'`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// --- RUTAS DE PRODUCTOS ---
app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos WHERE disponible = 1', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/productos', (req, res) => {
    const { nombre, precio } = req.body;
    db.query('INSERT INTO productos (nombre, precio, disponible) VALUES (?, ?, 1)', [nombre, precio], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' })
    });
});

app.delete('/api/productos/:id', (req, res) => {
    const { id } = req.params;
    db.query('UPDATE productos SET disponible = 0 WHERE id_producto = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' })
    });
});

// --- RUTAS DE INSUMOS ---
app.get('/api/insumos', (req, res) => {
    db.query('SELECT * FROM insumos', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/insumos', (req, res) => {
    const { nombre, cantidad_actual } = req.body;
    db.query('INSERT INTO insumos (nombre, cantidad_actual) VALUES (?, ?)', [nombre, cantidad_actual], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' })
    });
});

app.put('/api/insumos/:id/stock', (req, res) => {
    const { id } = req.params;
    const { cantidad_agregar } = req.body;
    db.query('UPDATE insumos SET cantidad_actual = cantidad_actual + ? WHERE id_insumo = ?', [parseFloat(cantidad_agregar), id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' })
    });
});

// --- RUTAS DE RECETAS (CON CANTIDAD_REQUERIDA) ---
app.get('/api/recetas', (req, res) => {
    const sql = `
        SELECT r.id_producto, p.nombre as nombre_producto, r.id_insumo, i.nombre as nombre_insumo, r.cantidad_requerida 
        FROM recetas r
        JOIN productos p ON r.id_producto = p.id_producto
        JOIN insumos i ON r.id_insumo = i.id_insumo
        ORDER BY p.nombre ASC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/recetas/:id_producto', (req, res) => {
    const { id_producto } = req.params;
    const sql = `
        SELECT r.id_producto, r.id_insumo, r.cantidad_requerida, i.nombre as nombre_insumo 
        FROM recetas r
        JOIN insumos i ON r.id_insumo = i.id_insumo
        WHERE r.id_producto = ?
    `;
    db.query(sql, [id_producto], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/recetas', (req, res) => {
    const { id_producto, id_insumo, cantidad_requerida } = req.body;
    db.query('INSERT INTO recetas (id_producto, id_insumo, cantidad_requerida) VALUES (?, ?, ?)', 
    [id_producto, id_insumo, cantidad_requerida], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

app.delete('/api/recetas/:id_producto/:id_insumo', (req, res) => {
    const { id_producto, id_insumo } = req.params;
    db.query('DELETE FROM recetas WHERE id_producto = ? AND id_insumo = ?', [id_producto, id_insumo], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

// --- RUTA DETECTIVE: Para descubrir por qué descuenta doble ---
app.get('/api/detective/:id_orden', (req, res) => {
    const { id_orden } = req.params;
    const sql = `
        SELECT r.id_insumo, i.nombre as ingrediente, d.cantidad as cantidad_vendida, r.cantidad_requerida as receta_pide, 
        (r.cantidad_requerida * d.cantidad) as total_a_descontar
        FROM detalles_orden d
        JOIN recetas r ON d.id_producto = r.id_producto
        JOIN insumos i ON r.id_insumo = i.id_insumo
        WHERE d.id_orden = ?
    `;
    db.query(sql, [id_orden], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            mensaje: "Si 'total_a_descontar' dice 1, pero tu inventario bajó 2, TIENES UN TRIGGER OCULTO EN DBeaver.",
            calculo_matematico: result
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

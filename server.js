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

    // Aseguramos que exista la columna notas
    db.query("ALTER TABLE detalles_orden ADD COLUMN notas VARCHAR(255)", (errAlter) => {
        if (!errAlter) {
            console.log('Columna "notas" verificada/agregada a detalles_orden.');
        }
    });
});

app.get('/', (req, res) => {
    res.send('API Backend La Escondida - Funcionando correctamente');
});

// ==========================================
// 1. RUTAS DEL MENÚ DIGITAL
// ==========================================
app.get('/api/categorias', (req, res) => {
    db.query('SELECT * FROM categorias', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos WHERE disponible = 1', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==========================================
// 2. RUTAS DE PEDIDOS (CREAR ORDEN)
// ==========================================
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

// ==========================================
// 3. RUTAS PARA EL REPORTE DE VENTAS (HISTORIAL)
// ==========================================
app.get('/api/ordenes', (req, res) => {
    db.query('SELECT * FROM ordenes ORDER BY id_orden DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/ordenes/:id/detalles', (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM detalles_orden WHERE id_orden = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/reportes/ventas', (req, res) => {
    const sql = `
        SELECT 
            COUNT(id_orden) AS total_ordenes, 
            COALESCE(SUM(total), 0) AS total_vendido 
        FROM ordenes 
        WHERE estado = 'Pagada'
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// ==========================================
// 4. RUTAS DE COCINA Y CAJA
// ==========================================
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

// ESTA ES LA FUNCIÓN CORREGIDA PARA DESCONTAR INVENTARIO SIN FALLAS
app.put('/api/ordenes/:id/pagar', (req, res) => {
    const { id } = req.params;
    
    // 1. Cambiamos el estado a Pagada
    db.query("UPDATE ordenes SET estado = 'Pagada' WHERE id_orden = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // 2. Buscamos qué ingredientes gasta esta orden en específico
        const sqlConsulta = `
            SELECT r.id_insumo, SUM(r.cantidad_necesaria * d.cantidad) as total_gastado
            FROM detalles_orden d
            JOIN recetas r ON d.id_producto = r.id_producto
            WHERE d.id_orden = ?
            GROUP BY r.id_insumo
        `;
        
        db.query(sqlConsulta, [id], (errConsulta, ingredientes) => {
            if (errConsulta) {
                console.error("Error al consultar receta:", errConsulta);
                return res.json({ mensaje: `Orden cobrada pero falló el descuento de inventario.` });
            }

            // Si la orden no tenía productos con receta, terminamos aquí
            if (!ingredientes || ingredientes.length === 0) {
                return res.json({ mensaje: `Orden ${id} cobrada (sin ingredientes que descontar).` });
            }

            // 3. Descontamos los ingredientes uno por uno (método 100% seguro)
            let procesados = 0;
            ingredientes.forEach(ing => {
                db.query(
                    "UPDATE insumos SET cantidad_actual = cantidad_actual - ? WHERE id_insumo = ?",
                    [ing.total_gastado, ing.id_insumo],
                    (errUpd) => {
                        if (errUpd) console.error("Error descontando insumo:", errUpd);
                        
                        procesados++;
                        // Cuando termine de actualizar el último ingrediente, mandamos el mensaje final
                        if (procesados === ingredientes.length) {
                            res.json({ mensaje: `Orden ${id} cobrada y el stock se descontó correctamente` });
                        }
                    }
                );
            });
        });
    });
});

// ==========================================
// 5. RUTAS DE ADMINISTRACIÓN (PANEL ADMIN)
// ==========================================

// PRODUCTOS
app.post('/api/productos', (req, res) => {
    const { nombre, precio } = req.body;
    db.query('INSERT INTO productos (nombre, precio, disponible) VALUES (?, ?, 1)', [nombre, precio], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto agregado exitosamente' });
    });
});

app.delete('/api/productos/:id', (req, res) => {
    const { id } = req.params;
    db.query('UPDATE productos SET disponible = 0 WHERE id_producto = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto eliminado del menú exitosamente' });
    });
});

// INSUMOS (INVENTARIO)
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
        res.json({ mensaje: 'Insumo agregado exitosamente' });
    });
});

app.put('/api/insumos/:id/stock', (req, res) => {
    const { id } = req.params;
    const { cantidad_agregar } = req.body;
    db.query('UPDATE insumos SET cantidad_actual = cantidad_actual + ? WHERE id_insumo = ?', 
    [parseFloat(cantidad_agregar), id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Stock actualizado con éxito' });
    });
});

// RECETAS
app.get('/api/recetas/:id_producto', (req, res) => {
    const { id_producto } = req.params;
    const sql = `
        SELECT r.id_producto, r.id_insumo, r.cantidad_necesaria, i.nombre as nombre_insumo 
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
    const { id_producto, id_insumo, cantidad_necesaria } = req.body;
    db.query('INSERT INTO recetas (id_producto, id_insumo, cantidad_necesaria) VALUES (?, ?, ?)', 
    [id_producto, id_insumo, cantidad_necesaria], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ingrediente agregado a la receta' });
    });
});

app.delete('/api/recetas/:id_producto/:id_insumo', (req, res) => {
    const { id_producto, id_insumo } = req.params;
    db.query('DELETE FROM recetas WHERE id_producto = ? AND id_insumo = ?', [id_producto, id_insumo], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ingrediente removido de la receta' });
    });
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

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

// 6. CREAR NUEVA ÓRDEN (COMANDA)
app.post('/api/ordenes', (req, res) => {
    const mesaFinal = req.body.numero_mesa || req.body.mesa || req.body.numMesa || 1;
    const detallesEnviados = req.body.detalles || req.body.productos || req.body.carrito || [];
    const totalFinal = req.body.total || 0;

    if (!Array.isArray(detallesEnviados) || detallesEnviados.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío' });
    }

    const sqlOrden = "INSERT INTO ordenes (numero_mesa, total, estado) VALUES (?, ?, 'Pendiente')";
    
    db.query(sqlOrden, [mesaFinal, totalFinal], (err, result) => {
        if (err) {
            console.error('Error orden MySQL:', err);
            return res.status(500).json({ error: err.message });
        }

        const id_orden = result.insertId;

        const valoresDetalles = detallesEnviados.map(item => {
            const prodId = parseInt(item.id_producto || item.id || item.producto_id);
            const cant = parseInt(item.cantidad || item.cant || 1);
            const precio = parseFloat(item.precio || item.precio_unitario || item.precioUnitario || 0);

            return [id_orden, isNaN(prodId) ? 1 : prodId, cant, precio];
        });

        const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario) VALUES ?';

        db.query(sqlDetalles, [valoresDetalles], (errDetalles) => {
            if (errDetalles) {
                console.error('Error detalles MySQL:', errDetalles);
                return res.status(500).json({ error: errDetalles.message });
            }

            res.json({ mensaje: '¡Orden creada con éxito!', id_orden });
        });
    });
});

// 7. ACTUALIZAR ESTADO DE UNA ÓRDEN
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

// 9. OBTENER ÓRDENES PARA EL MONITOR DE COCINA
app.get('/api/cocina', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, p.nombre, d.cantidad 
        FROM ordenes o
        JOIN detalles_orden d ON o.id_orden = d.id_orden
        JOIN productos p ON d.id_producto = p.id_producto
        WHERE o.estado = 'Pendiente'
        ORDER BY o.id_orden ASC
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error al consultar cocina:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// 10. MARCAR ORDEN COMO 'LISTA' DESDE COCINA
app.put('/api/ordenes/:id/lista', (req, res) => {
    const { id } = req.params;
    db.query("UPDATE ordenes SET estado = 'Lista' WHERE id_orden = ?", [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: `Orden ${id} marcada como Lista` });
    });
});

// 11. OBTENER ÓRDENES PARA LA CAJA (Listas para cobrar)
app.get('/api/caja', (req, res) => {
    db.query("SELECT * FROM ordenes WHERE estado = 'Lista' ORDER BY id_orden ASC", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 12. COBRAR ORDEN Y DESCONTAR INVENTARIO
app.put('/api/ordenes/:id/pagar', (req, res) => {
    const { id } = req.params;
    
    // Cambiar estado a Pagada
    db.query("UPDATE ordenes SET estado = 'Pagada' WHERE id_orden = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Descontar ingredientes basados en las recetas del pedido
        const sqlDescuento = `
            UPDATE insumos i
            JOIN (
                SELECT r.id_insumo, SUM(r.cantidad_necesaria * d.cantidad) as total_gastado
                FROM detalles_orden d
                JOIN recetas r ON d.id_producto = r.id_producto
                WHERE d.id_orden = ?
                GROUP BY r.id_insumo
            ) as consumo ON i.id_insumo = consumo.id_insumo
            SET i.cantidad_actual = i.cantidad_actual - consumo.total_gastado
        `;
        
        db.query(sqlDescuento, [id], (errDesc) => {
            if (errDesc) console.error("Error descontando inventario:", errDesc);
            res.json({ mensaje: `Orden ${id} cobrada y stock actualizado` });
        });
    });
});

// 13. REPORTE DE VENTAS DEL DÍA
app.get('/api/reportes/ventas', (req, res) => {
    const sql = `
        SELECT 
            COUNT(id_orden) AS total_ordenes, 
            COALESCE(SUM(total), 0) AS total_vendido 
        FROM ordenes 
        WHERE estado = 'Pagada'
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error al generar reporte:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results[0]);
    });
});

// 14. AGREGAR PRODUCTO NUEVO (PANEL ADMIN)
app.post('/api/productos', (req, res) => {
    const { nombre, precio } = req.body;
    db.query('INSERT INTO productos (nombre, precio, disponible) VALUES (?, ?, 1)', [nombre, precio], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Producto agregado exitosamente' });
    });
});

// 15. AGREGAR INSUMO NUEVO DESDE CERO (PANEL ADMIN)
app.post('/api/insumos', (req, res) => {
    const { nombre, cantidad_actual } = req.body;
    db.query('INSERT INTO insumos (nombre, cantidad_actual) VALUES (?, ?)', [nombre, cantidad_actual], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Insumo agregado exitosamente' });
    });
});

// 16. SUMAR STOCK A UN INSUMO EXISTENTE (PANEL ADMIN)
app.put('/api/insumos/:id/stock', (req, res) => {
    const { id } = req.params;
    const { cantidad_agregar } = req.body;
    
    db.query('UPDATE insumos SET cantidad_actual = cantidad_actual + ? WHERE id_insumo = ?', 
    [parseFloat(cantidad_agregar), id], 
    (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Stock actualizado con éxito' });
    });
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

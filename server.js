const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Contraseña única para proteger las acciones de administración.
// Se recomienda configurar ADMIN_PASSWORD como variable de entorno en Render.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'laescondida2026';

function requiereAdmin(req, res, next) {
    const password = req.header('x-admin-password');
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
}

// Número de orden visible que se reinicia cada día (zona horaria -06:00), sin tocar el id_orden real
const SQL_NUMERO_DIA = `(
    SELECT COUNT(*) FROM ordenes o2
    WHERE DATE(CONVERT_TZ(o2.fecha_creacion, '+00:00', '-06:00')) = DATE(CONVERT_TZ(o.fecha_creacion, '+00:00', '-06:00'))
      AND o2.fecha_creacion <= o.fecha_creacion
) AS numero_dia`;

// Pool de conexiones a MySQL (Aiven Cloud)
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        return;
    }
    console.log('¡Conectado exitosamente al Pool de MySQL!');
    
    // Aseguramos que existan las columnas sin detener el servidor si ya existen
    connection.query("ALTER TABLE detalles_orden ADD COLUMN notas VARCHAR(255)", () => {});
    connection.query("ALTER TABLE insumos ADD COLUMN stock_minimo DECIMAL(10,2) DEFAULT 5", () => {});
    connection.query("ALTER TABLE ordenes ADD COLUMN motivo_rechazo VARCHAR(255)", () => {});
    connection.query("ALTER TABLE ordenes ADD COLUMN tipo_pedido VARCHAR(20) DEFAULT 'mesa'", () => {});
    connection.query("ALTER TABLE ordenes ADD COLUMN nombre_cliente VARCHAR(100)", () => {});
    connection.query("ALTER TABLE ordenes ADD COLUMN telefono VARCHAR(20)", () => {});
    connection.query("ALTER TABLE ordenes ADD COLUMN direccion VARCHAR(255)", () => {});
    connection.query("ALTER TABLE productos ADD COLUMN categoria VARCHAR(50)", () => {});
    connection.query("ALTER TABLE detalles_orden ADD COLUMN nota_personalizada VARCHAR(255)", () => {});
    
    connection.release();
});

app.get('/', (req, res) => {
    res.send('API Backend La Escondida - Funcionando correctamente');
});

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        return res.json({ ok: true });
    }
    res.status(401).json({ error: 'Contraseña incorrecta' });
});

// ==========================================
// --- RUTAS DE ÓRDENES, COCINA Y CAJA ---
// ==========================================

app.post('/api/ordenes', (req, res) => {
    const mesaFinal = req.body.numero_mesa || req.body.mesa || req.body.numMesa || 1;
    const detallesEnviados = req.body.detalles || req.body.productos || req.body.carrito || [];
    const tipoPedido = req.body.tipo_pedido || 'mesa';
    const nombreCliente = req.body.nombre_cliente || null;
    const telefono = req.body.telefono || null;
    const direccion = req.body.direccion || null;

    if (!Array.isArray(detallesEnviados) || detallesEnviados.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío' });
    }

    if (tipoPedido !== 'mesa') {
        if (!nombreCliente || !telefono) {
            return res.status(400).json({ error: 'Nombre y teléfono son obligatorios para pedidos en línea' });
        }
        if (tipoPedido === 'domicilio' && !direccion) {
            return res.status(400).json({ error: 'La dirección es obligatoria para pedidos a domicilio' });
        }
    }

    const itemsCrudos = detallesEnviados.map(item => {
        const prodIdCrudo = parseInt(item.id_producto || item.id || item.producto_id);
        return {
            prodId: isNaN(prodIdCrudo) ? 1 : prodIdCrudo,
            cant: parseInt(item.cantidad || item.cant || 1),
            nombre: item.nombre || null,
            nota: item.nota ? String(item.nota).trim().slice(0, 255) : null
        };
    });

    // Agrupamos por producto + nota: 2 capuchinos iguales se juntan en una sola línea,
    // pero "capuchino sin azúcar" no se mezcla con "capuchino normal"
    const agrupados = {};
    itemsCrudos.forEach(item => {
        const clave = `${item.prodId}::${item.nota || ''}`;
        if (!agrupados[clave]) {
            agrupados[clave] = { prodId: item.prodId, cant: 0, nombre: item.nombre, nota: item.nota };
        }
        agrupados[clave].cant += item.cant;
    });
    const itemsCarrito = Object.values(agrupados);

    const idsProductos = [...new Set(itemsCarrito.map(i => i.prodId))];

    // Ignoramos el precio enviado por el cliente: lo tomamos siempre de la BD
    db.query('SELECT id_producto, precio FROM productos WHERE id_producto IN (?) AND disponible = 1', [idsProductos], (errPrecios, productosDb) => {
        if (errPrecios) return res.status(500).json({ error: errPrecios.message });

        const preciosPorId = {};
        productosDb.forEach(p => { preciosPorId[p.id_producto] = parseFloat(p.precio); });

        const valoresDetalles = itemsCarrito.map(item => {
            const precioReal = preciosPorId[item.prodId];
            if (precioReal === undefined) return null;
            return [item.prodId, item.cant, precioReal, item.nombre, item.nota];
        });

        if (valoresDetalles.some(v => v === null)) {
            return res.status(400).json({ error: 'Uno o más productos del carrito no existen o no están disponibles' });
        }

        const totalFinal = valoresDetalles.reduce((suma, [, cant, precio]) => suma + (cant * precio), 0);
        const mesaParaGuardar = tipoPedido === 'mesa' ? mesaFinal : 0;

        const sqlOrden = "INSERT INTO ordenes (numero_mesa, total, estado, tipo_pedido, nombre_cliente, telefono, direccion) VALUES (?, ?, 'Pendiente', ?, ?, ?, ?)";
        db.query(sqlOrden, [mesaParaGuardar, totalFinal, tipoPedido, nombreCliente, telefono, direccion], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });

            const id_orden = result.insertId;
            const filasDetalles = valoresDetalles.map(([prodId, cant, precio, notas, nota]) => [id_orden, prodId, cant, precio, notas, nota]);

            const sqlDetalles = 'INSERT INTO detalles_orden (id_orden, id_producto, cantidad, precio_unitario, notas, nota_personalizada) VALUES ?';
            db.query(sqlDetalles, [filasDetalles], (errDetalles) => {
                if (errDetalles) return res.status(500).json({ error: errDetalles.message });
                res.json({ mensaje: '¡Orden creada con éxito!', id_orden });
            });
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
        SELECT o.id_orden, o.numero_mesa, o.tipo_pedido, o.nombre_cliente, o.telefono, o.direccion, o.fecha_creacion,
               IFNULL(d.notas, p.nombre) AS nombre, d.cantidad, d.nota_personalizada AS nota, ${SQL_NUMERO_DIA}
        FROM ordenes o
        JOIN detalles_orden d ON o.id_orden = d.id_orden
        JOIN productos p ON d.id_producto = p.id_producto
        WHERE o.estado = 'Pendiente'
        ORDER BY o.id_orden ASC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length === 0) return res.json([]);

        const idsOrdenes = [...new Set(results.map(r => r.id_orden))];

        // Detectamos qué órdenes pendientes no tienen insumo suficiente para prepararse
        const sqlFaltantes = `
            SELECT d.id_orden, i.nombre AS insumo, i.cantidad_actual, SUM(r.cantidad_requerida * d.cantidad) AS total_requerido
            FROM detalles_orden d
            JOIN recetas r ON d.id_producto = r.id_producto
            JOIN insumos i ON r.id_insumo = i.id_insumo
            WHERE d.id_orden IN (?)
            GROUP BY d.id_orden, i.id_insumo, i.nombre, i.cantidad_actual
            HAVING i.cantidad_actual < total_requerido
        `;

        db.query(sqlFaltantes, [idsOrdenes], (errFaltantes, faltantes) => {
            if (errFaltantes) return res.status(500).json({ error: errFaltantes.message });

            const faltantesPorOrden = {};
            faltantes.forEach(f => {
                if (!faltantesPorOrden[f.id_orden]) faltantesPorOrden[f.id_orden] = [];
                faltantesPorOrden[f.id_orden].push(`${f.insumo} (disponible: ${f.cantidad_actual}, requerido: ${f.total_requerido})`);
            });

            const resultadosConAlerta = results.map(r => ({
                ...r,
                alerta_insumo: faltantesPorOrden[r.id_orden] ? faltantesPorOrden[r.id_orden].join('; ') : null
            }));

            res.json(resultadosConAlerta);
        });
    });
});

app.put('/api/ordenes/:id/lista', (req, res) => {
    const { id } = req.params;
    db.query("UPDATE ordenes SET estado = 'Lista' WHERE id_orden = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: `Orden ${id} marcada como Lista` });
    });
});

app.put('/api/ordenes/:id/rechazar', (req, res) => {
    const { id } = req.params;
    const motivo = req.body.motivo || 'Falta de insumo';

    db.query(
        "UPDATE ordenes SET estado = 'Rechazada', motivo_rechazo = ? WHERE id_orden = ? AND estado = 'Pendiente'",
        [motivo, id],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (result.affectedRows === 0) {
                return res.status(400).json({ error: 'La orden ya no está pendiente, no se pudo rechazar.' });
            }
            res.json({ mensaje: `Orden ${id} rechazada` });
        }
    );
});

// Vista de solo lectura para el mesero: todo el ciclo activo de una orden
app.get('/api/mesero', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, o.estado, o.total, o.motivo_rechazo,
               o.tipo_pedido, o.nombre_cliente, o.telefono, o.direccion,
               IFNULL(d.notas, p.nombre) AS nombre_producto, d.cantidad, d.nota_personalizada AS nota, ${SQL_NUMERO_DIA}
        FROM ordenes o
        JOIN detalles_orden d ON o.id_orden = d.id_orden
        JOIN productos p ON d.id_producto = p.id_producto
        WHERE o.estado IN ('Pendiente', 'Lista', 'Rechazada')
        ORDER BY o.id_orden ASC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/caja', (req, res) => {
    const sql = `SELECT o.*, ${SQL_NUMERO_DIA} FROM ordenes o WHERE o.estado IN ('Lista', 'Rechazada') ORDER BY o.id_orden ASC`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// El mesero confirma que ya avisó al cliente que la orden fue rechazada
app.put('/api/ordenes/:id/notificar-rechazo', (req, res) => {
    const { id } = req.params;
    db.query("UPDATE ordenes SET estado = 'Cancelada' WHERE id_orden = ? AND estado = 'Rechazada'", [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) {
            return res.status(400).json({ error: 'No se pudo actualizar la orden.' });
        }
        res.json({ mensaje: `Orden ${id} cerrada` });
    });
});

// Cobro atómico con descuento de inventario unificado
app.put('/api/ordenes/:id/pagar', (req, res) => {
    const { id } = req.params;

    const sqlUpdateEstado = "UPDATE ordenes SET estado = 'Pagada' WHERE id_orden = ? AND estado != 'Pagada'";

    db.query(sqlUpdateEstado, [id], (errUpd, resultUpd) => {
        if (errUpd) return res.status(500).json({ error: errUpd.message });

        if (resultUpd.affectedRows === 0) {
            return res.json({ mensaje: "Esta orden ya había sido cobrada anteriormente." });
        }

        const sqlDescuentoUnificado = `
            UPDATE insumos i
            JOIN (
                SELECT r.id_insumo, SUM(r.cantidad_requerida * d.cantidad) AS total_a_restar
                FROM detalles_orden d
                JOIN recetas r ON d.id_producto = r.id_producto
                WHERE d.id_orden = ?
                GROUP BY r.id_insumo
            ) sub ON i.id_insumo = sub.id_insumo
            SET i.cantidad_actual = i.cantidad_actual - sub.total_a_restar
        `;

        db.query(sqlDescuentoUnificado, [id], (errDescuento) => {
            if (errDescuento) {
                return res.status(500).json({ error: "Orden cobrada, pero falló el descuento de inventario: " + errDescuento.message });
            }

            res.json({ mensaje: `¡Orden #${id} cobrada exitosamente!` });
        });
    });
});

// ==========================================
// --- RUTAS DE REPORTES Y VENTAS POR DÍA ---
// ==========================================

// Reporte acumulado general
app.get('/api/reportes/ventas', (req, res) => {
    const sql = `SELECT COUNT(id_orden) AS total_ordenes, COALESCE(SUM(total), 0) AS total_vendido FROM ordenes WHERE estado = 'Pagada'`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// Reporte del día actual con ajuste de zona horaria (-06:00)
app.get('/api/reportes/ventas/hoy', (req, res) => {
    const sql = `
        SELECT COUNT(id_orden) AS total_ordenes, COALESCE(SUM(total), 0) AS total_vendido 
        FROM ordenes 
        WHERE estado = 'Pagada' 
          AND DATE(CONVERT_TZ(fecha_creacion, '+00:00', '-06:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '-06:00'))
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// Historial de ventas agrupado por cada día de trabajo, con desglose por turno
// (Mañana: antes de las 17:00 / Tarde: desde las 17:00, hora local -06:00)
app.get('/api/reportes/ventas/historial', (req, res) => {
    const sql = `
        SELECT DATE_FORMAT(CONVERT_TZ(fecha_creacion, '+00:00', '-06:00'), '%Y-%m-%d') as fecha, 
               COUNT(id_orden) as total_ordenes, 
               COALESCE(SUM(total), 0) as total_vendido,
               SUM(CASE WHEN TIME(CONVERT_TZ(fecha_creacion, '+00:00', '-06:00')) < '17:00:00' THEN 1 ELSE 0 END) as ordenes_manana,
               COALESCE(SUM(CASE WHEN TIME(CONVERT_TZ(fecha_creacion, '+00:00', '-06:00')) < '17:00:00' THEN total ELSE 0 END), 0) as vendido_manana,
               SUM(CASE WHEN TIME(CONVERT_TZ(fecha_creacion, '+00:00', '-06:00')) >= '17:00:00' THEN 1 ELSE 0 END) as ordenes_tarde,
               COALESCE(SUM(CASE WHEN TIME(CONVERT_TZ(fecha_creacion, '+00:00', '-06:00')) >= '17:00:00' THEN total ELSE 0 END), 0) as vendido_tarde
        FROM ordenes
        WHERE estado = 'Pagada'
        GROUP BY DATE_FORMAT(CONVERT_TZ(fecha_creacion, '+00:00', '-06:00'), '%Y-%m-%d')
        ORDER BY fecha DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Comandas (órdenes pagadas) de un día específico, elegido por el usuario
app.get('/api/reportes/ventas/comandas', (req, res) => {
    const fecha = req.query.fecha;
    if (!fecha) {
        return res.status(400).json({ error: 'Falta el parámetro fecha (formato YYYY-MM-DD)' });
    }

    const sql = `
        SELECT o.id_orden, o.numero_mesa, o.tipo_pedido, o.nombre_cliente, o.total,
               DATE_FORMAT(CONVERT_TZ(o.fecha_creacion, '+00:00', '-06:00'), '%H:%i') AS hora,
               ${SQL_NUMERO_DIA}
        FROM ordenes o
        WHERE o.estado = 'Pagada'
          AND DATE(CONVERT_TZ(o.fecha_creacion, '+00:00', '-06:00')) = ?
        ORDER BY o.fecha_creacion ASC
    `;
    db.query(sql, [fecha], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ==========================================
// --- RUTAS DE PRODUCTOS, INSUMOS Y RECETAS ---
// ==========================================

app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos WHERE disponible = 1', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Listado completo (incluye deshabilitados) para el panel de administración
app.get('/api/productos/todos', requiereAdmin, (req, res) => {
    db.query('SELECT * FROM productos ORDER BY nombre ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/productos', requiereAdmin, (req, res) => {
    const { nombre, precio, categoria } = req.body;
    db.query('INSERT INTO productos (nombre, precio, disponible, categoria) VALUES (?, ?, 1, ?)', [nombre, precio, categoria || null], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

app.put('/api/productos/:id', requiereAdmin, (req, res) => {
    const { id } = req.params;
    const { nombre, precio, categoria } = req.body;
    db.query('UPDATE productos SET nombre = ?, precio = ?, categoria = ? WHERE id_producto = ?', [nombre, precio, categoria || null, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

// Habilita o deshabilita un producto (reversible, no se borra de la base de datos)
app.put('/api/productos/:id/disponibilidad', requiereAdmin, (req, res) => {
    const { id } = req.params;
    const disponible = req.body.disponible ? 1 : 0;
    db.query('UPDATE productos SET disponible = ? WHERE id_producto = ?', [disponible, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

app.get('/api/insumos', (req, res) => {
    db.query('SELECT * FROM insumos ORDER BY nombre ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/insumos', requiereAdmin, (req, res) => {
    const { nombre, cantidad_actual } = req.body;
    db.query('INSERT INTO insumos (nombre, cantidad_actual) VALUES (?, ?)', [nombre, cantidad_actual], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

app.put('/api/insumos/:id', requiereAdmin, (req, res) => {
    const { id } = req.params;
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    }
    db.query('UPDATE insumos SET nombre = ? WHERE id_insumo = ?', [nombre.trim(), id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

app.delete('/api/insumos/:id', requiereAdmin, (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM insumos WHERE id_insumo = ?', [id], (err) => {
        if (err) {
            if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
                return res.status(400).json({ error: 'Este insumo está usado en una o más recetas. Quítalo de esas recetas primero.' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ mensaje: 'Ok' });
    });
});

app.put('/api/insumos/:id/stock', requiereAdmin, (req, res) => {
    const { id } = req.params;
    const { cantidad_agregar } = req.body;
    
    const cambio = parseFloat(cantidad_agregar);
    if (isNaN(cambio)) {
        return res.status(400).json({ error: 'Cantidad no válida' });
    }

    const sql = 'UPDATE insumos SET cantidad_actual = cantidad_actual + ? WHERE id_insumo = ?';
    db.query(sql, [cambio, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Stock actualizado con éxito' });
    });
});

// NUEVA RUTA: Actualizar el stock mínimo de un insumo
app.put('/api/insumos/:id/minimo', requiereAdmin, (req, res) => {
    const { id } = req.params;
    const { stock_minimo } = req.body;
    
    const minimo = parseFloat(stock_minimo);
    if (isNaN(minimo)) {
        return res.status(400).json({ error: 'Cantidad no válida' });
    }

    const sql = 'UPDATE insumos SET stock_minimo = ? WHERE id_insumo = ?';
    db.query(sql, [minimo, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Stock mínimo actualizado con éxito' });
    });
});

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

app.post('/api/recetas', requiereAdmin, (req, res) => {
    const { id_producto, id_insumo, cantidad_requerida } = req.body;
    db.query('INSERT INTO recetas (id_producto, id_insumo, cantidad_requerida) VALUES (?, ?, ?)', 
    [id_producto, id_insumo, cantidad_requerida], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

app.delete('/api/recetas/:id_producto/:id_insumo', requiereAdmin, (req, res) => {
    const { id_producto, id_insumo } = req.params;
    db.query('DELETE FROM recetas WHERE id_producto = ? AND id_insumo = ?', [id_producto, id_insumo], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Ok' });
    });
});

// ==========================================
// --- RUTA PARA ALERTAS DE INVENTARIO ---
// ==========================================

app.get('/api/alertas/inventario', (req, res) => {
    // Compara el stock actual vs el mínimo establecido en la BD
    const sql = `
        SELECT nombre, cantidad_actual, stock_minimo 
        FROM insumos 
        WHERE cantidad_actual <= stock_minimo
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Detalle completo de una orden (para imprimir ticket o ver comanda en reportes)
app.get('/api/ordenes/:id/detalle', (req, res) => {
    const { id } = req.params;

    const sqlOrden = `SELECT o.*, ${SQL_NUMERO_DIA} FROM ordenes o WHERE o.id_orden = ?`;
    db.query(sqlOrden, [id], (errOrden, ordenes) => {
        if (errOrden) return res.status(500).json({ error: errOrden.message });
        if (ordenes.length === 0) return res.status(404).json({ error: 'Orden no encontrada' });

        const sqlItems = `
            SELECT IFNULL(d.notas, p.nombre) AS nombre, d.cantidad, d.precio_unitario, d.nota_personalizada AS nota
            FROM detalles_orden d
            JOIN productos p ON d.id_producto = p.id_producto
            WHERE d.id_orden = ?
        `;
        db.query(sqlItems, [id], (errItems, items) => {
            if (errItems) return res.status(500).json({ error: errItems.message });
            res.json({ orden: ordenes[0], items });
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
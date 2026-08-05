const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de base de datos
const db = mysql.createConnection({
    host: 'mysql-3b6d18b2-atoblanked2026.g.aivencloud.com',
    port: '28686',
    user: 'avnadmin',
    password: 'AVNS_AXY807GPv_BP8_8m1V3',
    database: 'defaultdb',
    ssl: {
        rejectUnauthorized: false
    }
});

db.connect(err => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        return;
    }
    console.log('¡Conectado exitosamente a la base de datos MySQL!');
});

// 1. Ruta: Obtener productos (Para la Carta)
app.get('/api/productos', (req, res) => {
    const sql = 'SELECT * FROM productos';
    db.query(sql, (err, result) => {
        if (err) {
            console.error('Error SQL:', err); // Muestra el error exacto en la terminal
            return res.status(500).send('Error');
        }
        res.json(result);
    });
});

// 2. Ruta: Crear nueva orden (Para la Carta)
app.post('/api/ordenes', (req, res) => {
    const { mesa, total, carrito } = req.body;
    
    const sqlOrden = 'INSERT INTO Ordenes (numero_mesa, total) VALUES (?, ?)';
    db.query(sqlOrden, [mesa, total], (err, result) => {
        if (err) return res.status(500).send('Error al crear orden');
        
        const idOrden = result.insertId; 
        const detalles = carrito.map(item => [idOrden, item.id_producto, 1, item.precio]);
        
        const sqlDetalles = 'INSERT INTO Detalles_Orden (id_orden, id_producto, cantidad, precio_unitario) VALUES ?';
        db.query(sqlDetalles, [detalles], (err2) => {
            if (err2) return res.status(500).send('Error al guardar detalles');
            res.json({ success: true, id_orden: idOrden });
        });
    });
});

// 3. Ruta: Leer órdenes pendientes (Para la Cocina)
app.get('/api/cocina', (req, res) => {
    const sql = `
        SELECT o.id_orden, o.numero_mesa, o.estado, p.nombre, d.cantidad 
        FROM Ordenes o
        JOIN Detalles_Orden d ON o.id_orden = d.id_orden
        JOIN Productos p ON d.id_producto = p.id_producto
        WHERE o.estado = 'Pendiente'
        ORDER BY o.id_orden ASC
    `;
    db.query(sql, (err, result) => {
        if (err) return res.status(500).send('Error en cocina');
        res.json(result);
    });
});

// 4. Ruta: Marcar orden como lista (Para la Cocina)
app.put('/api/ordenes/:id/lista', (req, res) => {
    const idOrden = req.params.id; 
    const sql = "UPDATE Ordenes SET estado = 'Lista' WHERE id_orden = ?";
    db.query(sql, [idOrden], (err, result) => {
        if (err) return res.status(500).send('Error al actualizar');
        res.json({ success: true, message: 'Orden lista' });
    });
});

// 5. Ruta: Obtener órdenes listas para Caja
app.get('/api/caja', (req, res) => {
    const sql = "SELECT * FROM Ordenes WHERE estado = 'Lista' ORDER BY id_orden ASC";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).send('Error en caja');
        res.json(result);
    });
});

// 6. Ruta: Cobrar orden y cambiar a 'Pagada'
app.put('/api/ordenes/:id/pagar', (req, res) => {
    const idOrden = req.params.id; 
    const sql = "UPDATE Ordenes SET estado = 'Pagada' WHERE id_orden = ?";
    db.query(sql, [idOrden], (err, result) => {
        if (err) return res.status(500).send('Error al cobrar');
        res.json({ success: true, message: 'Orden pagada y descontada' });
    });
});

// 7. Ruta: Reporte de ventas del día
app.get('/api/reportes/ventas', (req, res) => {
    // Sumamos el total de las órdenes pagadas el día de hoy
    const sql = `
        SELECT 
            COUNT(id_orden) as total_ordenes, 
            IFNULL(SUM(total), 0) as total_vendido 
        FROM Ordenes 
        WHERE estado = 'Pagada' AND DATE(fecha_creacion) = CURDATE()
    `;
    
    db.query(sql, (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al generar el reporte');
        }
        // Devolvemos el resultado a la pantalla
        res.json(result[0]); 
    });
});

// Iniciar servidor
app.listen(3000, () => {
    console.log(`Servidor corriendo en http://localhost:3000`);
});
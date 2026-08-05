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

// Ruta de prueba
app.get('/', (req, res) => {
    res.send('API Backend La Escondida corriendo correctamente');
});

// Ruta para obtener la lista de productos
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

// Asignación de puerto dinámico para Render (o 3000 localmente)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

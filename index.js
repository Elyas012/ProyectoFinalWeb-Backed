// server/index.js
require('dotenv').config();
const express = require('express');
const mysql   = require('mysql');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Pool de conexiones MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

db.connect(err => {
  if (err) {
    console.error('Error conectando a la base de datos:', err);
  } else {
    console.log('Conexión a la base de datos MySQL exitosa');
  }
});


// GET /products → devuelve todos los productos
app.get('/products', (req, res) => {
  const sql = 'SELECT id, nombre AS name, imagen AS image, precio AS price FROM productos';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error al consultar productos:', err);
      return res.status(500).json({ error: err.message });
    }
    console.log(`Se consultaron ${results.length} productos.`);
    res.json(results);
  });
});


// POST /checkout → crea cliente (si no existe), orden y orden_items
app.post('/checkout', (req, res) => {
  const { customer, items, total } = req.body;
  if (!customer?.email || !items?.length) {
    return res.status(400).json({ error: 'Faltan datos de cliente o carrito vacío.' });
  }

  // Obtenemos una conexión para transacción
  db.getConnection((err, conn) => {
    if (err) return res.status(500).json({ error: err.message });

    conn.beginTransaction(async err => {
      if (err) {
        conn.release();
        return res.status(500).json({ error: err.message });
      }

      try {
        // 1) Insertar cliente si no existe
        const [existing] = await queryPromise(conn,
          'SELECT id FROM clientes WHERE email = ?', [customer.email]);
        let clienteId;
        if (existing) {
          clienteId = existing.id;
        } else {
          const resultCliente = await queryPromise(conn,
            'INSERT INTO clientes (nombre, email, direccion) VALUES (?, ?, ?)',
            [customer.name, customer.email, customer.address]);
          clienteId = resultCliente.insertId;
        }

        // 2) Insertar orden
        const resultOrden = await queryPromise(conn,
          'INSERT INTO ordenes (cliente_id, total) VALUES (?, ?)',
          [clienteId, total]);
        const ordenId = resultOrden.insertId;

        // 3) Insertar cada item de la orden
        for (const item of items) {
          await queryPromise(conn,
            `INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario)
             VALUES (?, ?, ?, ?)`,
            [ordenId, item.id, item.quantity, item.price]);
        }

        // 4) Commit
        conn.commit(err => {
          if (err) {
            return conn.rollback(() => {
              conn.release();
              res.status(500).json({ error: err.message });
            });
          }
          conn.release();
          res.json({ status: 'ok', message: 'Orden registrada correctamente', ordenId });
        });

      } catch (e) {
        // Rollback en caso de error
        conn.rollback(() => {
          conn.release();
          res.status(500).json({ error: e.message });
        });
      }
    });
  });
});

// Helper para usar Promises con mysql
function queryPromise(conn, sql, params) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API corriendo en http://localhost:${PORT}`));

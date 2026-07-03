const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'srv1134.hstgr.io',
  port: 3306,
  user: process.env.DB_USER || 'u884869254_petflyinc',
  password: process.env.DB_PASSWORD || 'Jz10191019@@',
  database: process.env.DB_NAME || 'u884869254_petflyinc',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

module.exports = pool;

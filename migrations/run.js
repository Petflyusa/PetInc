const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function runMigrations() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'srv1134.hstgr.io',
    port: 3306,
    user: process.env.DB_USER || 'u884869254_petflyinc',
    password: process.env.DB_PASSWORD || 'Jz10191019@@',
    database: process.env.DB_NAME || 'u884869254_petflyinc',
    waitForConnections: true,
    connectionLimit: 5,
    multipleStatements: true
  });

  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration file(s)`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Running: ${file}`);
    try {
      await pool.query(sql);
      console.log(`  ✓ ${file} — OK`);
    } catch (err) {
      console.error(`  ✗ ${file} — ERROR: ${err.message}`);
      process.exit(1);
    }
  }

  // Verify tables
  const [rows] = await pool.query('SHOW TABLES');
  console.log('\nTables created:');
  rows.forEach(r => console.log(' ', Object.values(r)[0]));

  await pool.end();
  console.log('\nAll migrations complete.');
}

runMigrations().catch(e => { console.error(e); process.exit(1); });

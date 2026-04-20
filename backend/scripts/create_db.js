const fs = require('fs');
const { Client } = require('pg');
const path = require('path');

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return null;
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
    if (m) {
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  }
  return null;
}

function parseDatabaseName(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    // pathname like /dbname
    const p = u.pathname || '';
    return p.startsWith('/') ? p.slice(1) : p;
  } catch (e) {
    return null;
  }
}

(async () => {
  const databaseUrl = readDatabaseUrl();
  if (!databaseUrl) {
    console.error('DATABASE_URL not found in env or backend/.env');
    process.exit(1);
  }

  const dbName = parseDatabaseName(databaseUrl);
  if (!dbName) {
    console.error('Could not parse database name from DATABASE_URL');
    process.exit(1);
  }

  // Connect to default postgres database to create DB if missing
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });

  try {
    await client.connect();
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rowCount > 0) {
      console.log(`Database ${dbName} already exists`);
    } else {
      console.log(`Creating database ${dbName}...`);
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log('Created database.');
    }
    await client.end();
  } catch (err) {
    console.error('Error while ensuring database exists:', err);
    try { await client.end(); } catch (e) {}
    process.exit(1);
  }
})();

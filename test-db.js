// 獨立測試資料庫連線,跟 LINE / Express 完全無關
// 執行方式: node test-db.js

require('dotenv').config();
const mysql = require('mysql2/promise');

console.log('準備連線,使用以下設定:');
console.log('  DB_HOST:', process.env.DB_HOST);
console.log('  DB_PORT:', process.env.DB_PORT);
console.log('  DB_USER:', process.env.DB_USER);
console.log('  DB_NAME:', process.env.DB_NAME);
console.log('  DB_PASSWORD:', process.env.DB_PASSWORD ? '(有值,長度 ' + process.env.DB_PASSWORD.length + ')' : '(空的!)');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 20000,
    });
    console.log('✅ 連線成功!');
    const [rows] = await conn.query('SHOW TABLES');
    console.log('資料表清單:', rows);
    await conn.end();
  } catch (err) {
    console.error('❌ 連線失敗:');
    console.error(err);
  }
})();
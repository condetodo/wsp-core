// ============================================================
// Carga un asesor en la tabla `asesores` (con la contraseña hasheada).
// Uso:  node crear-asesor.js <usuario> "<nombre>" "<password>" [whatsapp]
// Ej:   node crear-asesor.js fran "Francisco" "claveSegura" 541160551206
// ============================================================
require('dotenv').config();
const { crearAsesor } = require('./asesores');

async function main() {
  const [usuario, nombre, password, whatsapp] = process.argv.slice(2);
  if (!usuario || !nombre || !password) {
    console.error('Uso: node crear-asesor.js <usuario> "<nombre>" "<password>" [whatsapp]');
    process.exit(1);
  }
  const a = await crearAsesor(usuario, nombre, password, whatsapp || null);
  console.log('✅ Asesor creado/actualizado:', a);
  process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });

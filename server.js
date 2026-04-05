const { startServer } = require('./src/server');

startServer().catch((error) => {
  console.error('Nie udalo sie uruchomic aplikacji:', error);
  process.exit(1);
});

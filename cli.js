const { main } = require('./index.js');

try {
  main();
} catch (error) {
  console.error('Error running copilot-instructions-project-structure:', error);
  process.exit(1);
}

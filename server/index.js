import { createApp } from './app.js';

const port = Number(process.env.PORT || 4000);
const app = await createApp();

app.listen(port, '127.0.0.1', () => {
  console.log(`Court Kicks API listening at http://127.0.0.1:${port}`);
});

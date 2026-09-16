/**
 * 行程進入點。
 *
 * app 本身建在 app.ts —— 拆開是為了讓測試可以 import 這個 app、
 * 掛到任意 port（或直接用 app.callback()），而不會在 import 的當下
 * 就佔用 3001。整合測試需要這件事。
 */
import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

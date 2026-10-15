import { createApp } from './app';
import { readConfig } from './config';

async function main() {
  const config = readConfig(process.env);
  const app = await createApp(config);
  // 컨테이너 안에서는 모든 주소에 붙고, 밖으로는 compose 가 127.0.0.1:3002 로만 연다.
  await app.listen(config.port, '0.0.0.0');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

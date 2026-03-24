import { hashPassword } from './worker/src/lib/password';

async function main() {
  const hash = await hashPassword('admin123');
  console.log(hash);
}

main();

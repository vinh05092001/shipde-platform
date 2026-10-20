// Fixtures for `semgrep --test tools/semgrep/rules`. Each `ruleid:` line must
// match and each `ok:` line must not.
declare const prisma: any;
declare const logger: any;
declare const user: { password: string; email: string };
declare const input: string;

// ruleid: shipde-no-dynamic-code
eval(input);
// ruleid: shipde-no-dynamic-code
const f = new Function('a', input);
// ok: shipde-no-dynamic-code
JSON.parse(input);

// ruleid: shipde-no-unsafe-raw-sql
prisma.$queryRawUnsafe('SELECT * FROM users WHERE id = ' + input);
// ruleid: shipde-no-unsafe-raw-sql
prisma.$executeRawUnsafe(input);
// ok: shipde-no-unsafe-raw-sql
prisma.$queryRaw`SELECT * FROM users WHERE id = ${input}`;

// ruleid: shipde-no-secret-in-log
console.log('login', user.password);
// ruleid: shipde-no-secret-in-log
logger.info('issued', otp);
// ok: shipde-no-secret-in-log
logger.info('login', user.email);

declare const otp: string;
export { f };

import assert from 'node:assert/strict';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { validate } from '../common/validation';
import { parsePage, paged } from '../common/pagination';
import { DomainError, DomainErrorCode } from '../common/errors';

async function run() {
  console.log('--- auth unit tests ---');

  // --- PasswordService ------------------------------------------------------
  const passwords = new PasswordService();

  const hash = await passwords.hash('Correct-Horse-1');
  assert.ok(hash.startsWith('scrypt$'), 'hash carries its algorithm and cost');
  assert.ok(!hash.includes('Correct-Horse-1'), 'plaintext never appears in the hash');
  assert.equal(await passwords.verify('Correct-Horse-1', hash), true, 'correct password verifies');
  assert.equal(await passwords.verify('correct-horse-1', hash), false, 'verification is case sensitive');
  assert.equal(await passwords.verify('', hash), false, 'empty password rejected');

  const second = await passwords.hash('Correct-Horse-1');
  assert.notEqual(hash, second, 'same password salts to a different hash');

  for (const malformed of ['', 'nonsense', 'scrypt$1$2', 'bcrypt$32768$a$b', 'scrypt$8$aa$bb']) {
    assert.equal(await passwords.verify('x', malformed), false, 'malformed hash rejected: ' + malformed);
  }
  assert.equal(passwords.needsRehash(hash), false, 'current-cost hash needs no rehash');
  assert.equal(passwords.needsRehash('scrypt$16384$aa$bb'), true, 'weaker cost is flagged');

  // --- TokenService ---------------------------------------------------------
  const tokens = new TokenService();

  const issued = tokens.issue(30);
  assert.ok(issued.token.length >= 40, 'token has real entropy');
  assert.notEqual(issued.token, issued.hash, 'stored value is not the token');
  assert.equal(tokens.matches(issued.token, issued.hash), true, 'issued token matches its hash');
  assert.equal(tokens.matches(issued.token + 'x', issued.hash), false, 'altered token rejected');
  assert.equal(tokens.matches(issued.token, 'not-hex'), false, 'malformed stored hash rejected');
  assert.equal(tokens.matches(issued.token, ''), false, 'empty stored hash rejected');

  assert.equal(tokens.isExpired(new Date(Date.now() - 1000)), true, 'past expiry is expired');
  assert.equal(tokens.isExpired(new Date(Date.now() + 60_000)), false, 'future expiry is live');
  assert.equal(tokens.isExpired(null), true, 'missing expiry treated as expired');

  const codes = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const code = tokens.numericCode();
    assert.match(code, /^\d{6}$/, 'code is exactly six digits');
    codes.add(code);
  }
  assert.ok(codes.size > 150, 'codes are not repeating, got ' + codes.size + ' distinct of 200');

  // --- Validator ------------------------------------------------------------
  {
    const v = validate({ email: 'NGUOI@ViDu.VN ', phone: '+84 912 345 678' });
    const email = v.email();
    const phone = v.phone();
    v.throwIfInvalid();
    assert.equal(email, 'nguoi@vidu.vn', 'email is trimmed and lowercased');
    assert.equal(phone, '0912345678', '+84 is normalised to a leading zero');
  }

  for (const bad of ['khong-co-a-still', 'a@b', '@vidu.vn', 'nguoi@']) {
    const v = validate({ email: bad });
    v.email();
    assert.throws(() => v.throwIfInvalid(), /không hợp lệ/, 'rejects email: ' + bad);
  }

  for (const bad of ['0123456789', '12345', '+841234567890123']) {
    const v = validate({ phone: bad });
    v.phone();
    assert.throws(() => v.throwIfInvalid(), /không hợp lệ/, 'rejects phone: ' + bad);
  }

  for (const weak of ['short', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere']) {
    const v = validate({ password: weak });
    v.password();
    assert.throws(() => v.throwIfInvalid(), DomainError, 'rejects weak password: ' + weak);
  }
  {
    const v = validate({ password: 'Strong-Pass-1' });
    v.password();
    assert.doesNotThrow(() => v.throwIfInvalid(), 'accepts a compliant password');
  }

  // Every problem is reported at once, not one per round trip.
  {
    const v = validate({ email: 'bad', phone: 'bad' });
    v.email();
    v.phone();
    v.string('fullName');
    try {
      v.throwIfInvalid();
      assert.fail('should have thrown');
    } catch (err) {
      const e = err as DomainError;
      assert.equal(e.code, DomainErrorCode.VALIDATION_FAILED);
      assert.equal(e.details.length, 3, 'all three field errors reported together');
    }
  }

  // --- Pagination -----------------------------------------------------------
  assert.deepEqual(parsePage({}), { page: 1, pageSize: 20, skip: 0, take: 20 }, 'defaults');
  assert.equal(parsePage({ pageSize: '5000' }).pageSize, 100, 'page size is capped');
  assert.equal(parsePage({ page: '-3' }).page, 1, 'negative page falls back to one');
  assert.equal(parsePage({ page: 'abc' }).page, 1, 'non-numeric page falls back to one');
  assert.equal(parsePage({ page: 3, pageSize: 10 }).skip, 20, 'skip follows page and size');

  const page = paged([1, 2, 3], 23, parsePage({ page: 1, pageSize: 10 }));
  assert.equal(page.totalPages, 3, '23 items over 10 per page is 3 pages');
  assert.equal(paged([], 0, parsePage({})).totalPages, 0, 'empty result has no pages');

  // --- DomainError ----------------------------------------------------------
  assert.equal(DomainError.notFound('Người dùng', 'abc').getStatus(), 404);
  assert.equal(DomainError.conflict('trùng').getStatus(), 409);
  assert.equal(DomainError.unauthenticated().getStatus(), 401);
  assert.equal(DomainError.forbidden().getStatus(), 403);
  assert.equal(DomainError.rateLimited().getStatus(), 429);
  assert.equal(DomainError.precondition('chưa sẵn sàng').getStatus(), 412);

  console.log('--- all auth unit tests passed ---');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

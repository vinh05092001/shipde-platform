-- FEAT-AUTH-04: password recovery.
--
-- The PasswordResetToken model was added to schema.prisma but no migration ever
-- created its table, so `prisma migrate deploy` left the database without it and
-- every forgot-password request answered 500 with
-- "The table `public.password_reset_tokens` does not exist in the current database."
-- The auth supertest suite failed on that, not on anything it was testing.
--
-- This mirrors the model exactly, including the @db types: a reset token is
-- matched by its hash, so `token` is unique; `consumed_at` is nullable because a
-- token that was never used has not been consumed, which is different from one
-- consumed at an unknown time.

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- Recovery looks a token up by the identifier and channel it was sent to, which
-- is also how the rate limiter counts requests per address.
CREATE INDEX "password_reset_tokens_identifier_channel_idx" ON "password_reset_tokens"("identifier", "channel");

-- Cascade: a deleted user leaves no way to use their reset tokens, and keeping
-- them would keep a live path to an account that no longer exists.
ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

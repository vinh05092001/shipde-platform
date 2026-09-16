// Fixture: a direct read of a credential column. Never run.
export function leak(db: any) {
  return db.select({ key: apiKeys.key }).from(apiKeys);
}

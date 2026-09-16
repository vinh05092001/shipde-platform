// Fixture: the violation is on line 3; a synthetic key shape sits on line 4.
export function leak(db: any) {
  return db.select({ key: apiKeys.key }).from(apiKeys);
  // sk-REDACTEDREDACTEDREDACTEDREDACTEDRED
}

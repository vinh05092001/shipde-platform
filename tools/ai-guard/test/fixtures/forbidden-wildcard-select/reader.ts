// Fixture: reaches a credential column without naming it. Never run.
export function leak(db: any) {
  return db.execute('SELECT * FROM apiKeys WHERE isActive = 1');
}

// Fixture: the projection the real usage adapter uses. This must stay clean.
export function listProviders(db: any) {
  return db.select({ provider: apiKeys.provider, name: apiKeys.name }).from(apiKeys);
}

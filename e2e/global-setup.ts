// Generates media fixtures once per run (cached in artifacts/e2e-fixtures, which Git ignores).
import { Hector } from './harness';
import { ensureFixtures } from './fixtures';

export default async function globalSetup() {
  const hector = await Hector.launch();
  try { await ensureFixtures(hector.app, hector.studio); }
  finally { await hector.close(); }
}

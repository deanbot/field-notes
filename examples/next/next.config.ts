import { join } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // The repo root: `field-notes` resolves through the workspace to packages/.
  turbopack: { root: join(import.meta.dirname, '../..') },
};

export default config;

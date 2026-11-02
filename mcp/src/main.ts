#!/usr/bin/env node
// Stdio entry point: `nutrikit-mcp`, configured by NUTRIKIT_API_KEY and NUTRIKIT_BASE_URL.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Nutrikit } from '@nutrikit/sdk';
import { createServer } from './server.ts';

const apiKey = process.env.NUTRIKIT_API_KEY;
if (!apiKey) {
  // stdout belongs to the protocol; diagnostics go to stderr.
  console.error('nutrikit-mcp: set NUTRIKIT_API_KEY (an nk_… key from `npm run create-key` or the developer portal)');
  process.exit(1);
}

const nk = new Nutrikit({ apiKey, baseUrl: process.env.NUTRIKIT_BASE_URL || 'http://localhost:8787' });
await createServer(nk).connect(new StdioServerTransport());

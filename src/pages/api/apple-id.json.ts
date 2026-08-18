import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const GET: APIRoute = async () => {
  const dataPath = path.join(process.cwd(), 'data', 'apple-accounts.json');
  let dataContent = '{}';
  try {
    dataContent = fs.readFileSync(dataPath, 'utf-8');
  } catch (e: any) {
    dataContent = JSON.stringify({
      lastUpdated: new Date().toISOString(),
      source: 'api_endpoint',
      accounts: [],
    });
  }

  return new Response(dataContent, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
    },
  });
};

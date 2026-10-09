import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { AuditConfigInput } from './config.js';
import { DEFAULT_AUDITOR } from './instructions.js';

export const DEMO_REPORT_NAME = 'Accessibility_Audit_Demo.xlsx';
export const DEMO_OUTPUT_DIR = 'Accessibility Audit Demo Results';

const demoHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility Audit practice page</title>
  <style>
    body { color: #24324a; font: 1rem/1.5 system-ui, sans-serif; margin: 0; }
    header, main { margin: 0 auto; max-width: 52rem; padding: 1.5rem; }
    header { background: #17243b; color: #fff; max-width: none; }
    .subtle { color: #aaa; }
    .card { border: 1px solid #ccd4df; border-radius: .5rem; margin-block: 1rem; padding: 1rem; }
    input { display: block; margin-block: .25rem 1rem; padding: .5rem; }
    button { min-height: 2rem; min-width: 2rem; }
  </style>
</head>
<body>
  <header>
    <h1>Accessibility Audit practice page</h1>
    <p>This bundled page is intentionally imperfect so the demo report contains useful findings.</p>
  </header>
  <main>
    <section class="card">
      <h2>Sample account form</h2>
      <p class="subtle">A few barriers below are deliberate and exist only for learning.</p>
      <input id="demo-email" name="email" type="email" placeholder="Email address">
      <button type="button"></button>
    </section>
    <section class="card">
      <h3>Sample visual</h3>
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='80'%3E%3Crect width='240' height='80' fill='%23d8e2ef'/%3E%3C/svg%3E">
      <p><a href="#details"></a></p>
      <p id="details">The generated report explains the detected barriers and the checks that still need human review.</p>
    </section>
  </main>
</body>
</html>`;

export interface DemoSite {
  url: string;
  close: () => Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
    server.closeIdleConnections();
  });
}

export async function startDemoSite(): Promise<DemoSite> {
  const body = Buffer.from(demoHtml);
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET';
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff'
    };
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      response.writeHead(400, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }

    if (!['GET', 'HEAD'].includes(method)) {
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    if (pathname === '/favicon.ico') {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    if (pathname !== '/') {
      response.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(method === 'HEAD' ? undefined : 'Not found');
      return;
    }

    response.writeHead(200, {
      ...headers,
      'Content-Length': body.byteLength,
      'Content-Type': 'text/html; charset=utf-8'
    });
    response.end(method === 'HEAD' ? undefined : body);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject);
      resolveListen();
    });
  }).catch((error: unknown) => {
    server.close();
    throw error;
  });

  const address = server.address() as AddressInfo;
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      if (closed) return;
      closed = true;
      await closeServer(server);
    }
  };
}

export function demoAuditDefaults(url: string): Partial<AuditConfigInput> {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') {
    throw new Error('The bundled demo must run on its private loopback server.');
  }
  return {
    auditor: DEFAULT_AUDITOR,
    landingPageUrl: target.href,
    outputDir: resolve(DEMO_OUTPUT_DIR),
    exactHosts: ['127.0.0.1'],
    stagingOnly: true,
    concurrency: 1,
    maxLinksPerPage: 20
  };
}

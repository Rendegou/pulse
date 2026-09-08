import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const file = path.resolve('outputs/pulse-depth-demo.html');
// 仅在本机提供此独立原型，不暴露仓库目录或其他资源。
const server = http.createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (request.url !== '/') { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(response);
});
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));

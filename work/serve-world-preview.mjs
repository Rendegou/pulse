import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('static');
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css'};
// 只在本机服务最新 static 文件，目录穿越和其他路径返回 404；不连接或模拟生产 WS。
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
  if (!/^[a-z0-9-]+\.(html|js|css)$/.test(name)) { res.writeHead(404); res.end(); return; }
  const file = path.join(root, name);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type':mime[path.extname(file)] + '; charset=utf-8', 'Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
});
// 独立预览使用系统分配的端口，不抢占用户正在运行的服务。
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));

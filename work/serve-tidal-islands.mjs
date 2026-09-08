import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const file=path.resolve('outputs/pulse-tidal-islands.html');
// 只在回环地址提供本轮独立 HTML，不公开仓库中的其他文件。
const server=http.createServer((req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(req.url!=='/'){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
});
// 系统分配空闲端口，避免干扰已有产品或历史原型服务。
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));

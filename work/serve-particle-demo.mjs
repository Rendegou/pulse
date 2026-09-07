import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const file=path.resolve('outputs/pulse-particle-world-demo.html');
// 仅在本机提供此独立演示，不暴露仓库目录或其他资源。
const server=http.createServer((request,response)=>{
  if(request.url==='/favicon.ico'){response.writeHead(204);response.end();return;}
  if(request.url!=='/'){response.writeHead(404);response.end('Not found');return;}
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(response);
});
// 随机分配本机端口，终端显示实际预览地址，关闭本进程即停止预览。
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const file=path.resolve('outputs/pulse-world-demo.html');
// 只在本机提供这一份原型，避免把仓库、凭据或其他文件暴露给预览页面。
const server=http.createServer((request,response)=>{
 if(request.url==='/favicon.ico'){response.writeHead(204);response.end();return;}
 if(request.url!=='/'){response.writeHead(404);response.end('Not found');return;}
 response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
 fs.createReadStream(file).pipe(response);
});
// 由操作系统分配空闲端口，返回可用于预览的本机地址。
server.listen(0,'127.0.0.1',()=>{console.log('http://127.0.0.1:'+server.address().port);});

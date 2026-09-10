此目录是 Go 内嵌资源边界。前端唯一源码在 frontend/src。
npm run build 生成 static/dist；产物不提交，CI 在 Go 构建前重新生成。
本文件保留目录以支持先启动 Go API 再运行 Vite 开发服务。

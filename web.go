package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// staticFS 只承载前端构建结果与说明；Node 仅用于构建，不是线上运行时。
//
//go:embed static
var staticFS embed.FS

// frontendHandler 提供内嵌构建产物。未构建时返回明确 503，仍允许 Go API/测试独立启动。
// 哈希资源可长期缓存，HTML 每次重验证；未知地址继续 404，不把 API 错误吞成 SPA 页面。
func frontendHandler() http.Handler {
	assets, err := fs.Sub(staticFS, "static/dist")
	if err == nil {
		_, err = fs.Stat(assets, "index.html")
	}
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "PULSE frontend is not built. Run npm ci && npm run build, then restart Go.", http.StatusServiceUnavailable)
		})
	}
	files := http.FileServerFS(assets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			// 只有存在的 Vite 哈希资源允许长期缓存；404 不缓存一年。
			if info, statErr := fs.Stat(assets, strings.TrimPrefix(r.URL.Path, "/")); statErr == nil && !info.IsDir() {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
		}
		files.ServeHTTP(w, r)
	})
}

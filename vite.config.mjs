import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    root: '.', // 项目根目录
    base: './', // 使用相对路径,app://会由协议处理
    build: {
        outDir: 'dist/assets',
        emptyOutDir: false, // 不清空,因为index.html已经在dist根目录
        rollupOptions: {
            input: {
                // 主入口文件
                renderer: path.resolve(__dirname, 'assets/js/index.js')
            },
            output: {
                // 输出单个bundle
                entryFileNames: 'js/renderer.js',
                chunkFileNames: 'js/[name]-[hash].js',
                assetFileNames: '[ext]/[name].[ext]',
                format: 'es',
                // 确保xterm等外部模块路径正确
                paths: {
                    'xterm': 'app://node_modules/xterm/lib/xterm.js',
                    'xterm-addon-fit': 'app://node_modules/xterm-addon-fit/lib/xterm-addon-fit.js'
                }
            },
            // 不要external xterm,让Vite处理它
            external: []
        },
        minify: 'esbuild',
        sourcemap: false,
        target: 'esnext'
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'assets')
        }
    }
});

#!/usr/bin/env node
/**
 * 构建脚本:生成静态HTML文件用于生产环境
 * 这个脚本会:
 * 1. 使用EJS编译模板为静态HTML
 * 2. 替换脚本引用为打包后的bundle
 * 3. 将HTML输出到dist目录
 */

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const viewsDir = path.join(__dirname, 'views');

// 确保dist目录存在
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

console.log('开始构建渲染进程HTML...');

// 编译EJS模板
ejs.renderFile(
    path.join(viewsDir, 'index.ejs'),
    {
        title: 'SSHL客户端',
        connections: [], // 空数组,由渲染进程通过IPC获取
        basePath: __dirname
    },
    { root: viewsDir },
    (err, html) => {
        if (err) {
            console.error('EJS编译错误:', err);
            process.exit(1);
        }

        // 替换脚本引用为打包后的bundle
        // 注意: 这需要在 vite build 之后运行
        const modifiedHtml = html.replace(
            '<script type="module" src="app://assets/js/index.js"></script>',
            '<script type="module" src="app://dist/assets/js/renderer.js"></script>'
        );

        // 将HTML写入dist目录
        const outputPath = path.join(distDir, 'index.html');
        fs.writeFileSync(outputPath, modifiedHtml);

        console.log(`✓ HTML已生成: ${outputPath}`);
        console.log('✓ 脚本引用已更新为: app://dist/assets/js/renderer.js');
    }
);

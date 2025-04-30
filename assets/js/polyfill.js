// polyfill.js
// 为older浏览器提供ES模块支持

(function() {
  // 检查是否支持ES模块
  var supportsEsModules = false;
  try {
    new Function('import("")');
    supportsEsModules = true;
  } catch (err) {}

  // 如果不支持ES模块，加载polyfill脚本
  if (!supportsEsModules) {
    console.log('浏览器不支持ES模块，正在加载polyfill...');
    
    // 显示加载信息
    var loadingDiv = document.createElement('div');
    loadingDiv.style.position = 'fixed';
    loadingDiv.style.top = '0';
    loadingDiv.style.left = '0';
    loadingDiv.style.width = '100%';
    loadingDiv.style.height = '100%';
    loadingDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
    loadingDiv.style.color = 'white';
    loadingDiv.style.display = 'flex';
    loadingDiv.style.alignItems = 'center';
    loadingDiv.style.justifyContent = 'center';
    loadingDiv.style.zIndex = '9999';
    loadingDiv.style.fontFamily = 'sans-serif';
    loadingDiv.innerHTML = '<div style="text-align:center"><h2>正在加载兼容性支持...</h2><p>请稍候片刻</p></div>';
    document.body.appendChild(loadingDiv);
    
    // 动态加载SystemJS作为ES模块的polyfill
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/systemjs@6.14.2/dist/system.min.js';
    script.onload = function() {
      // 设置SystemJS导入映射
      System.config({
        baseURL: 'app://assets/js/'
      });
      
      // 导入主入口文件
      System.import('index.js').then(function() {
        // 移除加载信息
        document.body.removeChild(loadingDiv);
      }).catch(function(err) {
        console.error('加载模块失败:', err);
        loadingDiv.innerHTML = '<div style="text-align:center"><h2>加载失败</h2><p>请尝试重启应用</p><p>错误详情: ' + err.message + '</p></div>';
      });
    };
    script.onerror = function() {
      loadingDiv.innerHTML = '<div style="text-align:center"><h2>兼容性支持加载失败</h2><p>请检查网络连接或升级到更新版本的浏览器</p></div>';
    };
    document.head.appendChild(script);
  }
})();

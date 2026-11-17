/* 模拟 Capacitor 原生环境，用于在浏览器里预演 APK 内的行为 */
window.Capacitor = {
  isNativePlatform: function () { return true; },
  getPlatform: function () { return "android"; },
  isPluginAvailable: function () { return true; },
  Plugins: {
    App: {
      addListener: function () { return Promise.resolve({ remove: function () {} }); },
      exitApp: function () { console.log("[mock] exitApp"); }
    },
    Filesystem: {
      writeFile: function (o) {
        console.log("[mock] Filesystem.writeFile", o.path);
        return Promise.resolve({ uri: "file:///mock/" + o.path });
      }
    },
    Share: {
      share: function (o) {
        console.log("[mock] Share.share", o.title);
        return Promise.resolve({});
      }
    }
  }
};

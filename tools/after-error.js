/* 模拟 401，验证中文错误提示 */
(async function () {
  window.fetch = function () {
    return Promise.resolve(new Response(
      JSON.stringify({ error: { message: "Authentication Fails, Your api key is invalid", type: "authentication_error" } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    ));
  };
  var input = document.getElementById("input");
  input.value = "这条请求会失败";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("btnSend").click();
  return "sent";
})()

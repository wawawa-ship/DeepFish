(function(){
  var st = { temperature: 1.0, maxTokens: 0 };
  var s = { persona:{prompt:"你是阿蓝"}, chat:{thinking:true, webSearch:true, model:""}, messages:[{role:"user",content:"hi"}] };
  var b = API.buildBody(st, s, [{role:"user",content:"hi"}], true);
  var s2 = { persona:{prompt:""}, chat:{thinking:false, webSearch:false, model:""}, messages:[] };
  var b2 = API.buildBody(st, s2, [], true);
  return JSON.stringify({
    model: b.model,
    thinking: b.thinking,
    effort: b.reasoning_effort,
    tools: b.tools,
    offThinking: b2.thinking,
    offTools: b2.tools
  });
})()

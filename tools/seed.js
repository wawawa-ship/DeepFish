/* 注入演示数据，用于界面测试 */
(async function () {
  var now = Date.now();
  var H = 3600000;

  var sessions = [
    {
      id: "s_demo1",
      title: "用例子解释量子纠缠",
      createdAt: now - 2 * H,
      updatedAt: now - 5 * 60000,
      pinned: false,
      messages: [
        {
          id: "m1", role: "user",
          content: "用生活中的例子解释一下「量子纠缠」",
          createdAt: now - 2 * H
        },
        {
          id: "m2", role: "assistant",
          model: "deepseek-chat",
          createdAt: now - 2 * H + 4000,
          reasoning: "用户想要一个生活化的类比。量子纠缠的核心是：两个粒子形成关联态，测量其中一个会瞬间确定另一个的状态。需要用不引起误解的比喻，并说明它不能超光速传递信息。",
          content: [
            "## 一副手套的比喻",
            "",
            "想象你把**一副手套**分别装进两个盒子，一个寄到北京，一个寄到广州。",
            "",
            "在你打开北京那个盒子之前，你并不知道里面是左手还是右手。但只要你看到是**左手**，就能立刻断定广州那盒是**右手**——即使两盒相隔千里。",
            "",
            "量子纠缠与此类似，但有一个关键区别：",
            "",
            "> 手套在装盒时就已经确定了左右；而纠缠粒子在被测量之前，状态是**真正未定**的。",
            "",
            "### 三个要点",
            "",
            "1. 纠缠对必须**共同产生**，不能各自独立制备",
            "2. 测量结果呈现完美关联，但单次结果是随机的",
            "3. 它**不能**用来超光速通信——因为结果本身是噪声",
            "",
            "### 对比表",
            "",
            "| 特征 | 经典手套 | 量子纠缠 |",
            "|---|---|---|",
            "| 状态何时确定 | 装盒时 | 测量时 |",
            "| 是否超光速 | 不涉及 | 关联瞬时，但无信息 |",
            "| 能否预测单次 | 能 | 不能 |",
            "",
            "```js",
            "// 用一个极简模型感受「关联」",
            "const pair = () => {",
            "  const spin = Math.random() < 0.5 ? 'up' : 'down';",
            "  return [spin, spin === 'up' ? 'down' : 'up'];",
            "};",
            "",
            "const [a, b] = pair();",
            "console.log(a, b); // 永远相反",
            "```",
            "",
            "所以，纠缠不是「心灵感应」，而是**同一个整体**被拆开后的两面。"
          ].join("\n")
        },
        {
          id: "m3", role: "user",
          content: "那它能用来做超光速通信吗？",
          createdAt: now - 6 * 60000
        },
        {
          id: "m4", role: "assistant",
          model: "deepseek-chat",
          createdAt: now - 5 * 60000,
          content: "不能。\n\n原因很朴素：**你无法控制测量结果**。\n\n每次测量得到「上」还是「下」都是随机的，对方看到的只是一串噪声。要从中读出信息，你必须再用一条普通信道把「测量方式」告诉对方——而这条信道受光速限制。\n\n这就是物理学家说的：纠缠能产生**关联**，但不能传递**信息**。"
        }
      ]
    },
    {
      id: "s_demo2",
      title: "JS 数组去重的几种方法",
      createdAt: now - 26 * H,
      updatedAt: now - 25 * H,
      pinned: false,
      messages: [
        {
          id: "m21", role: "user",
          content: "JS 数组去重有哪些方法？各自优缺点？",
          createdAt: now - 26 * H
        },
        {
          id: "m22", role: "assistant",
          model: "deepseek-chat",
          createdAt: now - 25 * H,
          content: [
            "## 1. Set（最常用）",
            "",
            "```js",
            "const uniq = [...new Set(arr)];",
            "```",
            "",
            "**优点**：代码最短，性能好。",
            "**缺点**：只能处理基本类型，`NaN` 会被正确去重，但对象按引用比较。",
            "",
            "## 2. filter + indexOf",
            "",
            "```js",
            "const uniq = arr.filter((v, i) => arr.indexOf(v) === i);",
            "```",
            "",
            "**缺点**：时间复杂度 O(n²)，大数组很慢。",
            "",
            "## 3. 按对象字段去重",
            "",
            "```js",
            "const byId = (list) => {",
            "  const m = new Map();",
            "  list.forEach(o => m.set(o.id, o));",
            "  return [...m.values()];",
            "};",
            "```",
            "",
            "| 方法 | 复杂度 | 适用场景 |",
            "|---|---|---|",
            "| Set | O(n) | 基本类型 |",
            "| filter+indexOf | O(n²) | 小数组、兼容老环境 |",
            "| Map | O(n) | 对象数组 |",
            "",
            "> 现代项目直接用 `Set` 即可。"
          ].join("\n")
        }
      ]
    },
    {
      id: "s_demo3",
      title: "周报模板",
      createdAt: now - 50 * H,
      updatedAt: now - 49 * H,
      pinned: false,
      messages: [
        {
          id: "m31", role: "user",
          content: "帮我写一个简洁的周报模板",
          createdAt: now - 50 * H
        },
        {
          id: "m32", role: "assistant",
          model: "deepseek-chat",
          createdAt: now - 49 * H,
          content: "本周完成了 **3 项**主要工作：\n\n- 上线订单导出功能，覆盖 92% 商户\n- 修复支付回调偶发超时\n- 完成下季度排期评审\n\n下周计划推进对账系统重构，预计周三前出方案。\n\n> 风险：第三方物流接口稳定性下降，已提工单跟进。"
        }
      ]
    }
  ];

  Store.state.settings.apiKey = "sk-demo-key-for-preview";
  Store.state.settings.model = "deepseek-chat";
  Store.state.sessions = sessions;
  Store.state.activeId = "s_demo1";
  await Store.saveImmediate();
  return "seeded:" + sessions.length;
})()

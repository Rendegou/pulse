// articles.js — 示例文章内容（双语 fixture）。
// 这些是演示文本，明确标注为示例，不是真实博客导入；接入真实文章时替换数据源。

export const ARTICLES = {
  "zh-CN": {
    titles: ["把一段时间放在这里", "关于远方的坐标", "有些相遇不需要说话"],
    paras: [
      ["我们习惯把文章放进列表。这一次，试着把它放在桌上。它不必急着告诉所有人，只等一个路过的人停下来。",
       "远处的房子是一个点，靠近后有了墙、书架，还有一页能慢慢读的文字。空间给内容留下了一个可以记住的位置。"],
      ["拖动改变的是你所在的坐标；缩放改变的是你与这个地方的距离。远近之间，房子一直是同一间房子。",
       "这个原型用局部曲面表达巨大世界的感觉。真实产品仍需要有界的数据加载、稳定的空间身份与清楚的权限。"],
      ["别人的指针轻轻经过，停在同一本书旁。我们希望保留这种很轻的在场感。",
       "你现在看到的邻居都是标明来源的演示。真正的相遇，要等实时连接接到同一套世界坐标之后。"],
    ],
  },
  en: {
    titles: ["A little time, kept here", "Coordinates of somewhere else", "Being here, together"],
    paras: [
      ["We usually put writing in a list. Here, a story rests on a desk, waiting for somebody passing by to pause.",
       "A distant house begins as a point. Closer, it becomes walls, shelves, and a page you can take your time with."],
      ["Dragging changes where you are. Zooming changes your distance from the place. The house stays the same house.",
       "This prototype bends a local surface to suggest a vast world. A real product still needs bounded loading, stable identities, and ownership."],
      ["A pointer passes quietly and pauses beside the same book. That small sense of another person is what we want to keep.",
       "The visitors here are explicitly simulated. Real presence requires a shared world-coordinate protocol."],
    ],
  },
};

// articles.js — 示例文章内容（双语 fixture）。
// 这些是演示文本，明确标注为示例，不是真实博客导入；接入真实文章时替换数据源。
// 索引与 islands.js 的 island.article 一一对应：0=你的原点，1=雨后手记，2=远山来信。

export const ARTICLES = {
  "zh-CN": {
    titles: ["把一段时间放在这里", "潮水退去之后", "有些相遇，不需要说话"],
    paras: [
      [
        "今天没有发生什么值得郑重记录的大事。窗外下了一会儿雨，杯子里的茶凉了，读到一段喜欢的话，又翻回去看了一遍。",
        "但我还是想把这段时间放在这里。像在海边捡到一块形状普通的石头，因为当时握在手里的温度，决定带它回家。",
        "也许很多年以后，留下来的并不是某个答案，而是一个很轻的下午。",
      ],
      [
        "潮水退去以后，岸边的纹路才慢慢显出来。细沙上有蜿蜒的线，浅水里留下小小的涡流。原来平静的表面，也记得经过它的东西。",
        "我想做一个这样的地方。远看安静，走近了，能发现有人在这里停留过。",
        "文章可以短一点，更新可以慢一点。重要的是，那些真正想留下的东西，能有自己的位置。",
      ],
      [
        "有时候，只是知道有人也在，就很好。",
        "不一定要立刻打招呼。你沿着岸线走，我在这边读一页书。光标从旁边经过，像一阵有方向的风。",
        "等想说话的时候，再说也来得及。这个地方很大，我们可以慢慢认识。",
      ],
    ],
  },
  en: {
    titles: ["A little time, kept here", "After the tide goes out", "Being here, together"],
    paras: [
      [
        "Nothing worth recording properly happened today. Rain passed the window for a while, the tea went cold, and I read a line I liked, then turned back and read it again.",
        "Still, I want to keep this stretch of time here. Like a stone picked up on a beach for no special reason, carried home because of how warm it felt in my hand.",
        "Maybe what stays, years later, is not an answer but a very light afternoon.",
      ],
      [
        "When the tide goes out, the patterns on the shore slowly appear. Winding lines in wet sand, small eddies left in shallow water. Even a calm surface remembers what passed over it.",
        "I want to make a place like that. Quiet from a distance, and close up you can tell someone paused here.",
        "Stories can be short and updates can be slow. What matters is that the things worth keeping have a place of their own.",
      ],
      [
        "Sometimes it is enough to know someone else is around.",
        "You don't have to say hello right away. You walk along the shoreline; I read a page over here. A cursor passes by like wind with a direction.",
        "There will be time to talk when you want to. This place is large, and we can get to know it slowly.",
      ],
    ],
  },
};

# README 配图

README 使用三个本地资源，提交源码时一同提交 `assets/readme/`。

| 文件 | 来源 |
| --- | --- |
| `assets/readme/overview.png` | 当前 MyGO 主窗口的原生界面截图 |
| `assets/readme/widget.png` | Go / Win32 原生透明桌面小窗口截图 |
| `assets/readme/cover.png` | 基于上述两张截图，通过内置 `image_gen` 合成的展示封面 |

两张原始截图来自 `npm run native:check` 的原生界面验收，使用合成演示数据。小窗口输出为 `artifacts/native-acceptance/widget-card.png`。封面基于此前相同布局的截图制作，用于展示；真实界面以 README 中的原始截图为准。不包含个人账号或真实项目路径。

生成提示词：

```text
Use case: compositing. Asset type: a polished wide 16:9 GitHub README product cover for Codex Monitor. Input image 1 is a genuine screenshot of the current MyGO native dashboard using demonstration data. Input image 2 is a genuine screenshot of its retained transparent desktop widget. Treat both screenshots as locked raster inserts: preserve their Chinese text, all numbers, charts, colors, icons and exact interface layout; do not redesign or repaint the interface. Present the large dashboard straight on in a subtle rounded glass frame, taking most of the composition. Place the smaller widget in front near the lower right with a soft realistic shadow, leaving the important dashboard navigation and metrics visible. Use a quiet off-white, very pale ice-blue and mint studio backdrop matching the application, restrained lighting, generous breathing room and clean edges. The result should feel like a refined desktop software product presentation. Do not add any text outside the screenshots, slogans, extra logos, fabricated controls, device hardware, watermarks, people, neon decorations or purple mesh. Preserve the screenshots' readable content and make the presentation background the only creative change.
```

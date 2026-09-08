"""将正式世界的绘制实现同步至单文件演示；演示仍独立使用其模拟访客和离线文章。"""
from pathlib import Path
source = Path('static/world.js').read_text(encoding='utf-8')
p = Path('outputs/pulse-particle-world-demo.html')
demo = p.read_text(encoding='utf-8')
# 重复执行时先移除之前注入的状态，保留用户偏好与交互装配。
if '// BEGIN SHARED SPACE CACHE' in demo:
    start = demo.index('// BEGIN SHARED SPACE CACHE')
    end = demo.index('// END SHARED SPACE CACHE', start) + len('// END SHARED SPACE CACHE\n')
    demo = demo[:start] + demo[end:]
cache = '''// BEGIN SHARED SPACE CACHE
// 正式渲染器的有界缓存；仅本页拥有，模拟访客不进入静态位图。
const TUNE = {terrainDensity:8000};
const terrainTiles = new Map();
// 每档复用坐标数组，避免每个可见粒子分配对象。
const particleBuckets = Array.from({length:12}, () => []);
let terrainCache=null, terrainCacheKey='', scenePaints=0, paletteVersion=0;
// END SHARED SPACE CACHE
'''
demo = demo.replace("'use strict';", "'use strict';\n"+cache)
demo = demo.replace("const canvas=document.getElementById('world'),ctx=canvas.getContext('2d');", "const canvas=document.getElementById('world');\nlet ctx=canvas.getContext('2d');")
demo = demo.replace('paletteVersion++;','')
demo = demo.replace('palette=THEMES[effective];', 'palette=THEMES[effective];paletteVersion++;')
# 各段以职责注释为边界替换，不触碰世界生成、阅读、主题与模拟访客逻辑。
for start_marker, end_marker in [
    ('// dottedEdge ', '// drawGraticule '),
    ('// spaceOutline ', '// render 是'),
]:
    block = source[source.index(start_marker):source.index(end_marker, source.index(start_marker))]
    if start_marker.startswith('// dottedEdge'):
        block = block.replace('unprojectCalc(view(), ', 'unproject(')
        start=demo.index('// dottedEdge '); end=demo.index('// drawGraticule ',start)
    else:
        start=demo.index('// spaceOutline ') if '// spaceOutline ' in demo else demo.index('// drawHouse 从')
        end=demo.index('// drawVisitors ',start)
    demo=demo[:start]+block+demo[end:]
start=demo.index('ctx.fillStyle=palette.bg;',demo.index('function render(now)')) if 'ctx.fillStyle=palette.bg;' in demo[demo.index('function render(now)'):] else -1
if start>=0:
    end=demo.index('drawVisitors(now);',start)
    demo=demo[:start]+'drawSceneCached(now);'+demo[end:]
demo=demo.replace('body[data-inside=true] #hint{bottom:74px}', 'body[data-inside=true] #hint{display:none}')
demo=demo.replace('屋顶已打开。桌上的书就是文章。','停在你的庭院里。桌上的书就是文章。').replace('The roof is open. Each book holds an article.','A quiet courtyard. Each book holds an article.')
demo=demo.replace('屋顶淡去','上层点线淡去').replace('its roof fades','its upper outline fades')
tail='if(Math.hypot(state.velocity.x,state.velocity.y)*camera.zoom<.0005)state.velocity={x:0,y:0};'
demo=demo.replace(tail,'')
demo=demo.replace('state.velocity.y*=decay;', 'state.velocity.y*=decay;'+tail)
p.write_text(demo,encoding='utf-8')
print('Synced drawing and cache; network-free demo controls preserved.')

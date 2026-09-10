// readPalette 只在主题改变时读 CSS token；Canvas 与指针共用这份颜色，不逐帧查询样式。
export function readPalette() {
  const style = getComputedStyle(document.documentElement);
  // get/rgb 分别读取 CSS 文本与三通道数值，输入是现有语义 token 名称。
  const get = (key) => style.getPropertyValue(key).trim();
  const rgb = (key) => get(key).split(',').map(Number);
  return {
    bg: get('--bg'), sea: rgb('--world-sea-rgb'), foam: rgb('--world-foam-rgb'),
    shore: rgb('--world-shore-rgb'), land: rgb('--world-land-rgb'), contour: rgb('--world-contour-rgb'),
    solid: get('--world-solid'), paper: get('--world-paper'), ink: get('--world-ink'),
    gold: get('--gold'), shadow: get('--shadow'),
  };
}

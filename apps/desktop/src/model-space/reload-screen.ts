/**
 * Blank document shown while the model site reloads. The same spinner is in
 * the model page, so the handoff stays put until that page paints.
 */
export function modelReloadDocument(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: #fff; }
  .zhishu-boot { height: 100%; display: flex; align-items: center; justify-content: center; }
  .zhishu-boot i {
    width: 28px; height: 28px; box-sizing: border-box; border-radius: 50%;
    border: 2px solid rgba(0, 82, 217, .16); border-top-color: #0052d9;
    animation: zhishu-boot-turn .8s linear infinite;
  }
  @keyframes zhishu-boot-turn { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .zhishu-boot i { animation: none; border-color: #0052d9; }
  }
</style>
</head>
<body>
<div class="zhishu-boot" role="status" aria-label="正在加载"><i></i></div>
</body>
</html>`
}

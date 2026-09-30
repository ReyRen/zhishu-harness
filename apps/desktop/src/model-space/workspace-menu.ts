import type { ModelSpace } from './model-space.ts'

/**
 * Dropdown document for the caption workspace switch.
 * Rendered in its own view so the model page cannot cover it.
 */
export function workspaceMenuDocument(active: ModelSpace, zh: boolean, dark: boolean): string {
  const conversation = zh ? '会话' : 'Conversation'
  const business = zh ? '业务' : 'Business'
  const conversationDetail = zh ? '创建、学习和探索' : 'Create, learn and explore'
  const businessDetail = zh ? '模型平台的全部功能' : 'The full model platform'
  const label = zh ? '切换工作空间' : 'Switch workspace'
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: ${dark ? '#1f1f1f' : '#fff'}; color: ${dark ? '#f3f4f6' : '#202124'};
    font: 14px/20px "Segoe UI", "Microsoft YaHei", sans-serif; }
  .menu { box-sizing: border-box; height: 100%; padding: 7px; }
  button { appearance: none; width: 100%; min-height: 58px; display: flex; align-items: center;
    justify-content: space-between; gap: 10px; padding: 8px 10px; color: inherit; background: transparent;
    border: 0; border-radius: 9px; text-align: left; cursor: pointer; }
  button:hover, button[data-active="true"] { background: ${dark ? 'rgba(255,255,255,.08)' : 'rgba(32,33,36,.08)'}; }
  span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  strong { font-size: 14px; line-height: 20px; font-weight: 600; }
  small { color: ${dark ? '#b0b4ba' : '#737982'}; font-size: 12px; line-height: 17px; white-space: nowrap; }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; }
</style>
</head>
<body>
<div class="menu" role="menu" aria-label="${label}">
${option('conversation', conversation, conversationDetail, active === 'conversation')}
${option('business', business, businessDetail, active === 'business')}
</div>
</body>
</html>`
}

function option(space: ModelSpace, title: string, detail: string, selected: boolean): string {
  const mark = selected
    ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3 3 7-7"></path></svg>'
    : ''
  return `<button type="button" role="menuitemradio" data-space="${space}" data-active="${selected ? 'true' : 'false'}" aria-checked="${selected ? 'true' : 'false'}">
<span><strong>${title}</strong><small>${detail}</small></span>${mark}
</button>`
}

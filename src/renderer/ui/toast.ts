import { DOM } from './dom'
import { SVG_ICONS } from './icons'

function getToastIcon(type: string): string {
  switch (type) {
    case 'warning':
      return SVG_ICONS.warning
    case 'error':
      return SVG_ICONS.error
    case 'reminder':
      return SVG_ICONS.clock
    case 'info':
    default:
      return SVG_ICONS.info
  }
}

export function showHudToast(
  title: string,
  message: string,
  type: string = 'info',
  durationMs: number = 6000,
  action?: { label: string; onClick: () => void }
): HTMLElement | null {
  const container = DOM.hudToastContainer || document.getElementById('hud-toast-container')
  if (!container) return null

  const toast = document.createElement('div')
  toast.className = `hud-toast ${type}`

  const header = document.createElement('div')
  header.className = 'hud-toast-header'

  const titleWrap = document.createElement('div')
  titleWrap.style.display = 'inline-flex'
  titleWrap.style.alignItems = 'center'
  titleWrap.style.gap = '6px'

  const iconSpan = document.createElement('span')
  iconSpan.style.display = 'inline-flex'
  iconSpan.style.alignItems = 'center'
  iconSpan.style.justifyContent = 'center'
  iconSpan.innerHTML = getToastIcon(type)

  const titleSpan = document.createElement('span')
  titleSpan.className = 'hud-toast-title'
  titleSpan.textContent = title

  titleWrap.appendChild(iconSpan)
  titleWrap.appendChild(titleSpan)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'hud-toast-close'
  closeBtn.innerHTML = '&times;'

  header.appendChild(titleWrap)
  header.appendChild(closeBtn)

  const msgDiv = document.createElement('div')
  msgDiv.className = 'hud-toast-message'
  msgDiv.textContent = message

  toast.appendChild(header)
  toast.appendChild(msgDiv)

  const removeToast = (): void => {
    toast.classList.add('fading')
    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast)
      }
    }, 300)
  }

  if (action) {
    const actionContainer = document.createElement('div')
    actionContainer.style.marginTop = '8px'
    actionContainer.style.display = 'flex'
    actionContainer.style.justifyContent = 'flex-end'

    const actionBtn = document.createElement('button')
    actionBtn.className = 'hud-toast-btn-action'
    actionBtn.textContent = action.label
    actionBtn.style.padding = '5px 12px'
    actionBtn.style.background = 'rgba(255, 255, 255, 0.14)'
    actionBtn.style.border = '1px solid rgba(255, 255, 255, 0.45)'
    actionBtn.style.borderRadius = '6px'
    actionBtn.style.color = '#ffffff'
    actionBtn.style.fontSize = '12px'
    actionBtn.style.fontWeight = '500'
    actionBtn.style.cursor = 'pointer'
    actionBtn.style.transition = 'all 0.2s ease'

    actionBtn.addEventListener('mouseenter', () => {
      actionBtn.style.background = 'rgba(255, 255, 255, 0.28)'
      actionBtn.style.borderColor = '#ffffff'
    })
    actionBtn.addEventListener('mouseleave', () => {
      actionBtn.style.background = 'rgba(255, 255, 255, 0.14)'
      actionBtn.style.borderColor = 'rgba(255, 255, 255, 0.45)'
    })

    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      action.onClick()
      removeToast()
    })

    actionContainer.appendChild(actionBtn)
    toast.appendChild(actionContainer)
  }

  closeBtn.addEventListener('click', () => removeToast())

  container.appendChild(toast)

  // Auto remove
  setTimeout(removeToast, durationMs)

  return toast
}

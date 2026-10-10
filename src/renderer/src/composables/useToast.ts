import { ref } from 'vue'

/** 全局轻提示（toast） */
export interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

let seed = 0
const toasts = ref<ToastItem[]>([])

export function useToast() {
  function push(type: ToastItem['type'], message: string): void {
    const id = ++seed
    toasts.value.push({ id, type, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 3000)
  }
  return {
    toasts,
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    info: (m: string) => push('info', m)
  }
}

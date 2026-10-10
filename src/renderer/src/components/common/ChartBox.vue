<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts'

/**
 * ECharts 容器组件：自动初始化/更新/自适应/销毁。
 */
const props = defineProps<{
  option: echarts.EChartsOption
  height?: string
}>()

const el = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function render(): void {
  if (!chart) return
  chart.setOption(props.option, true)
}

function onResize(): void {
  chart?.resize()
}

onMounted(() => {
  if (!el.value) return
  chart = echarts.init(el.value)
  render()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})

watch(
  () => props.option,
  () => render(),
  { deep: true }
)
</script>

<template>
  <div ref="el" class="chart-box" :style="{ height: height ?? '260px' }" />
</template>

<style scoped>
.chart-box {
  width: 100%;
}
</style>

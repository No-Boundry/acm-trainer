<script setup lang="ts">
defineProps<{ title: string; desc?: string }>()
</script>

<template>
  <div class="placeholder">
    <h1>{{ title }}</h1>
    <p v-if="desc">{{ desc }}</p>
    <p class="hint">该模块将在后续里程碑实现（见 docs/05-任务分解与计划.md）</p>
  </div>
</template>

<style scoped>
.placeholder {
  padding: 48px 32px;
}
.placeholder h1 {
  margin: 0 0 12px;
  font-size: 28px;
}
.placeholder p {
  color: #a6adc8;
  margin: 6px 0;
}
.placeholder .hint {
  margin-top: 24px;
  font-size: 13px;
  color: #6c7086;
}
</style>

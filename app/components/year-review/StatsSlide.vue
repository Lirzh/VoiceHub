<template>
  <div class="slide-container">
    <div class="bg-gradient" />

    <Transition name="entry" appear>
      <div v-show="active" class="content">
        <div class="label">音乐足迹</div>

        <p class="text-intro">这一年，你一共发起了</p>

        <div class="number-container">
          <span class="big-number">{{ data.totalRequests.toLocaleString() }}</span>
          <span class="suffix">次点歌</span>
        </div>

        <div class="sub-stats">
          <div v-if="data.playedRequests > 0" class="sub-content">
            <p class="text-base">
              其中有 <span class="highlight-green">{{ data.playedRequests }}</span> 首
            </p>
            <p class="text-sub">在广播站被播出，传递给了更多人</p>
          </div>
          <p v-else class="text-sub">期待你的歌曲早日被播出</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
defineProps({
  data: Object,
  active: Boolean
})
</script>

<style scoped>
.slide-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: var(--components_year-review_StatsSlide_46_0); /* gray-950 */
}

.bg-gradient {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at top right,
    var(--components_year-review_StatsSlide_54_0),
    transparent,
    transparent
  );
}

.content {
  z-index: 10;
  max-width: 42rem;
  padding: 1.5rem;
  text-align: center;
}

.label {
  margin-bottom: 1rem;
  color: var(--components_year-review_StatsSlide_69_0); /* brand-blue */
  font-weight: 700;
  letter-spacing: 0.05em;
  font-size: 1.125rem;
}

.text-intro {
  font-size: 1.5rem;
  color: var(--components_year-review_StatsSlide_77_0);
  margin-bottom: 0.5rem;
}

.number-container {
  position: relative;
  padding: 1rem 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.5rem;
}

.big-number {
  font-size: 10rem;
  font-weight: 900;
  line-height: 1;
  background-image: linear-gradient(to bottom, var(--components_year-review_StatsSlide_94_0), var(--components_year-review_StatsSlide_94_1));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 30px var(--components_year-review_StatsSlide_98_0));
}

.suffix {
  font-size: 1.5rem;
  color: var(--components_year-review_StatsSlide_103_0);
  font-weight: 500;
  margin-left: 0.5rem;
}

.sub-stats {
  margin-top: 3rem;
  padding: 1.5rem;
  border-radius: 1rem;
  background: var(--components_year-review_StatsSlide_112_0);
  border: 1px solid var(--components_year-review_StatsSlide_113_0);
  backdrop-filter: blur(4px);
}

.sub-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.text-base {
  font-size: 1.125rem;
  color: var(--components_year-review_StatsSlide_125_0);
}

.highlight-green {
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--components_year-review_StatsSlide_131_0);
  margin: 0 0.25rem;
}

.text-sub {
  font-size: 1rem;
  color: var(--components_year-review_StatsSlide_137_0);
}

@media (max-width: 768px) {
  .number-container {
    flex-direction: column;
    align-items: center;
    gap: 0;
  }

  .big-number {
    font-size: 7rem;
  }
  .text-intro {
    font-size: 1.25rem;
  }
  .suffix {
    font-size: 1.25rem;
    margin-top: 0.5rem;
    margin-left: 0;
  }
}
</style>

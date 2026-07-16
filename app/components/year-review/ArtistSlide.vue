<template>
  <div v-if="data.topArtist" class="slide-container">
    <!-- Background Gradients -->
    <div class="bg-overlay" />
    <div class="animated-bg" />

    <Transition name="entry" appear>
      <div v-show="active" class="content">
        <div class="label">特别偏爱</div>

        <p class="text-intro">你的年度歌手是</p>

        <div class="artist-container">
          <div class="artist-bg-blur" />
          <h2 class="artist-name">{{ data.topArtist }}</h2>
        </div>

        <p class="text-desc">Ta 的声音似乎特别吸引你，<br >陪伴了你无数个日夜。</p>
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
  background-color: var(--components_year-review_ArtistSlide_40_0);
}

.bg-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, var(--components_year-review_ArtistSlide_46_0), transparent, transparent);
  opacity: 0.8;
  z-index: 10;
}

.animated-bg {
  position: absolute;
  top: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(to bottom, var(--components_year-review_ArtistSlide_56_0), var(--components_year-review_ArtistSlide_56_1));
  opacity: 0.5;
  animation: pulse 8s infinite;
}

.content {
  z-index: 20;
  width: 100%;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.label {
  color: var(--components_year-review_ArtistSlide_72_0); /* purple-300 */
  letter-spacing: 0.3em;
  text-transform: uppercase;
  margin-bottom: 1.5rem;
  font-size: 0.875rem;
  font-weight: 700;
  border-bottom: 1px solid var(--components_year-review_ArtistSlide_78_0);
  padding-bottom: 0.5rem;
}

.text-intro {
  font-size: 1.5rem;
  color: var(--components_year-review_ArtistSlide_84_0);
  font-weight: 300;
  margin-bottom: 3rem;
}

.artist-container {
  position: relative;
  width: 100%;
}

.artist-bg-blur {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 120%;
  height: 120%;
  background: var(--components_year-review_ArtistSlide_101_0);
  filter: blur(60px);
  border-radius: 50%;
}

.artist-name {
  position: relative;
  font-size: 5rem;
  font-weight: 900;
  font-style: italic;
  letter-spacing: -0.05em;
  background-image: linear-gradient(to bottom right, var(--components_year-review_ArtistSlide_112_0), var(--components_year-review_ArtistSlide_112_1), var(--components_year-review_ArtistSlide_112_2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 25px 25px var(--components_year-review_ArtistSlide_116_0));
  word-break: break-word;
  padding: 0 0.5rem;
}

.text-desc {
  margin-top: 3rem;
  color: var(--components_year-review_ArtistSlide_123_0);
  max-width: 24rem;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.625;
  font-size: 1rem;
}

@media (max-width: 768px) {
  .artist-name {
    font-size: 3rem;
  }
  .text-intro {
    font-size: 1.25rem;
    margin-bottom: 2rem;
  }
}
</style>

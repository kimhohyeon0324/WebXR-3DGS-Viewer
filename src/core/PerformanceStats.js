import Stats from 'stats-gl';

/**
 * Three.js 및 WebGL 실시간 성능 프로파일러 (FPS, MS, GPU DrawCalls)
 */
export class PerformanceStats {
  constructor(renderer = null) {
    this.stats = new Stats({
      logsPerSecond: 20,
      samplesLog: 60,
      precision: 1,
      minimal: false,
      mode: 0 // 0: FPS, 1: MS
    });

    this.stats.dom.classList.add('stats-container');
    document.body.appendChild(this.stats.dom);

    if (renderer) {
      this.initRenderer(renderer);
    }
  }

  initRenderer(renderer) {
    if (renderer && renderer.getContext) {
      try {
        this.stats.init(renderer);
      } catch (err) {
        console.warn('PerformanceStats: WebGL context init failed or not ready:', err);
      }
    }
  }

  begin() {
    if (this.stats && typeof this.stats.begin === 'function') {
      this.stats.begin();
    }
  }

  end() {
    if (this.stats && typeof this.stats.end === 'function') {
      this.stats.end();
    }
  }

  update() {
    if (this.stats && typeof this.stats.update === 'function') {
      this.stats.update();
    }
  }

  dispose() {
    if (this.stats && this.stats.dom && this.stats.dom.parentElement) {
      this.stats.dom.parentElement.removeChild(this.stats.dom);
    }
  }
}
